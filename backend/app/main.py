"""
FastAPI backend for the Personal Health Agent.

    POST   /api/suggest           check-in variables → Jev: which activity → Jev: how long → pick + 2 backups
    POST   /api/suggest/table     the same, with the options taken from the activity table:
                                  filter the table → Jev: which heading → which activity → how long
    POST   /api/chat              a Chat message → urgent keywords → Jev: three yes/no questions →
                                  a fixed reply, or the model that writes. Plain text, streamed
    GET    /api/state             load the saved app state
    PUT    /api/state             save it
    DELETE /api/state             forget it
    GET    /api/suggestions/log   recent prompts and Jev answers, for prompt tuning
    GET    /api/activities        the activity table, optionally by place and heading
    GET    /api/health            is the backend up, and is Jev live or mocked?
    GET    /api/fitbit/status     is real Fitbit set up (client id in .env), and is this user connected?
    GET    /api/fitbit/connect    → Google's consent page (Google Health API, which replaced the Fitbit Web API)
    GET    /api/fitbit/callback   Google sends the user back here; saves the tokens
    GET    /api/fitbit/sync       workouts and VO2 max readings since a date
    DELETE /api/fitbit            forget this user's Fitbit tokens

Run from backend/:  uvicorn app.main:app --reload --port 8000
Each /api/suggest and /api/chat prints its steps in that terminal; LOG_LEVEL=DEBUG in .env adds the full JSON.
On startup the activity CSV is copied into the `activities` table (activities.py), and the Chat
keyword list and fixed replies are read from backend/chat_content/ (chat_rules.py, chat_replies.py).
"""
import html
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # our own lines already say when Jev is called
log = logging.getLogger("pha")

from fastapi import Body, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, StreamingResponse  # noqa: E402

from . import activities, chat_gate, chat_prompt, chat_replies, chat_rules, chat_writer, db  # noqa: E402
from . import google_health as gh  # noqa: E402
from .jev import (  # noqa: E402
    JevError, call_jev, has_api_key, jev_model, mock_activity, mock_durations,
    mock_heading, mock_table_activities, mock_table_durations,
)
from .prompt import (  # noqa: E402
    build_activity_request, build_duration_request,
    build_heading_request, build_table_activity_request, build_table_duration_request, build_table_state,
    group_by_heading, table_activity_question,
)
from .schemas import (  # noqa: E402
    ChatRequest, SuggestRequest, SuggestResponse, TableSuggestRequest, TableSuggestResponse,
)
from .suggest import (  # noqa: E402
    HEADINGS_TO_ASK, AnswerError, assemble, assemble_table, pick_activities, pick_from_table, rank_headings,
)

VIGOROUS_MET = 6.0  # "no vigorous activity" means under this, as in the app (src/lib/met.ts)

# What POST /api/chat tells the app besides the reply text, as response headers.
CHAT_STOPPED_BY = "X-Chat-Stopped-By"  # keywords | jev | none
CHAT_REPLY = "X-Chat-Reply"            # urgent | medical_advice | off_topic, or "model" when the model wrote it

# The Chat keyword list, fixed replies and brief, read once: when the backend starts, or at the first chat message.
_chat: Dict[str, Any] = {}


def _chat_content() -> Tuple[List[chat_rules.Keyword], Dict[str, str], str]:
    """(urgent keywords, fixed replies, brief) from the three files in backend/chat_content/."""
    if not _chat:
        keywords, replies, brief = chat_rules.read_csv(), chat_replies.read_csv(), chat_prompt.read_brief()
        _chat.update(keywords=keywords, replies=replies, brief=brief)
    return _chat["keywords"], _chat["replies"], _chat["brief"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    """When the backend starts: replace the `activities` table with the CSV, so the two always match,
    and read the Chat keyword list, fixed replies and brief, so a file that can't be read stops the backend here."""
    try:
        total = activities.load()
    except activities.ActivityTableError as e:
        log.error("✗ Activities: %s", e)
        raise
    log.info(
        "Activities: %d loaded from %s (%d marked exercise_rec)",
        total, activities.CSV_PATH.name, activities.count(recommended=True),
    )
    try:
        _chat.clear()
        keywords, replies, _ = _chat_content()
    except (chat_rules.KeywordFileError, chat_replies.ReplyFileError, chat_prompt.BriefFileError) as e:
        log.error("✗ Chat: %s", e)
        raise
    log.info(
        "Chat: %d urgent keywords from %s, %d fixed replies from %s, brief from %s (writer: %s)",
        len(keywords), chat_rules.CSV_PATH.name, len(replies), chat_replies.CSV_PATH.name,
        chat_prompt.BRIEF_PATH.name, chat_writer.name(),
    )
    yield


app = FastAPI(title="Personal Health Agent backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[CHAT_STOPPED_BY, CHAT_REPLY],  # so the app can read them from another origin
)


def _top(answer: Dict[str, Any], n: int = 3) -> str:
    """Jev's top choices on one line, e.g. 'cycling-easy 0.72 · yoga-power 0.20'."""
    probs = sorted(answer.get("probabilities", {}).items(), key=lambda kv: -kv[1])[:n]
    return " · ".join(f"{k} {v:.2f}" for k, v in probs)


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True, "jev": "live" if has_api_key() else "mock", "model": jev_model(),
        "chat_writer": chat_writer.name(),  # "placeholder", or the model that writes Chat replies
    }


@app.post("/api/suggest", response_model=SuggestResponse)
def suggest(req: SuggestRequest) -> SuggestResponse:
    if not req.options or not req.durations:
        raise HTTPException(422, "No options to choose from; the app offers desk moves in this case")

    live = has_api_key()
    source = "jev" if live else "mock"
    model = jev_model() if live else "mock"
    # Both calls are logged together: {"activity": ..., "duration": ...}
    jev_request: Dict[str, Any] = {}
    jev_answers: Dict[str, Any] = {}

    c = req.check_in
    log.info("── POST /api/suggest  user=%s  (Jev: %s) ──", req.user_id, model)
    log.info("[1] Check-in: %d min · %s · energy=%s · mood=%s", c.minutes, c.place, c.energy, c.mood_name or c.mood)
    log.info("    Need %.2f MET-h today · %d options passed filters", req.needed_met_hours, len(req.options))
    try:
        # Call 1: which activity
        jev_request["activity"] = build_activity_request(req, model)
        log.debug("    Prompt #1: %s", json.dumps(jev_request["activity"], ensure_ascii=False))
        t = time.perf_counter()
        if live:
            jev_answers["activity"], model = call_jev(jev_request["activity"])
        else:
            jev_answers["activity"] = mock_activity(req)
        log.info("[2] Ask Jev #1 (which activity)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer #1: %s", json.dumps(jev_answers["activity"], ensure_ascii=False))
        picked = pick_activities(req, jev_answers["activity"])
        log.info("    %s", _top(jev_answers["activity"]["activity"]))

        # Call 2: how long, for each picked activity
        jev_request["duration"] = build_duration_request(req, picked, model)
        log.debug("    Prompt #2: %s", json.dumps(jev_request["duration"], ensure_ascii=False))
        t = time.perf_counter()
        if live:
            jev_answers["duration"], model = call_jev(jev_request["duration"])
        else:
            jev_answers["duration"] = mock_durations(req, picked)
        log.info("[3] Ask Jev #2 (how long)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer #2: %s", json.dumps(jev_answers["duration"], ensure_ascii=False))
        picks = assemble(req, picked, jev_answers["activity"], jev_answers["duration"])
        log.info("    %s", " · ".join(f"{p.variant_id} → {p.duration_min} min" for p in picks))
    except (JevError, AnswerError) as e:
        log.warning("    ✗ Failed: %s", e)
        db.log_suggestion(
            user_id=req.user_id, source=source, model=model, request=req.model_dump(),
            jev_request=jev_request, jev_answers=jev_answers or None, result=None, error=str(e),
        )
        raise HTTPException(502, str(e)) from e

    log_id = db.log_suggestion(
        user_id=req.user_id, source=source, model=model, request=req.model_dump(),
        jev_request=jev_request, jev_answers=jev_answers, result=[p.model_dump() for p in picks], error=None,
    )
    log.info("[4] Sent to app: lead %s %d min; backups %s",
             picks[0].variant_id, picks[0].duration_min, ", ".join(p.variant_id for p in picks[1:]) or "none")
    log.info("    Saved as suggestion_log #%d", log_id)
    return SuggestResponse(
        source=source, model=model, lead=picks[0], backups=picks[1:],
        jev_request=jev_request, jev_answers=jev_answers, log_id=log_id,
    )


@app.post("/api/suggest/table", response_model=TableSuggestResponse)
def suggest_from_table(req: TableSuggestRequest) -> TableSuggestResponse:
    """The same job as /api/suggest, with the options taken from the activity table.

    The app doesn't send options. It sends what the user picked before (picked_codes)
    and the backend finds today's candidates in the table, then asks Jev three times.
    """
    c = req.check_in
    # What the user likes = the headings of the activities they picked before. None picked: no preference.
    liked = activities.headings_of(req.picked_codes)
    ceilings = [m for m in (VIGOROUS_MET if req.limits.no_vigorous else None, req.below_met) if m is not None]
    rows = activities.candidates(
        c.place, headings=liked, exclude_headings=req.exclude_headings,
        min_met=req.min_met, below_met=min(ceilings) if ceilings else None,
    )
    if not rows or not req.durations:
        raise HTTPException(422, "No activity in the table fits today; the app keeps its own pick in this case")

    live = has_api_key()
    source = "jev" if live else "mock"
    model = jev_model() if live else "mock"
    # The calls are logged together: {"heading": ..., "activity": ..., "duration": ...}
    jev_request: Dict[str, Any] = {}
    jev_answers: Dict[str, Any] = {}

    by_heading = group_by_heading(rows)
    state = build_table_state(req, liked)
    log.info("── POST /api/suggest/table  user=%s  (Jev: %s) ──", req.user_id, model)
    log.info("[1] Check-in: %d min · %s · energy=%s · mood=%s", c.minutes, c.place, c.energy, c.mood_name or c.mood)
    log.info("    Need %.2f MET-h today · picked before: %s", req.needed_met_hours, ", ".join(liked) or "nothing yet")
    log.info("    %d candidates in the table: %s", len(rows), " · ".join(f"{h} {len(r)}" for h, r in by_heading.items()))
    try:
        # Call 1: which heading. With one heading there is nothing to choose, so Jev isn't asked.
        if len(by_heading) > 1:
            jev_request["heading"] = build_heading_request(state, by_heading, liked, model)
            log.debug("    Prompt #1: %s", json.dumps(jev_request["heading"], ensure_ascii=False))
            t = time.perf_counter()
            if live:
                jev_answers["heading"], model = call_jev(jev_request["heading"])
            else:
                jev_answers["heading"] = mock_heading(by_heading, liked)
            log.info("[2] Ask Jev #1 (which heading)… %.1fs", time.perf_counter() - t)
            log.debug("    Answer #1: %s", json.dumps(jev_answers["heading"], ensure_ascii=False))
            ranked = rank_headings(jev_answers["heading"], list(by_heading))
            log.info("    %s", " · ".join(f"{h} {p:.2f}" for h, p in ranked[:HEADINGS_TO_ASK]))
        else:
            ranked = [(next(iter(by_heading)), 1.0)]
            log.info("[2] Only one heading fits today (%s), so Jev #1 is skipped", ranked[0][0])
        top = ranked[:HEADINGS_TO_ASK]

        # Call 2: which activity, in each of the top headings
        jev_request["activity"] = build_table_activity_request(state, {h: by_heading[h] for h, _ in top}, model)
        log.debug("    Prompt #2: %s", json.dumps(jev_request["activity"], ensure_ascii=False))
        t = time.perf_counter()
        if live:
            jev_answers["activity"], model = call_jev(jev_request["activity"])
        else:
            jev_answers["activity"] = mock_table_activities(req, {h: by_heading[h] for h, _ in top})
        log.info("[3] Ask Jev #2 (which activity in each heading)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer #2: %s", json.dumps(jev_answers["activity"], ensure_ascii=False))
        picked = pick_from_table(top, jev_answers["activity"], by_heading)
        for h, _ in top:
            log.info("    %s: %s", h, _top(jev_answers["activity"][table_activity_question(h)]))

        # Call 3: how long, for each picked activity
        picked_rows = [row for row, _, _ in picked]
        jev_request["duration"] = build_table_duration_request(req, state, picked_rows, model)
        log.debug("    Prompt #3: %s", json.dumps(jev_request["duration"], ensure_ascii=False))
        t = time.perf_counter()
        if live:
            jev_answers["duration"], model = call_jev(jev_request["duration"])
        else:
            jev_answers["duration"] = mock_table_durations(req, picked_rows)
        log.info("[4] Ask Jev #3 (how long)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer #3: %s", json.dumps(jev_answers["duration"], ensure_ascii=False))
        picks = assemble_table(req, picked, jev_answers["duration"], liked)
        log.info("    %s", " · ".join(f"{p.activity_code} → {p.duration_min} min" for p in picks))
    except (JevError, AnswerError) as e:
        log.warning("    ✗ Failed: %s", e)
        db.log_suggestion(
            user_id=req.user_id, source=source, model=model, request=req.model_dump(),
            jev_request=jev_request, jev_answers=jev_answers or None, result=None, error=str(e),
        )
        raise HTTPException(502, str(e)) from e

    log_id = db.log_suggestion(
        user_id=req.user_id, source=source, model=model, request=req.model_dump(),
        jev_request=jev_request, jev_answers=jev_answers, result=[p.model_dump() for p in picks], error=None,
    )
    lead = picks[0]
    log.info("[5] Sent to app: lead %s (%s) %d min; backups %s", lead.activity_code, lead.activity_description,
             lead.duration_min, ", ".join(p.activity_code for p in picks[1:]) or "none")
    log.info("    Saved as suggestion_log #%d", log_id)
    return TableSuggestResponse(
        source=source, model=model, lead=lead, backups=picks[1:], candidate_count=len(rows),
        jev_request=jev_request, jev_answers=jev_answers, log_id=log_id,
    )


def _short(text: str, limit: int = 80) -> str:
    """A message on one terminal line."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _fixed_reply(name: str, stopped_by: str, step: int) -> PlainTextResponse:
    """A message that was stopped: the user reads the fixed reply, and no model writes."""
    _, replies, _ = _chat_content()
    log.info("[%d] Sent to app: fixed reply \"%s\"", step, name)
    return PlainTextResponse(replies[name], headers={CHAT_STOPPED_BY: stopped_by, CHAT_REPLY: name})


@app.post("/api/chat")
def chat(req: ChatRequest):
    """One Chat message in, the reply out as plain text.

    The last user message goes through two checks before any model writes:
      1. urgent keywords (chat_rules.py): a match gets the fixed "urgent" reply, and Jev isn't asked
      2. Jev's three yes/no questions (chat_gate.py): urgent, medical advice, or off topic gets its fixed reply
    A message that passes both goes to the model that writes (chat_writer.py), and its reply is streamed.
    The model's system prompt is the Chat brief, then what the app sent as `system` (chat_prompt.py).

    Two response headers say what happened: X-Chat-Stopped-By and X-Chat-Reply.
    """
    messages = [m.model_dump() for m in req.messages]
    try:
        message = chat_gate.latest_user_message(messages)
    except chat_gate.GateError as e:
        raise HTTPException(422, str(e)) from e
    keywords, replies, brief = _chat_content()

    live = has_api_key()
    model = jev_model() if live else "mock"
    log.info("── POST /api/chat  (Jev: %s · writer: %s) ──", model, chat_writer.name())
    log.info("[1] Message: \"%s\"", _short(message))

    # Check 1: urgent keywords. A match stops here.
    match = chat_rules.check(message, keywords)
    if match:
        log.info("[2] Urgent keywords: matched \"%s\" (%s)", match.matched, match.group)
        return _fixed_reply(chat_rules.REPLY, "keywords", step=3)
    log.info("[2] Urgent keywords: no match")

    # Check 2: Jev's three questions. If Jev can't be asked, the message is not passed on unchecked.
    try:
        jev_request = chat_gate.build_request(messages, model)
        log.debug("    Prompt: %s", json.dumps(jev_request, ensure_ascii=False))
        t = time.perf_counter()
        if live:
            answers, model = call_jev(jev_request)
        else:
            answers = chat_gate.mock_answers(messages)
        log.info("[3] Ask Jev (urgent? medical advice? about health or the app?)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer: %s", json.dumps(answers, ensure_ascii=False))
        decision = chat_gate.decide(answers)
    except (JevError, chat_gate.GateError) as e:
        log.warning("    ✗ Failed: %s", e)
        raise HTTPException(502, str(e)) from e
    log.info("    %s", " · ".join(f"{name} {p:.2f}" for name, p in decision.probabilities.items()))
    if decision.reply:
        return _fixed_reply(decision.reply, "jev", step=4)

    # Both checks passed: the model that writes answers, and each piece goes to the app as it comes.
    system = chat_prompt.build_system(brief, replies, req.system)
    log.debug("    System prompt: %s", system)
    log.info("[4] Passed both checks. Writing (%s)…", chat_writer.name())
    t = time.perf_counter()
    reply = chat_writer.write(system, messages)
    # Wait for the first piece before answering, so a wrong key or model is an error, not an empty reply.
    try:
        first = next(reply)
    except StopIteration:
        log.warning("    ✗ Failed: the chat model sent no text")
        raise HTTPException(502, "The chat model sent no text") from None
    except chat_writer.WriterError as e:
        log.warning("    ✗ Failed: %s", e)
        raise HTTPException(502, str(e)) from e

    def pieces() -> Iterator[str]:
        sent = len(first)
        yield first
        try:
            for piece in reply:
                sent += len(piece)
                yield piece
        except chat_writer.WriterError as e:
            # Too late for an error status: the first words are already on the user's screen.
            log.warning("    ✗ Failed after %d characters: %s", sent, e)
            return
        log.info("[5] Sent to app: %d characters in %.1fs", sent, time.perf_counter() - t)

    return StreamingResponse(
        pieces(), media_type="text/plain; charset=utf-8",
        headers={CHAT_STOPPED_BY: "none", CHAT_REPLY: "model"},
    )


@app.get("/api/state")
def get_state(user_id: str = "demo") -> Dict[str, Any]:
    return {"state": db.load_state(user_id)}


@app.put("/api/state")
def put_state(state: Dict[str, Any] = Body(...), user_id: str = "demo") -> Dict[str, bool]:
    db.save_state(user_id, state)
    return {"ok": True}


@app.delete("/api/state")
def delete_state(user_id: str = "demo") -> Dict[str, bool]:
    db.clear_state(user_id)
    return {"ok": True}


@app.get("/api/suggestions/log")
def suggestion_log(limit: int = 20) -> Dict[str, Any]:
    return {"items": db.recent_suggestions(min(max(limit, 1), 200))}


@app.get("/api/activities")
def list_activities(
    place: Optional[str] = None,
    heading: List[str] = Query(default=[]),
    recommended: bool = True,
) -> Dict[str, Any]:
    """The activity table, so the frontend can read it instead of keeping its own copy.

    /api/activities                                   every activity marked to recommend
    /api/activities?place=gym                         only those that can be done at the gym
    /api/activities?heading=Bicycling&heading=Walking only these major_headings
    /api/activities?recommended=false                 every row of the table

    Each activity has the same columns as the CSV; activity_code is its id.
    """
    if place is not None and place not in activities.PLACE_COLUMN:
        raise HTTPException(422, f"Unknown place '{place}'. The table has: {', '.join(activities.PLACE_COLUMN)}")
    rows = activities.catalog(recommended=recommended, headings=heading, place=place)
    return {"count": len(rows), "activities": rows}


# --- Real Fitbit (Google Health API) ------------------------------------------
# The app opens /connect in a new tab and checks /status until it says connected,
# so the page the user was on (onboarding, Preferences) keeps its place.

OAUTH_COOKIE = "pha_fitbit_oauth"


def _done_page(message: str) -> HTMLResponse:
    """What the sign-in tab shows at the end. It tries to close itself."""
    text = html.escape(message)
    return HTMLResponse(
        f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
        f"<title>VO2 Max Pal</title><body style='font-family:system-ui;padding:24px;line-height:1.5'>"
        f"<p>{text}</p><p>You can close this tab and go back to VO2 Max Pal.</p>"
        f"<script>setTimeout(() => window.close(), 1500)</script>"
    )


@app.get("/api/fitbit/status")
def fitbit_status(user_id: str = "demo") -> Dict[str, bool]:
    return {"configured": gh.has_credentials(), "connected": db.load_fitbit_tokens(user_id) is not None}


@app.get("/api/fitbit/connect")
def fitbit_connect(user_id: str = "demo") -> RedirectResponse:
    if not gh.has_credentials():
        raise HTTPException(503, "Real Fitbit isn't set up: add GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET to backend/.env")
    state = secrets.token_urlsafe(24)
    res = RedirectResponse(gh.consent_url(state))
    # The callback checks it, so only a sign-in this browser started can save tokens.
    res.set_cookie(OAUTH_COOKIE, f"{user_id}|{state}", max_age=600, httponly=True, samesite="lax")
    return res


@app.get("/api/fitbit/callback", response_class=HTMLResponse)
def fitbit_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None,
                    error: Optional[str] = None) -> HTMLResponse:
    user_id, _, expected = (request.cookies.get(OAUTH_COOKIE) or "").rpartition("|")
    if error:
        log.info("── Fitbit sign-in for %s stopped: %s ──", user_id or "?", error)
        return _done_page(f"Fitbit wasn't connected ({error}).")
    if not code or not state or not expected or not secrets.compare_digest(state, expected):
        raise HTTPException(400, "This sign-in didn't start from the app, or took over 10 minutes. Start again from the app.")
    try:
        tokens = gh.exchange_code(code)
        if gh.SCOPE not in tokens["scope"].split():
            return _done_page("Fitbit wasn't connected: the app needs access to your activity and fitness data.")
        gh.check_linked(tokens["access_token"])
    except gh.GoogleHealthError as e:
        log.warning("    ✗ Fitbit sign-in failed: %s", e)
        if e.status == 409:  # written for the user: the account has no Fitbit linked
            return _done_page(f"Fitbit wasn't connected: {e}")
        # Google's reply goes to the log above, not to the user.
        return _done_page("Fitbit wasn't connected because Google returned an error. Try connecting again.")
    db.save_fitbit_tokens(user_id, tokens)
    log.info("── Fitbit connected for %s ──", user_id)
    page = _done_page("Your Fitbit is connected.")
    page.delete_cookie(OAUTH_COOKIE)
    return page


@app.get("/api/fitbit/sync")
def fitbit_sync(since: date, user_id: str = "demo") -> Dict[str, Any]:
    tokens = db.load_fitbit_tokens(user_id)
    if not tokens:
        raise HTTPException(401, "Fitbit isn't connected")
    try:
        fresh = gh.fresh_tokens(tokens)
        if fresh is not tokens:
            db.save_fitbit_tokens(user_id, fresh)
        data = gh.fetch_data(fresh["access_token"], since)
    except gh.GoogleHealthError as e:
        log.warning("    ✗ Fitbit sync failed: %s", e)
        if e.status == 401:
            # The refresh token is gone (7 days in Testing mode, or access removed): the user has to reconnect.
            db.clear_fitbit_tokens(user_id)
        raise HTTPException(e.status, str(e)) from e
    log.info("── GET /api/fitbit/sync  user=%s since %s: %d workouts, %d VO2 max readings ──",
             user_id, since, len(data["workouts"]), len(data["vo2"]))
    return data


@app.delete("/api/fitbit")
def fitbit_disconnect(user_id: str = "demo") -> Dict[str, bool]:
    db.clear_fitbit_tokens(user_id)
    return {"ok": True}
