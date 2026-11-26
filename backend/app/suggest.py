"""
Turns Jev's answers into the suggestion the user sees: one pick and its
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
import hashlib
from typing import Dict, Iterable, List, Optional, Tuple

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

HEADINGS_TO_ASK = 5  # one for the pick and one for each of the four backups
PICKS = 5  # the pick and four backups: "Give me another option" goes through them, then asks for the user's own


def rank_headings(heading_answers: Dict[str, dict], headings: List[str]) -> List[Tuple[str, float]]:
    """After call 1: the headings we offered, most likely first, each with Jev's probability."""
    by_key = {heading_key(h): h for h in headings}
    probs = _probabilities(heading_answers, "heading", list(by_key))
    return [(by_key[k], round(probs[k], 4)) for k in sorted(probs, key=probs.get, reverse=True)]


def pick_from_table(
    ranked: List[Tuple[str, float]], activity_answers: Dict[str, dict], by_heading: Dict[str, List[Row]],
) -> List[Tuple[Row, float, float]]:
    """After call 2: [lead, backup × 4], each as (row, heading probability, activity probability).

    `ranked` holds the headings asked about in call 2, best first. Each pick comes from the next
    heading in turn, so with five headings the five picks are five categories. Within a heading
    Jev's favorite is taken unless it would repeat something; then the next one down that doesn't:

    1. a movement (`family`) already picked, e.g. treadmill walking under Walking and treadmill
       running under Running are different categories but similar;
    2. a kind of workout (`type`) already picked, so the picks aren't all cardio.

    A rule gives way only when no heading has anything left that keeps it. With fewer than five
    headings, it goes around again for each heading's next pick.
    """
    lines = []  # per heading: its activities, Jev's favorite first
    for heading, heading_p in ranked:
        rows = {r["activity_code"]: r for r in by_heading[heading]}
        probs = _probabilities(activity_answers, table_activity_question(heading), list(rows))
        best_first = sorted(probs, key=probs.get, reverse=True)
        lines.append([(rows[code], heading_p, round(probs[code], 4)) for code in best_first])

    family = lambda row: row.get("family") or row["activity_code"]  # noqa: E731  ('' = not given: unique)
    kind = lambda row: row.get("type") or row["activity_code"]  # noqa: E731
    tests = [
        lambda r, fams, kinds: family(r) not in fams and kind(r) not in kinds,
        lambda r, fams, kinds: family(r) not in fams,
        lambda r, fams, kinds: True,
    ]
    picked: List[Tuple[int, int, Tuple[Row, float, float]]] = []  # (round, heading index, pick)
    taken = [0] * len(lines)  # picks from each heading so far
    rounds = max((len(line) for line in lines), default=0)
    # One pick per heading (five categories), then another round if there are fewer headings.
    # Within a round the strictest rule is tried across every heading before it gives way.
    for turn in range(rounds):
        for test in tests:
            for i, line in enumerate(lines):
                if len(picked) >= PICKS:
                    break
                if taken[i] != turn:
                    continue
                fams = {family(p[0]) for _, _, p in picked}
                kinds = {kind(p[0]) for _, _, p in picked}
                chosen = {id(p) for _, _, p in picked}
                x = next((x for x in line if id(x) not in chosen and test(x[0], fams, kinds)), None)
                if x:
                    picked.append((turn, i, x))
                    taken[i] += 1
    # In Jev's order of headings, first round first: the best heading that gave a pick leads.
    return [p for _, _, p in sorted(picked, key=lambda t: (t[0], t[1]))]


# --- Balance across the week, and now and then a category the user hasn't tried -------------

# When at least this many of this week's workouts, and this share of them, are one kind (cardio,
# strength, mind_body, ...), today's lead is the best pick of another kind.
BALANCE_MIN = 3
BALANCE_SHARE = 0.75
# About one check-in in five, one of the five options is a category the user hasn't rated or done.
EXPLORE_CHANCE = 0.2
TYPE_NAMES = {"mind_body": "mind-body", "water": "water activities", "winter": "winter activities"}


def week_types(req: "TableSuggestRequest", types: Dict[str, str]) -> Dict[str, int]:
    """How many of this week's workouts (Monday on) were of each kind. `types`: code → type."""
    from .calculator import DAY_NAMES
    weekday = DAY_NAMES.index(req.day_name) if req.day_name in DAY_NAMES else 6
    counts: Dict[str, int] = {}
    for r in req.recent:
        kind = types.get((r.code or "").strip().zfill(5)) if r.code else None
        if kind and r.days_ago <= weekday:
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def lopsided(counts: Dict[str, int]) -> Optional[str]:
    """The kind of workout this week has been mostly about, if it has: at least 3, and 3 in 4."""
    total = sum(counts.values())
    if not total:
        return None
    kind, n = max(counts.items(), key=lambda kv: kv[1])
    return kind if n >= BALANCE_MIN and n / total >= BALANCE_SHARE else None


def balance_week(picked: List[Tuple[Row, float, float]], dominant: Optional[str]) -> Tuple[List[Tuple[Row, float, float]], bool]:
    """With a lopsided week, the best pick of another kind leads; the others keep their order."""
    if not dominant or not picked or (picked[0][0].get("type") or "") != dominant:
        return picked, False
    other = next((i for i, (row, _, _) in enumerate(picked) if (row.get("type") or "") not in ("", dominant)), None)
    if other is None:
        return picked, False
    return [picked[other], *picked[:other], *picked[other + 1:]], True


def explore_today(req: "TableSuggestRequest") -> bool:
    """About one check-in in five (EXPLORE_CHANCE), the same answer all day for the same user and place."""
    if req.explore is not None:
        return req.explore
    seed = f"{req.user_id}:{req.date or req.day_name}:{req.check_in.place}"
    return int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF < EXPLORE_CHANCE


def with_new_category(ranked: List[Tuple[str, float]], known: Iterable[str], n: int = HEADINGS_TO_ASK) -> Tuple[List[Tuple[str, float]], Optional[str]]:
    """The headings for call 2, with the best one the user hasn't rated, picked or done in second place.

    `ranked` is Jev's order of today's headings. When the new one isn't among the top `n`, it takes
    the place of the last. When every heading is known, nothing changes.
    """
    known = set(known)
    top = ranked[:n]
    new = next((x for x in ranked if x[0] not in known), None)
    if new is None or len(ranked) < 2:
        return top, None
    rest = [x for x in top if x[0] != new[0]]
    return [rest[0], new, *rest[1:]][:n], new[0]


def table_reasons(
    row: Row, req: TableSuggestRequest, liked: List[str], new_heading: Optional[str] = None, change_from: Optional[str] = None,
) -> List[str]:
    out: List[str] = []
    if change_from:
        out.append(f"A change from this week's {TYPE_NAMES.get(change_from, change_from)}")
    if new_heading and row["major_heading"] == new_heading:
        out.append(f"Something new: you haven't tried {row['major_heading']} yet")
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
    new_heading: Optional[str] = None,
    change_from: Optional[str] = None,
) -> List[TablePick]:
    """After call 3: each picked activity with its own minutes and what the app needs to show it.

    `new_heading`: the category tried as something new today; `change_from`: the kind of workout the
    week has been mostly about, when the lead was moved for balance (it says so in its reasons)."""
    allowed = [str(d) for d in req.durations]
    picks = []
    for i, (row, heading_p, activity_p) in enumerate(picked):
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
                reasons=table_reasons(row, req, liked, new_heading, change_from if i == 0 else None),
            )
        )
    return picks
