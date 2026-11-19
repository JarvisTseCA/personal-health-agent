"""
FastAPI backend for the Personal Health Agent.

    POST   /api/suggest           check-in variables → Jev: which activity → Jev: how long → pick + 2 backups
    GET    /api/state             load the saved app state
    PUT    /api/state             save it
    DELETE /api/state             forget it
    GET    /api/suggestions/log   recent prompts and Jev answers, for prompt tuning
    GET    /api/health            is the backend up, and is Jev live or mocked?
    GET    /api/fitbit/status     is real Fitbit set up (client id in .env), and is this user connected?
    GET    /api/fitbit/connect    → Google's consent page (Google Health API, which replaced the Fitbit Web API)
    GET    /api/fitbit/callback   Google sends the user back here; saves the tokens
    GET    /api/fitbit/sync       workouts and VO2 max readings since a date
    DELETE /api/fitbit            forget this user's Fitbit tokens

Run from backend/:  uvicorn app.main:app --reload --port 8000
Each /api/suggest prints its steps in that terminal; LOG_LEVEL=DEBUG in .env adds the full JSON.
"""
import html
import json
import logging
import os
import secrets
import time
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # our own lines already say when Jev is called
log = logging.getLogger("pha")

from fastapi import Body, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import HTMLResponse, RedirectResponse  # noqa: E402

from . import db  # noqa: E402
from . import google_health as gh  # noqa: E402
from .jev import JevError, call_jev, has_api_key, jev_model, mock_activity, mock_durations  # noqa: E402
from .prompt import build_activity_request, build_duration_request  # noqa: E402
from .schemas import SuggestRequest, SuggestResponse  # noqa: E402
from .suggest import AnswerError, assemble, pick_activities  # noqa: E402

app = FastAPI(title="Personal Health Agent backend")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _top(answer: Dict[str, Any], n: int = 3) -> str:
    """Jev's top choices on one line, e.g. 'cycling-easy 0.72 · yoga-power 0.20'."""
    probs = sorted(answer.get("probabilities", {}).items(), key=lambda kv: -kv[1])[:n]
    return " · ".join(f"{k} {v:.2f}" for k, v in probs)


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "jev": "live" if has_api_key() else "mock", "model": jev_model()}


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
