"""
From Memory to what the Chat model is told about the user: what POST /api/chat/memory
adds once a message has passed both checks.

The app sends the conversation and nothing about the user's progress. This module reads
the user from Memory (memory.py), takes the numbers as the backend works them out
(memory_numbers.py: the same numbers the screens show), and lays both out as one small
piece of JSON. chat_prompt.py puts it after the brief.

Where each part comes from:

    Memory: who, preferences   the name; 👍 / 👎 categories; equipment; no vigorous exercise
    Memory: daily              today's check-in; what the user turned down today, and why
    the numbers                today (target, done, still needed); this week (goal, done, left, each
                               day, the workouts); streak; trophies; the last few weeks; VO2 max
    sent with the request      clinician_notes: what the user saved in Chat as their clinician's
                               feedback. The app keeps those itself (Memory's "other", which the
                               backend doesn't read), so it sends them along.

MET-hours are given the way the screens write them (fmt and fmtGoal in src/lib/met.ts): what is
done to one decimal, a goal as it is, with no ".0" on a whole one. So a number the model repeats
reads the same as the one on screen: "1.0 of 7.5", not "0.95 of 7.5"; "3.1 of 10", not "of 10.0".

Before a weekly goal and plan are saved there are no numbers to give. The model is then
told who the user is and which day it is, and that their progress isn't known yet.
"""
import math
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from . import memory, memory_numbers
from .memory_suggest import NotEnoughMemory

DAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
PAST_WEEKS = 4      # how many past weeks the model is told about
VO2_READINGS = 6    # how many monthly VO2 max readings, ending with the latest


def user_data(user_id: str, today: date, clinician_notes: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    """What the model that writes is told about this user on this day."""
    mem = memory.read(user_id, ["who", "preferences", "daily"])
    preferences = mem["preferences"]
    equipment = preferences["equipment"]
    data: Dict[str, Any] = {
        "user": {
            "name": mem["who"]["name"],
            "categories_they_like": [c for c, pref in preferences["categories"].items() if pref == "like"],
            "categories_they_dislike": [c for c, pref in preferences["categories"].items() if pref == "dislike"],
            "equipment_at_home": equipment["home"] if equipment["home"] is not None else "not listed",
            "equipment_at_gym": equipment["gym"] if equipment["gym"] is not None else "not listed",
            "no_vigorous_exercise": bool(preferences["no_vigorous"]),
        },
    }
    day = today.isoformat()
    try:
        numbers: Optional[Dict[str, Any]] = memory_numbers.for_user(user_id, today)
    except NotEnoughMemory:
        numbers = None

    if numbers is None:
        data["today"] = {"date": day, "day": today.strftime("%A")}
        data["progress"] = "not known yet: no weekly goal and plan are saved for this user"
    else:
        now, week = numbers["day"], numbers["this_week"]
        check_in = next((c for c in mem["daily"]["check_ins"] if c["date"] == day), None)
        data["today"] = {
            "date": day,
            "day": now["name"],
            "check_in": {k: check_in[k] for k in ("minutes", "place", "energy", "mood")} if check_in else None,
            "target_met_hours": _shown(now["target_met_hours"]),
            "done_met_hours": _shown(now["done_met_hours"]),
            "still_needed_met_hours": _shown(now["needed_met_hours"]),
            # What the user turned down on the Today tab today, and why. Accepted picks are left out: Memory
            # keeps one per place, under the day it was first accepted, so "accepted today" can't be told from it.
            "declined_today": [
                {"activity": s["activity_name"], **({"reason": s["reason"]} if s["reason"] else {})}
                for s in mem["daily"]["suggestions"] if s["outcome"] == "declined" and s["date"] == day
            ],
        }
        data["this_week"] = {
            "goal_met_hours": _goal(week["goal_met_hours"]),
            "done_met_hours": _shown(week["done_met_hours"]),
            "left_met_hours": _shown(week["left_met_hours"]),
            "trophy_earned": week["trophy"],
            "days": [
                {"day": DAYS[i], "planned": _planned(week["plan"][i]), "target_met_hours": _shown(week["targets"][i]),
                 "done_met_hours": _shown(week["done_by_day"][i])}
                for i in range(7)
            ],
            "workouts": [
                {"day": DAYS[w["day"]], "activity": w["activity_name"], "minutes": w["duration_min"], "met_hours": _shown(w["met_hours"])}
                for w in week["workouts"]
            ],
        }
        data["streak_days"] = numbers["streak"]
        data["trophies_so_far"] = numbers["trophies"]
        data["past_weeks"] = [  # oldest first; the last one is last week
            {"week_start": w["week_start"], "goal_met_hours": _goal(w["goal_met_hours"]), "done_met_hours": _shown(w["done_met_hours"]),
             "trophy_earned": w["trophy"]}
            for w in numbers["past_weeks"][-PAST_WEEKS:]
        ]
        vo2 = numbers["vo2"]
        data["vo2_max"] = {
            "latest_ml_kg_min": vo2["latest"],
            "change_since_first_reading": _shown(vo2["change"]),
            "monthly": [f'{r["month"]} {r["ml_kg_min"]}' for r in vo2["series"][-VO2_READINGS:]],
        } if vo2 else None

    notes = [{"text": n["text"].strip()} for n in clinician_notes if (n.get("text") or "").strip()]
    data["clinician_notes"] = notes or None
    return data


def summary(data: Dict[str, Any]) -> str:
    """One line for the backend terminal: who the model was told about, and how much."""
    parts: List[str] = [data["user"]["name"] or "no name"]
    week = data.get("this_week")
    parts.append(f'{week["done_met_hours"]} of {week["goal_met_hours"]} MET-hours this week' if week else "no weekly goal yet")
    notes = data.get("clinician_notes") or []
    if notes:
        parts.append(f'{len(notes)} clinician note{"s" if len(notes) != 1 else ""}')
    return " · ".join(parts)


def _planned(slot: str) -> str:
    """A day of the weekly plan in words: "off", or the minutes planned for it."""
    return "off" if slot == "off" else f"{slot} min"


def _goal(value: float) -> float:
    """A weekly goal as the screens write it: up to two decimals, and a whole one without ".0" (fmtGoal in src/lib/met.ts)."""
    rounded = math.floor(value * 100 + 0.5) / 100
    return int(rounded) if rounded == int(rounded) else rounded


def _shown(value: float) -> float:
    """A number to one decimal, halves rounded up, as the screens write MET-hours (fmt in src/lib/met.ts)."""
    return math.floor(value * 10 + 0.5) / 10
