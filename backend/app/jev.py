"""
Calls Jev (TypeSafe AI's System One model), or a local mock with the same
answer format when no API key is set.

Live: POST https://api.typesafe.ai/v1/systemone with a Bearer token.
Each Choice answer looks like:
    {"type": "choice", "choice": "yoga-power", "confidence": 0.8,
     "probabilities": {"yoga-power": 0.72, "cycling-easy": 0.2, ...}}
"""
import math
import os
from typing import Any, Dict, List, Tuple

import httpx

from .prompt import duration_question
from .schemas import Option, SuggestRequest

JEV_URL = os.environ.get("JEV_URL", "https://api.typesafe.ai/v1/systemone")
JEV_TIMEOUT_S = 20.0


class JevError(Exception):
    pass


def jev_model() -> str:
    return os.environ.get("JEV_MODEL", "jev-latest")


def has_api_key() -> bool:
    return bool(os.environ.get("TYPESAFE_API_KEY"))


def call_jev(body: Dict[str, Any]) -> Tuple[Dict[str, dict], str]:
    """Send the prompt to Jev. Returns (answers, model)."""
    headers = {"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"}
    try:
        res = httpx.post(JEV_URL, json=body, headers=headers, timeout=JEV_TIMEOUT_S)
    except httpx.HTTPError as e:
        raise JevError(f"Could not reach Jev: {e}") from e
    if res.status_code != 200:
        raise JevError(f"Jev returned {res.status_code}: {res.text[:500]}")
    data = res.json()
    return data["answers"], data.get("model", body["model"])


# --- Mock -------------------------------------------------------------------
# Used when TYPESAFE_API_KEY isn't set, so the whole flow runs locally. It
# scores options with a few simple rules and returns Jev-shaped answers. It is
# a stand-in for testing the plumbing, not a model of what Jev would pick.


def _softmax(scores: Dict[str, float]) -> Dict[str, float]:
    m = max(scores.values())
    exp = {k: math.exp(v - m) for k, v in scores.items()}
    total = sum(exp.values())
    return {k: round(v / total, 4) for k, v in exp.items()}


def _choice(scores: Dict[str, float]) -> dict:
    probs = _softmax(scores)
    top = max(probs, key=probs.get)
    return {"type": "choice", "choice": top, "confidence": probs[top], "probabilities": probs}


def mock_activity(req: SuggestRequest) -> Dict[str, dict]:
    """Mock of call 1: which activity."""
    rank = {e.family_id: e.rank for e in req.enjoyed}
    recent = {r.family_id: r.days_ago for r in req.recent}
    n = max(1, len(req.enjoyed))

    activity: Dict[str, float] = {}
    for o in req.options:
        s = 2.0 * (1 - (rank.get(o.family_id, n) - 1) / n)
        if req.check_in.mood == o.family_id:
            s += 2.0
        if recent.get(o.family_id) in (0, 1):
            s -= 1.5
        if req.check_in.energy == "low":
            s -= max(0.0, o.met - 5) * 0.6
        elif req.check_in.energy == "challenge":
            s += 0.6 if o.met >= 6 else -0.3
        activity[o.variant_id] = s
    return {"activity": _choice(activity)}


def mock_durations(req: SuggestRequest, picked: List[Option]) -> Dict[str, dict]:
    """Mock of call 2: for each activity, the duration closest to covering today's need at its MET."""
    answers = {}
    for o in picked:
        want = req.needed_met_hours * (1.5 if req.boost else 1) * 60 / o.met if req.needed_met_hours > 0 else 20
        answers[duration_question(o)] = _choice({str(d): -abs(d - want) / 10 for d in req.durations})
    return answers
