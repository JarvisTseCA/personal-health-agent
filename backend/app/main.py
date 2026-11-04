"""
FastAPI backend for the Personal Health Agent.

    POST   /api/suggest           check-in variables → Jev: which activity → Jev: how long → pick + 2 backups
    GET    /api/state             load the saved app state
    PUT    /api/state             save it
    DELETE /api/state             forget it
    GET    /api/suggestions/log   recent prompts and Jev answers, for prompt tuning
    GET    /api/health            is the backend up, and is Jev live or mocked?

Run from backend/:  uvicorn app.main:app --reload --port 8000
Each /api/suggest prints its steps in that terminal; LOG_LEVEL=DEBUG in .env adds the full JSON.
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # our own lines already say when Jev is called
log = logging.getLogger("pha")

from fastapi import Body, FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from . import db  # noqa: E402
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
