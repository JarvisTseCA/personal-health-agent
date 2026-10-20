"""
Turns Jev's answers into the suggestion the user sees: one pick and two
backups, each with its own minutes and a few plain reasons.

After call 1 (which activity), `pick_activities`:
- ranks activities by Jev's probability, keeping only the best variant of
  each, so the backups are different activities;
- prefers backups of a different type than the pick (cardio vs. mind-body, ...).

After call 2 (how long), `assemble` gives each picked activity Jev's duration
answer for it, which is always one of the allowed options.
"""
from typing import Dict, List

from .prompt import duration_question
from .schemas import Option, Pick, SuggestRequest


class AnswerError(Exception):
    pass


def _probabilities(answers: Dict[str, dict], name: str, allowed: List[str]) -> Dict[str, float]:
    a = answers.get(name)
    if not a or "probabilities" not in a:
        raise AnswerError(f"Jev's answer has no '{name}' probabilities")
    probs = {k: float(v) for k, v in a["probabilities"].items() if k in allowed}
    if not probs:
        raise AnswerError(f"None of Jev's '{name}' options match the ones we sent")
    return probs


def reasons_for(o: Option, req: SuggestRequest) -> List[str]:
    rank = {e.family_id: e.rank for e in req.enjoyed}
    recent = [r.days_ago for r in req.recent if r.family_id == o.family_id]
    out: List[str] = []
    if req.check_in.mood == o.family_id:
        out.append("What you're in the mood for")
    if rank.get(o.family_id) == 1:
        out.append("Your favorite")
    elif rank.get(o.family_id) == 2:
        out.append("Your second favorite")
    if req.check_in.energy == "low" and o.met <= 5:
        out.append("Easy on a low-energy day")
    elif req.check_in.energy == "challenge" and o.met >= 6:
        out.append("A challenge, like you asked")
    out.append(f"Fits in {req.check_in.minutes} min")
    if not recent or min(recent) > 2:
        out.append("Not done in the last few days")
    return out[:3]


def pick_activities(req: SuggestRequest, activity_answers: Dict[str, dict]) -> List[Option]:
    """After call 1: [lead, backup, backup] (fewer if there are fewer activities)."""
    by_id = {o.variant_id: o for o in req.options}
    activity = _probabilities(activity_answers, "activity", list(by_id))

    # Best variant per activity family, highest probability first.
    best: Dict[str, str] = {}
    for vid in sorted(activity, key=activity.get, reverse=True):
        best.setdefault(by_id[vid].family_id, vid)
    ranked = [by_id[v] for v in best.values()]

    lead, rest = ranked[0], ranked[1:]
    different = [o for o in rest if o.kind != lead.kind]
    backups = (different + [o for o in rest if o not in different])[:2]
    return [lead, *backups]


def assemble(
    req: SuggestRequest, picked: List[Option], activity_answers: Dict[str, dict], duration_answers: Dict[str, dict]
) -> List[Pick]:
    """After call 2: each picked activity with its own minutes."""
    activity = _probabilities(activity_answers, "activity", [o.variant_id for o in req.options])
    allowed = [str(d) for d in req.durations]
    picks = []
    for o in picked:
        duration = _probabilities(duration_answers, duration_question(o), allowed)
        picks.append(
            Pick(
                variant_id=o.variant_id,
                family_id=o.family_id,
                duration_min=int(max(duration, key=duration.get)),
                probability=round(activity[o.variant_id], 4),
                reasons=reasons_for(o, req),
            )
        )
    return picks
