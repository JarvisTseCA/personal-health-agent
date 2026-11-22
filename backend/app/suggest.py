"""
Turns Jev's answers into the suggestion the user sees: one pick and two
backups, each with its own minutes and a few plain reasons.

After call 1 (which activity), `pick_activities`:
- ranks activities by Jev's probability, keeping only the best variant of
  each, so the backups are different activities;
- prefers backups of a different type than the pick (cardio vs. mind-body, ...).

After call 2 (how long), `assemble` gives each picked activity Jev's duration
answer for it, which is always one of the allowed options.

The functions at the bottom do the same for POST /api/suggest/table, where the
options are rows of the activity table and Jev is asked three times: which
heading (`rank_headings`), which activity in each of the top headings
(`pick_from_table`), and how long (`assemble_table`).
"""
from typing import Dict, List, Tuple

from .activities import label_of
from .prompt import Row, duration_question, heading_key, table_activity_question, table_duration_question
from .schemas import Option, Pick, SuggestRequest, TablePick, TableSuggestRequest


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


# --- From the activity table (POST /api/suggest/table) -----------------------

HEADINGS_TO_ASK = 3  # one for the pick and one for each backup


def rank_headings(heading_answers: Dict[str, dict], headings: List[str]) -> List[Tuple[str, float]]:
    """After call 1: the headings we offered, most likely first, each with Jev's probability."""
    by_key = {heading_key(h): h for h in headings}
    probs = _probabilities(heading_answers, "heading", list(by_key))
    return [(by_key[k], round(probs[k], 4)) for k in sorted(probs, key=probs.get, reverse=True)]


def pick_from_table(
    ranked: List[Tuple[str, float]], activity_answers: Dict[str, dict], by_heading: Dict[str, List[Row]]
) -> List[Tuple[Row, float, float]]:
    """After call 2: [lead, backup, backup], each as (row, heading probability, activity probability).

    `ranked` holds the headings asked about in call 2, best first. The lead is
    the best activity of the best heading, and each backup is the best
    activity of the next heading, so the backups are a different kind of
    activity. With fewer than three headings, it goes around again for each
    heading's next best activity.
    """
    lines = []  # per heading: its activities, Jev's favorite first
    for heading, heading_p in ranked:
        rows = {r["activity_code"]: r for r in by_heading[heading]}
        probs = _probabilities(activity_answers, table_activity_question(heading), list(rows))
        best_first = sorted(probs, key=probs.get, reverse=True)
        lines.append([(rows[code], heading_p, round(probs[code], 4)) for code in best_first])

    picked: List[Tuple[Row, float, float]] = []
    place = 0  # 0 = each heading's best activity, 1 = each heading's second best, ...
    while len(picked) < HEADINGS_TO_ASK and any(place < len(line) for line in lines):
        for line in lines:
            if place < len(line) and len(picked) < HEADINGS_TO_ASK:
                picked.append(line[place])
        place += 1
    return picked


def table_reasons(row: Row, req: TableSuggestRequest, liked: List[str]) -> List[str]:
    out: List[str] = []
    if row["activity_code"] in {str(c).strip().zfill(5) for c in req.picked_codes}:
        out.append("You picked this before")
    elif row["major_heading"] in liked:
        out.append("A kind of activity you picked before")
    if row["major_heading"] in req.liked_categories:
        out.append(f"You like {row['major_heading']}")
    if req.check_in.energy == "low" and row["met_value"] <= 5:
        out.append("Easy on a low-energy day")
    elif (req.check_in.energy == "challenge" or req.boost) and row["met_value"] >= 6:
        out.append("A challenge, like you asked")
    out.append(f"Fits in {req.check_in.minutes} min")
    return out


def assemble_table(
    req: TableSuggestRequest,
    picked: List[Tuple[Row, float, float]],
    duration_answers: Dict[str, dict],
    liked: List[str],
) -> List[TablePick]:
    """After call 3: each picked activity with its own minutes and what the app needs to show it."""
    allowed = [str(d) for d in req.durations]
    picks = []
    for row, heading_p, activity_p in picked:
        duration = _probabilities(duration_answers, table_duration_question(row), allowed)
        picks.append(
            TablePick(
                activity_code=row["activity_code"],
                major_heading=row["major_heading"],
                activity_description=row["activity_description"],
                label=label_of(row["activity_description"]),
                places=[name for name, column in (("gym", "loc_gym"), ("home", "at_home"), ("outside", "loc_outside")) if row[column]],
                met_value=row["met_value"],
                duration_min=int(max(duration, key=duration.get)),
                heading_probability=heading_p,
                probability=activity_p,
                reasons=table_reasons(row, req, liked),
            )
        )
    return picks
