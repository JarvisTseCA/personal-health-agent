"""
From Memory to the numbers on the app's screens.

When the app runs with the backend it works none of these out itself. It says which day
it is and shows what comes back: from GET /api/numbers, and from the /api/memory routes,
which add the same numbers to their reply when the request carries a `date` (so right
after something is saved, the app has the numbers that follow from it).

Where each part comes from:

    Memory: goals, daily ─► calculator.py   this week: each day's target, what is left, today's share
                         ─► progress.py     this week and the past weeks, streak, trophies, months,
                                            goal offer, the Summary page
    Memory: health       ─► here            VO2 max: the latest reading and how far it has moved

`for_user()` gives them in one piece:

    {
      "today": "2026-11-25", "today_index": 2,                    # 0 = Monday
      "day": {"name": "Wednesday", "target_met_hours": 2.0, "done_met_hours": 0.5,
              "needed_met_hours": 1.5, "reached": False},
      "this_week": {"week_start": "2026-11-23", "goal_met_hours": 7.5, "plan": [...],
                    "done_met_hours": 3.0, "left_met_hours": 4.5, "unplanned_met_hours": 0.0,
                    "done_by_day": [...], "targets": [...],       # 7 days, Monday first
                    "active_days": [...], "app_opens": [...], "trophy": False, "minutes": 60,
                    "top_activity": {...}, "workouts": [...]},    # each workout with what it counts for
      "streak": {"current": 3, "best": 12},
      "trophy": False, "trophies": 4,
      "past_weeks": [...], "months": [...],                       # see progress.py
      "goal_offer": {"kind": "keep", "from": 7.5, "to": 7.5, "reason": "..."},
      "summary": {...},
      "vo2": {"series": [...], "latest": 41.0, "change": 3.0, "peak_mets": 11.7},   # None: no reading yet
    }

Today's three numbers are calculator.today_numbers(), the same call POST /api/suggest/memory
makes, so a suggestion and the screen never disagree about what is needed today.

Memory keeps everything, and the app is given the recent part: `recent()` is Memory from
this week and the progress.RECENT_WEEKS before it, the same weeks "past_weeks" covers.
GET /api/memory gives that when the request carries a `date`. The totals in the numbers
(the streak, the trophies) still count every week Memory holds.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from . import calculator, memory, progress

EPS = 1e-9
ML_PER_MET = 3.5  # 1 MET = 3.5 mL of oxygen per kg per minute


def for_user(user_id: str, today: date) -> Dict[str, Any]:
    """Every number on the app's screens for this user on this day.

    NotEnoughMemory (memory_suggest.py) when Memory has no weekly goal or plan for them yet.
    """
    mem = memory.read(user_id, ["goals", "daily", "health"])
    numbers = progress.numbers(mem["goals"], mem["daily"], today)

    week = numbers["this_week"]
    goal, plan, done, index = week["goal_met_hours"], week["plan"], week["done_by_day"], numbers["today_index"]
    now = calculator.today_numbers(goal, plan, mem["daily"]["workouts"], today)
    week["left_met_hours"] = now["left_this_week_met_hours"]
    week["targets"] = calculator.daily_targets(goal, plan, done, index)
    week["unplanned_met_hours"] = calculator.unplanned_left(goal, plan, done, index)
    numbers["day"] = {
        "name": now["day_name"],
        "target_met_hours": now["target_met_hours"],  # today's share of the goal, fixed at the start of the day
        "done_met_hours": now["done_today_met_hours"],
        "needed_met_hours": now["needed_met_hours"],
        # A day with a target (not off, not 0 minutes) whose MET-hours meet it (reachedToday in src/services/context.ts)
        "reached": now["target_met_hours"] > 0 and now["done_today_met_hours"] + EPS >= now["target_met_hours"],
    }
    numbers["vo2"] = vo2_of(mem["health"]["vo2_max"], today)
    return numbers


def recent(mem: Dict[str, Any], today: date) -> Dict[str, Any]:
    """Memory as the app is given it: this week and the progress.RECENT_WEEKS before it. `mem` is what memory.read() gave.

    What is dated before that first Monday is left out of "goals" and "daily". A heart rate goes
    with its workout, when "daily" is read along with "health"; "health" read on its own keeps them all.
    The latest goal and plan saved before it stay: the weeks after ran on them.
    "who", "preferences", VO2 max and "other" have no week to go by, so they are as Memory has them.
    Nothing is deleted: Memory itself still holds all of it.
    """
    first = (calculator.monday_of(today) - timedelta(weeks=progress.RECENT_WEEKS)).isoformat()
    out = dict(mem)
    if "goals" in mem:
        earlier = [week for week in mem["goals"] if week["week_start"] < first]
        carried: List[Dict[str, Any]] = []
        for field in ("goal_met_hours", "plan"):
            week = next((w for w in reversed(earlier) if w.get(field) is not None), None)
            if week is not None and week not in carried:
                carried.append(week)
        carried.sort(key=lambda week: week["week_start"])
        out["goals"] = carried + [week for week in mem["goals"] if week["week_start"] >= first]
    if "daily" in mem:
        daily = mem["daily"]
        out["daily"] = {
            **daily,
            **{kind: [entry for entry in daily[kind] if entry["date"] >= first] for kind in ("check_ins", "suggestions", "workouts")},
            "app_opens": [day for day in daily["app_opens"] if day >= first],
        }
    if "health" in mem and "daily" in mem:
        kept = {workout["id"] for workout in out["daily"]["workouts"]}
        out["health"] = {**mem["health"], "heart_rates": [r for r in mem["health"]["heart_rates"] if r["workout_id"] in kept]}
    return out


def vo2_of(readings: List[Dict[str, Any]], today: date) -> Optional[Dict[str, Any]]:
    """VO2 max up to this month: the readings, the latest, and the change since the first (vo2Of in src/services/context.ts).

    `readings` are Memory's health.vo2_max, one a month, oldest first. None when there is none yet.
    """
    this_month = f"{today.year:04d}-{today.month:02d}"
    known = [r for r in readings if r["month"] <= this_month]
    if not known:
        return None
    latest = known[-1]["ml_kg_min"]
    return {
        "series": [{"month": r["month"], "ml_kg_min": r["ml_kg_min"]} for r in known],
        "latest": latest,
        "change": latest - known[0]["ml_kg_min"],
        "peak_mets": latest / ML_PER_MET,  # peak effort in METs
    }
