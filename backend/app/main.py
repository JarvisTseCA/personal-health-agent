"""
FastAPI backend for the Personal Health Agent.

    POST   /api/suggest           check-in variables → Jev: which activity → Jev: how long → pick + 2 backups
    POST   /api/suggest/table     the same, with the options taken from the activity table:
                                  filter the table → Jev: which heading → which activity → how long
    POST   /api/suggest/memory    the same again, from today's check-in alone: the rest is read from Memory
                                  and today's numbers are worked out here (memory_suggest.py, calculator.py)
    POST   /api/chat              a Chat message → urgent keywords → Jev: three yes/no questions →
                                  a fixed reply, or the model that writes. Plain text, streamed
    POST   /api/chat/memory       the same, with what the model is told about the user read from Memory
                                  and worked out here (memory_chat.py). This is the one the app uses
    GET    /api/state             load the saved app state
    PUT    /api/state             save it
    DELETE /api/state             forget it
    GET    /api/memory            what Memory holds about a user, in its seven groups (memory.py)
    POST   /api/memory            add to it or update it: any part of the seven groups
    DELETE /api/memory/{kind}/{key}   take one entry out: a check-in, a suggestion, a workout, a chat message,
                                  or what the app keeps under one name in "other"
    DELETE /api/memory            forget the user
    GET    /api/numbers           every number on the app's screens, worked out from Memory for one day
                                  (memory_numbers.py). The three routes above that read or change Memory
                                  give the same numbers in their reply when the request has ?date=
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
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # our own lines already say when Jev is called
log = logging.getLogger("pha")

from fastapi import Body, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, StreamingResponse  # noqa: E402

from . import (  # noqa: E402
    activities, calculator, chat_gate, chat_prompt, chat_replies, chat_rules, chat_writer, db, memory, memory_chat,
    memory_numbers, memory_suggest,
)
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
    ChatRequest, MemoryChatRequest, MemorySuggestRequest, MemorySuggestResponse, SuggestRequest, SuggestResponse,
    TableSuggestRequest, TableSuggestResponse,
)
from .suggest import (  # noqa: E402
    HEADINGS_TO_ASK, RECENT_DAYS, AnswerError, assemble, assemble_table, pick_activities, pick_from_table, rank_headings,
)

VIGOROUS_MET = 6.0  # "no vigorous activity" means under this, as in the app (src/lib/met.ts)

# What POST /api/chat and POST /api/chat/memory tell the app besides the reply text, as response headers.
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


def allowed_origins() -> List[str]:
    """Sites besides localhost that may call the backend, from ALLOWED_ORIGINS (comma-separated),
    e.g. "https://jarvistseca.github.io" for the GitHub Pages demo. Paths and trailing slashes are
    not part of an origin, so they're dropped."""
    raw = os.environ.get("ALLOWED_ORIGINS", "")
    out = []
    for item in raw.split(","):
        item = item.strip().rstrip("/")
        if item:
            scheme, sep, rest = item.partition("://")
            out.append(f"{scheme}{sep}{rest.split('/')[0]}" if sep else item)
    return out


app = FastAPI(title="Personal Health Agent backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
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

    The app doesn't send options. The backend finds today's candidates in the table, then asks
    Jev three times. What the user likes (liked_categories, picked_codes) ranks higher in the
    prompts and in the mock; it never limits the candidates, so new activities still come up.
    """
    c = req.check_in
    # The headings of the activities picked before, favorites first. Named to Jev; not a filter.
    liked = activities.headings_of(req.picked_codes)
    ceilings = [m for m in (VIGOROUS_MET if req.limits.no_vigorous else None, req.below_met) if m is not None]
    rows = activities.candidates(
        c.place, exclude_headings=req.exclude_headings, exclude_codes=req.exclude_codes,
        indoor_only=req.indoor_only, min_met=req.min_met, below_met=min(ceilings) if ceilings else None,
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
    named_codes = [x.code for x in [*req.recent, *req.declines] if x.code]
    state = build_table_state(req, liked, activities.descriptions_of(named_codes))
    log.info("── POST /api/suggest/table  user=%s  (Jev: %s) ──", req.user_id, model)
    log.info("[1] Check-in: %d min · %s · energy=%s · mood=%s", c.minutes, c.place, c.energy, c.mood_name or c.mood)
    log.info("    Need %.2f MET-h today · picked before: %s · 👍 %s", req.needed_met_hours,
             ", ".join(liked) or "nothing yet", ", ".join(req.liked_categories) or "none")
    if req.exclude_codes or req.indoor_only:
        log.info("    Ruled out today: %s%s", ", ".join(req.exclude_codes) or "no activity",
                 " · indoors only" if req.indoor_only else "")
    log.info("    %d candidates in the table: %s", len(rows), " · ".join(f"{h} {len(r)}" for h, r in by_heading.items()))
    try:
        # Call 1: which heading. With one heading there is nothing to choose, so Jev isn't asked.
        if len(by_heading) > 1:
            jev_request["heading"] = build_heading_request(state, by_heading, liked, model, req.liked_categories)
            log.debug("    Prompt #1: %s", json.dumps(jev_request["heading"], ensure_ascii=False))
            t = time.perf_counter()
            if live:
                jev_answers["heading"], model = call_jev(jev_request["heading"])
            else:
                jev_answers["heading"] = mock_heading(by_heading, liked, req.liked_categories)
            log.info("[2] Ask Jev #1 (which heading)… %.1fs", time.perf_counter() - t)
            log.debug("    Answer #1: %s", json.dumps(jev_answers["heading"], ensure_ascii=False))
            ranked = rank_headings(jev_answers["heading"], list(by_heading))
            log.info("    %s", " · ".join(f"{h} {p:.2f}" for h, p in ranked[:HEADINGS_TO_ASK]))
        else:
            ranked = [(next(iter(by_heading)), 1.0)]
            log.info("[2] Only one heading fits today (%s), so Jev #1 is skipped", ranked[0][0])
        top = ranked[:HEADINGS_TO_ASK]

        # Call 2: which activity, in each of the top headings
        jev_request["activity"] = build_table_activity_request(
            state, {h: by_heading[h] for h, _ in top}, model, req.picked_codes
        )
        log.debug("    Prompt #2: %s", json.dumps(jev_request["activity"], ensure_ascii=False))
        t = time.perf_counter()
        if live:
            jev_answers["activity"], model = call_jev(jev_request["activity"])
        else:
            jev_answers["activity"] = mock_table_activities(req, {h: by_heading[h] for h, _ in top})
        log.info("[3] Ask Jev #2 (which activity in each heading)… %.1fs", time.perf_counter() - t)
        log.debug("    Answer #2: %s", json.dumps(jev_answers["activity"], ensure_ascii=False))
        # Movements done in the last couple of days (by their table code) aren't picked again if anything else fits.
        recent_families = activities.families_of([r.code for r in req.recent if r.code and r.days_ago <= RECENT_DAYS])
        if recent_families:
            log.info("    Not repeating: %s", ", ".join(recent_families))
        picked = pick_from_table(top, jev_answers["activity"], by_heading, recent_families)
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


@app.post("/api/suggest/memory", response_model=MemorySuggestResponse)
def suggest_from_memory(req: MemorySuggestRequest) -> MemorySuggestResponse:
    """A suggestion from today's check-in alone. Everything else about the user is read from Memory.

    The check-in is stored in Memory. The goal, plan and workouts there give today's numbers
    (calculator.py); the likes, picks and declines there fill in the rest (memory_suggest.py).
    Then it is /api/suggest/table. The numbers come back with the suggestion, so an app that
    uses this route shows them and doesn't work out its own. This is the route the app uses
    for Today's pick whenever it runs with the backend.
    """
    today = _day(req.date)
    c = req.check_in
    memory.save(req.user_id, {"daily": {"check_ins": [
        {"date": today.isoformat(), "minutes": c.minutes, "place": c.place, "energy": c.energy, "mood": c.mood},
    ]}})
    try:
        table_req, numbers = memory_suggest.build_request(req.user_id, c, today, want_more=req.want_more)
    except memory_suggest.NotEnoughMemory as e:
        raise HTTPException(422, str(e)) from e

    log.info("── POST /api/suggest/memory  user=%s  %s %s ──", req.user_id, numbers["day_name"], today.isoformat())
    log.info("[0] From Memory: goal %.2f MET-h · done this week %.2f · today's target %.2f, still needed %.2f",
             numbers["weekly_goal_met_hours"], numbers["done_this_week_met_hours"],
             numbers["target_met_hours"], numbers["needed_met_hours"])
    log.info("    👍 %s · left out: %s · picked here before: %s", ", ".join(table_req.liked_categories) or "none",
             ", ".join([*table_req.exclude_headings, *table_req.exclude_codes]) or "nothing",
             ", ".join(table_req.picked_codes) or "nothing yet")
    result = suggest_from_table(table_req).model_dump()
    for pick in [result["lead"], *result["backups"]]:  # what each one would add toward the goal
        pick["met_hours"] = calculator.credit(pick["met_value"], pick["duration_min"])
    return MemorySuggestResponse(**result, today=numbers)


def _short(text: str, limit: int = 80) -> str:
    """A message on one terminal line."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _fixed_reply(name: str, stopped_by: str, step: int) -> PlainTextResponse:
    """A message that was stopped: the user reads the fixed reply, and no model writes."""
    _, replies, _ = _chat_content()
    log.info("[%d] Sent to app: fixed reply \"%s\"", step, name)
    return PlainTextResponse(replies[name], headers={CHAT_STOPPED_BY: stopped_by, CHAT_REPLY: name})


def _answer_chat(route: str, messages: List[Dict[str, str]], system_prompt: Callable[[str, Dict[str, str]], str]):
    """What both Chat routes do with a conversation: one message in, the reply out as plain text.

    The last user message goes through two checks before any model writes:
      1. urgent keywords (chat_rules.py): a match gets the fixed "urgent" reply, and Jev isn't asked
      2. Jev's three yes/no questions (chat_gate.py): urgent, medical advice, or off topic gets its fixed reply
    A message that passes both goes to the model that writes (chat_writer.py), and its reply is streamed.

    `system_prompt(brief, replies)` gives that model's system prompt. It is asked for only once a
    message has passed both checks, so nothing about the user is read for a message that is stopped.

    Two response headers say what happened: X-Chat-Stopped-By and X-Chat-Reply.
    """
    try:
        message = chat_gate.latest_user_message(messages)
    except chat_gate.GateError as e:
        raise HTTPException(422, str(e)) from e
    keywords, replies, brief = _chat_content()

    live = has_api_key()
    model = jev_model() if live else "mock"
    log.info("── POST %s  (Jev: %s · writer: %s) ──", route, model, chat_writer.name())
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
    log.info("[4] Passed both checks. Writing (%s)…", chat_writer.name())
    system = system_prompt(brief, replies)
    log.debug("    System prompt: %s", system)
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


@app.post("/api/chat")
def chat(req: ChatRequest):
    """A Chat message answered with what the caller says about the user: the two checks, then a fixed reply or the model.

    The model's system prompt is the Chat brief, then what was sent as `system` (chat_prompt.py).
    The app itself uses POST /api/chat/memory below; this one is for trying the checks and the model on their own.
    """
    messages = [m.model_dump() for m in req.messages]
    return _answer_chat("/api/chat", messages, lambda brief, replies: chat_prompt.build_system(brief, replies, req.system))


@app.post("/api/chat/memory")
def chat_from_memory(req: MemoryChatRequest):
    """A Chat message answered with what Memory holds about the user: the two checks, then a fixed reply or the model.

    The app sends the recent conversation, who the user is and which day it is for them. For a message
    that passes both checks, the backend reads the user from Memory and works their numbers out
    (memory_chat.py): the same numbers the screens show. The model's system prompt is the Chat brief,
    then that data. Feedback from the user's clinician is the one thing the app sends along itself
    (`clinician_notes`): it keeps those in its own part of Memory, which the backend doesn't read.

    The conversation itself is kept in Memory's "chat" group. The app saves it there message by
    message, through POST /api/memory; this route stores nothing.
    """
    today = _day(req.date)  # a date that can't be read stops the request before any check runs
    messages = [m.model_dump() for m in req.messages]
    notes = [n.model_dump() for n in req.clinician_notes]

    def system_prompt(brief: str, replies: Dict[str, str]) -> str:
        data = memory_chat.user_data(req.user_id, today, notes)
        log.info("    The user's data, from Memory: %s", memory_chat.summary(data))
        return chat_prompt.build_system(brief, replies, user_data=data)

    return _answer_chat("/api/chat/memory", messages, system_prompt)


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


# --- Memory: what the backend remembers about a user, in seven groups (memory.py) --------------
# When the app finds the backend running, these are what it uses: it reads Memory when it opens,
# tells it what changed after every step, and shows the numbers that come back. It no longer
# saves its state in one piece through /api/state above; that is only read once, to bring an
# earlier save over into Memory.
#
# `date` on these routes is the user's today, "2026-11-25". A request that has it gets the
# numbers for that day in its reply as well (see _numbers below), worked out after the change.


def _day(value: Optional[str]) -> date:
    """The user's today as they sent it; left out, the date on the backend's own clock."""
    try:
        return date.fromisoformat(value) if value else date.today()
    except ValueError:
        raise HTTPException(422, f"date {value!r} is not a date like 2026-11-23") from None


def _numbers(user_id: str, day: date) -> Dict[str, Any]:
    """{"numbers": ...}: every number on the app's screens for that day, from Memory (memory_numbers.py).

    Before a weekly goal and plan are saved there is nothing to work out:
    then "numbers" is null and "numbers_missing" says what Memory still needs.
    """
    try:
        return {"numbers": memory_numbers.for_user(user_id, day)}
    except memory_suggest.NotEnoughMemory as e:
        return {"numbers": None, "numbers_missing": str(e)}


@app.get("/api/memory")
def get_memory(
    user_id: str = "demo", group: Optional[List[str]] = Query(None), day: Optional[str] = Query(None, alias="date"),
) -> Dict[str, Any]:
    """Read. All seven groups, or only the ones asked for: ?group=preferences&group=daily.

    Without ?date=: everything Memory holds, however far back it goes.
    With ?date=: what the app is given. Memory from this week and the 26 before it
    (memory_numbers.recent), and the numbers too.
    """
    today = _day(day) if day else None  # a date that can't be read stops the request here
    try:
        mem = memory.read(user_id, group)
    except memory.MemoryDataError as e:
        raise HTTPException(422, str(e)) from e
    if today is None:
        return {"memory": mem}
    return {"memory": memory_numbers.recent(mem, today), **_numbers(user_id, today)}


@app.post("/api/memory")
def post_memory(
    part: Dict[str, Any] = Body(...), user_id: str = "demo", day: Optional[str] = Query(None, alias="date"),
) -> Dict[str, Any]:
    """Add or update. Send any part of the seven groups; what is left out stays as it is.

    Entries under "daily", "health" and "chat" are added (or replace the one with the same key);
    "who", "preferences" and a week's goal and plan are updated; each name under "other" is
    replaced by what is sent. The shape is at the top of memory.py.

    With ?date=, the reply also has the numbers as they are after this save.
    """
    today = _day(day)  # a date that can't be read stops the request before anything is saved
    try:
        memory.save(user_id, part)
    except memory.MemoryDataError as e:
        raise HTTPException(422, str(e)) from e
    return {"ok": True, **_numbers(user_id, today)} if day else {"ok": True}


@app.delete("/api/memory/{kind}/{key}")
def delete_memory_entry(
    kind: str, key: str, user_id: str = "demo", day: Optional[str] = Query(None, alias="date"),
) -> Dict[str, Any]:
    """Delete one entry: /api/memory/suggestions/<id>, /api/memory/workouts/<id>, /api/memory/check_ins/<date>,
    /api/memory/chat/<id>, or /api/memory/other/<name> for what the app keeps under that name.

    With ?date=, the reply also has the numbers as they are without it.
    """
    today = _day(day)
    try:
        found = memory.delete(user_id, kind, key)
    except memory.MemoryDataError as e:
        raise HTTPException(422, str(e)) from e
    if not found:
        raise HTTPException(404, f"This user has no {kind} entry '{key}'")
    return {"ok": True, **_numbers(user_id, today)} if day else {"ok": True}


@app.delete("/api/memory")
def delete_memory(user_id: str = "demo") -> Dict[str, bool]:
    """Forget everything Memory holds about this user."""
    memory.clear(user_id)
    return {"ok": True}


@app.get("/api/numbers")
def get_numbers(user_id: str = "demo", day: Optional[str] = Query(None, alias="date")) -> Dict[str, Any]:
    """Every number on the app's screens for one day, worked out from Memory. Nothing is saved.

    This week (done, each day's target, today's share), the streak, the trophies, the past
    weeks and months, the goal offer, the Summary page and VO2 max: the shape is at the top
    of memory_numbers.py. `date` is the user's today; left out, the backend's own date.
    """
    return _numbers(user_id, _day(day))


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
    if place is not None and place not in activities.PLACE_WHERE:
        raise HTTPException(422, f"Unknown place '{place}'. Places: {', '.join(activities.PLACE_WHERE)}")
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
