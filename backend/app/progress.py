"""
Progress: the numbers on the app's screens that reach back past this week.

    streak        days in a row the app was opened, and the longest run so far
    trophies      one for each week that reached its goal
    past weeks    what each week added up to, its goal, the days with a workout, the days the app was opened
    months        the past weeks rolled up by month, for the month view on Progress
    goal offer    raise the weekly goal, lower it, or keep it
    summary       the Summary page: averages over the last 4 full weeks, and the week-by-week chart

This is the app's own math written again, so the backend can work these numbers out from
what Memory holds instead of being sent them: src/lib/rewards.ts, src/lib/goal.ts and
src/lib/periods.ts, and the parts of src/services/context.ts and src/services/summary.ts
that put them together. The two have to agree. shared_examples/progress.json holds examples
that both sides work out (tests/test_progress_shared.py here, src/lib/progress.shared.test.ts
in the app). When one side changes a rule, change the other and the examples too.

`numbers()` works everything out from two of Memory's groups, "goals" and "daily", as
memory.read() gives them, and one date: today.

Days. The app counts 0 = Monday … 6 = Sunday inside "this week" and "n weeks ago"; in its
demo, today is one of those seven. Memory holds real dates. Here everything follows from
`today`: the week it is in is this week, the weeks before it are the past weeks, and
whatever is dated after `today` is left out, the way the app leaves out the days after today.

The streak follows the record. A day counts as opened when its date is under "app_opens",
today the same as any other day: the app saves today's open first and asks for these numbers
after. A day with no record is a day the app wasn't opened, in this week and in every past
week. A workout on that day adds to the week's MET-hours as always, and adds no day to the streak.

Past weeks start at the earliest week Memory knows anything about (a goal, a workout or an
open) and run to last week with no gaps: a week with nothing in it is a week with nothing done.
A week's goal and plan are the latest ones saved up to that week, as for today's week
(week_for in memory_suggest.py); for a week before the first ones saved, the first ones stand in.

Memory has no limit on how far back it goes, and the totals count all of it: the streak and
its best run, the trophies, the longest gap on the Summary page. The detail the app is given
is the last RECENT_WEEKS past weeks: "past_weeks", and "months", which is made from them.
(The app's own calculator never holds more than that many weeks, so the shared examples
have none about this; tests/test_progress.py does.)
"""
import math
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from . import calculator
from .memory_suggest import week_for

EPS = 1e-9

GUIDELINE_GOAL = 7.5  # MET-hours a week: 150 min at 3 MET, or 75 min at 6 MET
VIGOROUS_MET = 6.0  # from here up an activity is vigorous; below calculator.MODERATE_MET it is light

# The goal offer (src/lib/goal.ts)
RAISE_STEP = 2.5
RAISE_WINDOW = 2
LOWER_WINDOW = 3
LOWER_THRESHOLD = 0.5
WEEKLY_UPPER_LIMIT: Optional[float] = None  # an open clinical question: None until the team's clinician sets it

# What the app is given of the past: Memory keeps every week, the screens show half a year.
RECENT_WEEKS = 26  # past weeks in "past_weeks" and "months" (HISTORY_WEEKS in src/lib/fitbit.ts)

# The Summary page (src/services/summary.ts)
SUMMARY_WEEKS = 4  # full weeks behind the averages
CHART_WEEKS = 6  # weeks in the week-by-week chart, this week included


# --- The rules, one at a time ------------------------------------------------------------------


def streak_of(days: Iterable[bool]) -> Dict[str, int]:
    """`days`: was the app opened on each day, oldest first, ending today (streakOf in src/lib/rewards.ts).

    A missed day quietly starts a new run; the longest run stays on record.
    """
    best = run = 0
    for opened in days:
        run = run + 1 if opened else 0
        best = max(best, run)
    return {"current": run, "best": best}


def trophy_earned(done: float, goal: float) -> bool:
    """A week earns its trophy when it reaches its goal (trophyEarned in src/lib/rewards.ts)."""
    return goal > 0 and done + EPS >= goal


def goal_offer(current: float, past_totals: Sequence[float]) -> Dict[str, Any]:
    """Raise, lower or keep the weekly goal (goalOffer in src/lib/goal.ts). `past_totals`: full weeks, oldest first.

    Lower: under half the goal 3 weeks in a row → half of it.
    Raise: the lower of the last 2 weeks, rounded down to a multiple of 2.5; offered when that is above the goal.
    The user decides: nothing changes until they accept.
    """
    last = list(past_totals[-LOWER_WINDOW:])
    if len(last) == LOWER_WINDOW and all(total + EPS < current * LOWER_THRESHOLD for total in last):
        return {
            "kind": "lower", "from": current, "to": current * LOWER_THRESHOLD,
            "reason": f"You were under half your goal {LOWER_WINDOW} weeks in a row.",
        }
    last = list(past_totals[-RAISE_WINDOW:])
    if len(last) == RAISE_WINDOW:
        rounded = math.floor((min(last) + EPS) / RAISE_STEP) * RAISE_STEP
        capped = rounded if WEEKLY_UPPER_LIMIT is None else min(rounded, WEEKLY_UPPER_LIMIT)
        if capped > current + EPS:
            return {
                "kind": "raise", "from": current, "to": capped,
                "reason": f"You reached at least {capped:g} MET-hours in each of the last {RAISE_WINDOW} weeks.",
            }
    return {"kind": "keep", "from": current, "to": current, "reason": "Your last few weeks fit this goal well."}


def brisk_minutes(met_hours: float) -> int:
    """MET-hours as minutes of moderate activity, the unit of the guideline's 150 minutes (briskMinutes in summary.ts)."""
    return _round(met_hours / calculator.MODERATE_MET * 60)


def intensity_of(met: float) -> str:
    """light | moderate | vigorous (intensityOf in src/lib/met.ts)."""
    if met >= VIGOROUS_MET:
        return "vigorous"
    return "moderate" if met >= calculator.MODERATE_MET else "light"


# --- Everything, from Memory -------------------------------------------------------------------


def numbers(goals: List[Dict[str, Any]], daily: Dict[str, Any], today: date) -> Dict[str, Any]:
    """Everything in the list at the top of this file, from Memory's "goals" and "daily" as read() gives them.

    NotEnoughMemory (memory_suggest.py) when no weekly goal or plan is saved yet.
    """
    monday = calculator.monday_of(today)
    index = today.weekday()

    workouts = [w for w in daily.get("workouts") or [] if date.fromisoformat(w["date"]) <= today]
    opens = {day for day in map(date.fromisoformat, daily.get("app_opens") or []) if day <= today}  # the record, today included

    by_week: Dict[date, List[Dict[str, Any]]] = {}
    for workout in workouts:
        by_week.setdefault(calculator.monday_of(date.fromisoformat(workout["date"])), []).append(workout)

    now = week_for(goals, today)  # NotEnoughMemory when nothing is saved yet
    this_week = _week(monday, now["goal_met_hours"], now["plan"], by_week.get(monday, []), opens)

    # Past weeks: from the earliest week Memory knows anything about, to last week.
    known = [date.fromisoformat(week["week_start"]) for week in goals] + list(by_week) + [calculator.monday_of(day) for day in opens]
    past: List[Dict[str, Any]] = []
    start = min(known)
    while start < monday:
        goal, plan = _goal_and_plan(goals, start)
        past.append(_week(start, goal, plan, by_week.get(start, []), opens))
        start += timedelta(days=7)

    opened = [day for week in past for day in week["app_opens"]] + this_week["app_opens"][: index + 1]
    recent = past[-RECENT_WEEKS:]  # the detail the app is given; the totals count every week
    return {
        "today": today.isoformat(),
        "today_index": index,  # 0 = Monday
        "streak": streak_of(opened),  # over every week on record
        "trophy": this_week["trophy"],  # this week's goal is reached
        "trophies": sum(week["trophy"] for week in past) + int(this_week["trophy"]),  # all so far, this week's included
        "this_week": this_week,  # up to and including today
        "past_weeks": recent,  # oldest first; the last one is last week; RECENT_WEEKS at most
        "months": _months(recent, monday),  # newest first
        "goal_offer": goal_offer(now["goal_met_hours"], [week["done_met_hours"] for week in past]),
        "summary": _summary(past, this_week, index),
    }


def _week(monday: date, goal: float, plan: List[str], workouts: List[Dict[str, Any]], opens: Set[date]) -> Dict[str, Any]:
    """One week's numbers. `workouts` are that week's (for this week: up to today), `opens` every day on record as opened."""
    done = [0.0] * 7
    active = [False] * 7
    rows: List[Dict[str, Any]] = []
    for workout in sorted(workouts, key=lambda w: w["date"]):  # by day; a day's workouts stay in Memory's order
        day = (date.fromisoformat(workout["date"]) - monday).days
        met = calculator.counted_met(workout)
        earned = calculator.credit(met, workout["duration_min"])
        done[day] += earned
        active[day] = True
        rows.append({
            "id": workout.get("id"), "day": day,
            "activity_code": workout.get("activity_code"), "activity_name": workout["activity_name"],
            "duration_min": workout["duration_min"],
            "counted_met": met,  # the bottom of its Fitbit band while unconfirmed, otherwise its own MET
            "met_hours": earned,  # what it adds toward the goal: nothing for light activity
            "intensity": intensity_of(met),
        })

    opened = [monday + timedelta(days=d) in opens for d in range(7)]

    total = calculator.total(done)
    by_activity = _minutes_by_activity(rows)
    return {
        "week_start": monday.isoformat(),
        "goal_met_hours": goal,
        "plan": plan,
        "done_met_hours": total,
        "done_by_day": done,
        "active_days": active,  # any workout that day, light ones too
        "app_opens": opened,  # the days on record as opened
        "trophy": trophy_earned(total, goal),
        "minutes": sum(row["duration_min"] for row in rows),
        "top_activity": by_activity[0] if by_activity else None,  # the one with the most minutes
        "workouts": rows,
    }


def _goal_and_plan(goals: List[Dict[str, Any]], monday: date) -> Tuple[float, List[str]]:
    """The goal and plan a past week ran on: the latest saved up to it, or the first saved after it."""
    start = monday.isoformat()
    goal = plan = None
    for week in goals:  # oldest first
        if week["week_start"] <= start:
            goal = week["goal_met_hours"] if week["goal_met_hours"] is not None else goal
            plan = week["plan"] if week["plan"] is not None else plan
            continue
        if goal is not None and plan is not None:
            break
        goal = week["goal_met_hours"] if goal is None else goal
        plan = week["plan"] if plan is None else plan
    return goal, plan


def _minutes_by_activity(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Minutes on each activity, most first. An activity is its name: the app saves a workout under the
    name of its activity family ("Walking" for a brisk walk and for a stroller walk), and groups by family too."""
    found: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = row["activity_name"]
        entry = found.setdefault(key, {"activity_code": row["activity_code"], "activity_name": row["activity_name"], "minutes": 0})
        entry["minutes"] += row["duration_min"]
    return sorted(found.values(), key=lambda entry: -entry["minutes"])  # ties stay in the order first seen


def _months(past: List[Dict[str, Any]], this_monday: date) -> List[Dict[str, Any]]:
    """Past weeks by month, newest first (groupWeeks in src/lib/periods.ts).

    A week belongs to the month its Thursday falls in, so no week is split.
    """
    months: Dict[str, Dict[str, Any]] = {}
    opened: Dict[str, List[bool]] = {}
    for week in past:  # oldest first
        key = _month_of(date.fromisoformat(week["week_start"]))
        month = months.setdefault(key, {
            "month": key, "week_starts": [], "done_met_hours": 0.0, "goal_met_hours": 0.0,
            "trophies": 0, "active_days": 0, "app_open_days": 0,
        })
        month["week_starts"].append(week["week_start"])
        month["done_met_hours"] += week["done_met_hours"]
        month["goal_met_hours"] += week["goal_met_hours"]
        month["trophies"] += int(week["trophy"])
        month["active_days"] += sum(week["active_days"])
        month["app_open_days"] += sum(week["app_opens"])
        opened.setdefault(key, []).extend(week["app_opens"])
    for key, month in months.items():
        month["best_streak"] = streak_of(opened[key])["best"]  # the longest run inside this month's weeks
        month["partial"] = key == _month_of(this_monday)  # this week is in it too, so it isn't over yet
    return [months[key] for key in sorted(months, reverse=True)]


def _month_of(monday: date) -> str:
    thursday = monday + timedelta(days=3)
    return f"{thursday.year:04d}-{thursday.month:02d}"


def _summary(past: List[Dict[str, Any]], this_week: Dict[str, Any], today_index: int) -> Dict[str, Any]:
    """The numbers behind the Summary page (buildSummary in src/services/summary.ts).

    The app's "things worth mentioning" are sentences made from its own notes; they stay in the app.
    """
    recent = past[-SUMMARY_WEEKS:]
    n = len(recent)

    def average(values: Iterable[float]) -> float:
        return calculator.total(values) / n if n else 0.0

    def per_week(minutes: float) -> int:
        return _round(minutes / n) if n else 0

    rows = [row for week in recent for row in week["workouts"]]

    def minutes_at(level: str) -> int:
        return per_week(sum(row["duration_min"] for row in rows if row["intensity"] == level))

    avg_met_hours = average(week["done_met_hours"] for week in recent)

    chart = [
        {
            "week_start": week["week_start"], "current": week is this_week,
            "met_hours": week["done_met_hours"], "brisk_min": brisk_minutes(week["done_met_hours"]),
            "goal_met_hours": week["goal_met_hours"], "goal_min": brisk_minutes(week["goal_met_hours"]),
            "reached": week["done_met_hours"] + EPS >= week["goal_met_hours"],
        }
        for week in [*past, this_week][-CHART_WEEKS:]
    ]

    # The longest run of days with no workout, over everything on record up to today.
    gap = longest_gap = 0
    for was_active in [day for week in past for day in week["active_days"]] + this_week["active_days"][: today_index + 1]:
        gap = 0 if was_active else gap + 1
        longest_gap = max(longest_gap, gap)

    return {
        "weeks": n,  # full weeks behind the averages; 0 for a new user
        "avg_met_hours": avg_met_hours,
        "avg_brisk_min": brisk_minutes(avg_met_hours),
        "pct_of_guideline": avg_met_hours / GUIDELINE_GOAL,
        "goal_min": brisk_minutes(this_week["goal_met_hours"]),
        "goal_weeks": sum(week["trophy"] for week in recent),
        "avg_active_days": average(sum(week["active_days"]) for week in recent),
        "chart": chart,  # oldest first, ending with this week
        "calendar": [{"week_start": week["week_start"], "days": week["active_days"]} for week in recent],
        "longest_gap": longest_gap,
        "intensity": {level: minutes_at(level) for level in ("light", "moderate", "vigorous")},  # minutes a week
        "mix": [
            {"activity_code": a["activity_code"], "activity_name": a["activity_name"], "min_per_week": per_week(a["minutes"])}
            for a in _minutes_by_activity(rows)
        ],
    }


def _round(value: float) -> int:
    """Round half up, as JavaScript's Math.round does. Python's round() takes halves to the even number."""
    return math.floor(value + 0.5)
