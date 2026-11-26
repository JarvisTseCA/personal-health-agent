"""
From Memory to a suggestion: what POST /api/suggest/memory does before Jev is asked.

The app sends today's check-in and nothing else about the user. This module reads
the rest from Memory (memory.py), works out today's numbers (calculator.py), and
builds the same request the app builds for POST /api/suggest/table today
(buildTableRequest in src/services/backend.ts). From there on it is the existing
table route, unchanged.

Where each part comes from:

    sent with the request   the check-in: minutes, place, energy, mood; "I want more today"
    Memory: preferences     👍 categories, 👎 categories, no vigorous exercise, the equipment at this place
    Memory: goals           this week's goal and plan ─► calculator ─► today's target, and what is still needed
    Memory: daily           workouts: done this week, recently done
                            accepted suggestions at this place: "picked before"
                            declined suggestions: recently declined, and what is ruled out (next)

What a decline rules out (afterDecline in src/lib/suggest.ts):

    made today               weather            indoors only
                             tired              only activities lighter than the one declined
                             hurts              only activities under 3.5 MET
                             recent             that activity and its whole category
                             not-mood, other    that activity
    made at this place,      no-access          that activity, until the decline is deleted
    on any day

"No time" changes nothing here: the app shortens the minutes in the check-in itself.
"Recently" (done, declined) means this week and last week, as in the app.
"""
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import calculator, db, memory
from .schemas import CheckIn, Decline, Limits, Recent, TableSuggestRequest

DURATIONS = [10, 15, 20, 25, 30, 40, 45, 60]  # how long a suggestion can be; DURATIONS in src/lib/suggest.ts
# What a gym is taken to have when the user hasn't listed theirs; TYPICAL_GYM in src/services/context.ts
TYPICAL_GYM = ["Treadmill", "Stationary bike", "Elliptical", "Dumbbells", "Weight machines"]
HURTS_BELOW_MET = 3.5  # after "Something hurts": gentle activity only, for the rest of the day
RULES_OUT_THE_ACTIVITY = ("not-mood", "recent", "no-access", "other")  # for the rest of the day


class NotEnoughMemory(ValueError):
    """Memory doesn't hold what a suggestion needs yet. The message says what is missing."""


def build_request(
    user_id: str, check_in: CheckIn, today: date, want_more: bool = False
) -> Tuple[TableSuggestRequest, Dict[str, Any]]:
    """The table route's request for this user today, and today's numbers as the calculator worked them out."""
    mem = memory.read(user_id, ["preferences", "goals", "daily"])
    week = week_for(mem["goals"], today)
    numbers = calculator.today_numbers(week["goal_met_hours"], week["plan"], mem["daily"]["workouts"], today)

    place = check_in.place
    since = calculator.monday_of(today) - timedelta(days=7)  # this week and last week

    def recently(entry: Dict[str, Any]) -> bool:
        return since <= date.fromisoformat(entry["date"]) <= today

    def days_ago(entry: Dict[str, Any]) -> int:
        return (today - date.fromisoformat(entry["date"])).days

    suggestions = mem["daily"]["suggestions"]
    accepted_here = [s for s in suggestions if s["outcome"] == "accepted" and s["place"] == place]
    declined = [s for s in suggestions if s["outcome"] == "declined"]
    declined_today = [d for d in declined if d["date"] == today.isoformat()]
    declined_here = [d for d in declined if d["place"] in (None, place)]  # a decline with no place counts everywhere

    # The heading and MET of what was declined today, from the activity table.
    table = _table_rows(d["activity_code"] for d in declined_today)
    known_today = [d for d in declined_today if d["activity_code"] in table]

    categories = mem["preferences"]["categories"]
    exclude_headings = _once(
        [category for category, pref in categories.items() if pref == "dislike"]
        + [table[d["activity_code"]]["major_heading"] for d in known_today if d["reason"] == "recent"]
    )
    exclude_codes = _once(
        [d["activity_code"] for d in declined_today if d["reason"] in RULES_OUT_THE_ACTIVITY]
        + [d["activity_code"] for d in declined_here if d["reason"] == "no-access"]
    )
    indoor_only = any(d["reason"] == "weather" for d in declined_today)
    ceilings = [table[d["activity_code"]]["met_value"] for d in known_today if d["reason"] == "tired"]
    if any(d["reason"] == "hurts" for d in declined_today):
        ceilings.append(HURTS_BELOW_MET)
    below_met = min(ceilings) if ceilings else None

    request = TableSuggestRequest(
        user_id=user_id,
        date=today.isoformat(),
        check_in=check_in,
        # Today's numbers, from the calculator. The app rounds the two weekly ones the same way.
        day_name=numbers["day_name"],
        weekly_goal_met_hours=numbers["weekly_goal_met_hours"],
        done_this_week_met_hours=round(numbers["done_this_week_met_hours"], 2),
        left_this_week_met_hours=round(numbers["left_this_week_met_hours"], 2),
        target_met_hours=numbers["target_met_hours"],
        needed_met_hours=numbers["needed_met_hours"],
        boost=want_more or check_in.energy == "challenge",
        durations=duration_choices(check_in.minutes),
        # Preferences
        liked_categories=[category for category, pref in categories.items() if pref == "like"],
        exclude_headings=exclude_headings,
        limits=Limits(no_vigorous=bool(mem["preferences"]["no_vigorous"])),
        equipment_here=equipment_at(mem["preferences"]["equipment"], place),
        # Daily
        picked_codes=_once(s["activity_code"] for s in accepted_here),
        recent=[
            Recent(family_id=_family_id(w), name=w["activity_name"], days_ago=days_ago(w), code=w["activity_code"])
            for w in mem["daily"]["workouts"] if recently(w)
        ],
        declines=[
            Decline(
                family_id=_family_id(d), name=d["activity_name"], reason=d["reason"] or "other",
                days_ago=days_ago(d), note=d["note"], code=d["activity_code"],
            )
            for d in declined_here if recently(d)
        ],
        exclude_codes=exclude_codes,
        indoor_only=indoor_only,
        below_met=below_met,
        constraint_notes=(["Indoors only"] if indoor_only else []) + ([f"Lighter than {below_met:g} MET"] if below_met else []),
    )
    return request, numbers


def week_for(goals: List[Dict[str, Any]], today: date) -> Dict[str, Any]:
    """The goal and the plan for today's week, from Memory's "goals" (oldest week first).

    A week nothing was saved for carries on with the latest earlier goal and plan,
    the way the app keeps both from one week to the next.
    """
    monday = calculator.monday_of(today).isoformat()
    goal = plan = None
    for week in goals:
        if week["week_start"] > monday:
            break
        goal = week["goal_met_hours"] if week["goal_met_hours"] is not None else goal
        plan = week["plan"] if week["plan"] is not None else plan
    missing = [name for name, value in (("weekly goal", goal), ("weekly plan", plan)) if value is None]
    if missing:
        raise NotEnoughMemory(
            f"Memory has no {' and no '.join(missing)} for this user yet. "
            'Save them first: POST /api/memory with "goals".'
        )
    return {"goal_met_hours": goal, "plan": plan}


def duration_choices(minutes: int) -> List[int]:
    """How long a suggestion can be, given the time the user has (durationChoices in src/lib/suggest.ts)."""
    fits = [d for d in DURATIONS if d <= minutes]
    return fits or ([minutes] if minutes > 0 else [])


def equipment_at(equipment: Dict[str, Optional[List[str]]], place: str) -> Optional[List[str]]:
    """What the user has where they are today (equipmentAt in src/services/context.ts).

    None: nothing is listed for that place, so it isn't known. A gym that isn't listed is
    taken to be a typical one, once the user has listed anything at all.
    """
    if equipment["home"] is None and equipment["gym"] is None:
        return None
    if place in ("indoors_private", "home"):
        return equipment["home"]
    if place in ("indoors_with_others", "gym"):
        return equipment["gym"] if equipment["gym"] is not None else TYPICAL_GYM
    return []


def _table_rows(codes: Iterable[Optional[str]]) -> Dict[str, Dict[str, Any]]:
    """{code: its heading and MET} for the codes that are in the activity table."""
    wanted = sorted({c for c in codes if c})
    if not wanted:
        return {}
    with db.session() as conn:
        rows = conn.execute(
            "SELECT activity_code, major_heading, met_value FROM activities "
            f"WHERE activity_code IN ({', '.join('?' * len(wanted))})", wanted,
        ).fetchall()
    return {r["activity_code"]: dict(r) for r in rows}


def _family_id(entry: Dict[str, Any]) -> str:
    """The id the app uses for an activity from the table (tableId in src/lib/tableActivities.ts)."""
    return f"table-{entry['activity_code']}" if entry["activity_code"] else entry["activity_name"]


def _once(values: Iterable[Optional[str]]) -> List[str]:
    """Each value once, in the order first seen; empty ones dropped."""
    seen: List[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen
