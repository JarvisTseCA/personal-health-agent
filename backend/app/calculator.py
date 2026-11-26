"""
The calculator: how much of the weekly goal is done, and what today's share of it is.

This is the same math as the app's calculator (src/lib/met.ts and src/lib/plan.ts),
written again here so the backend can work the numbers out from what Memory holds
instead of being sent them. The two have to agree: tests/test_calculator.py uses the
same examples as the app's tests (src/lib/lib.test.ts). When one side changes its
rules, change the other and its tests too.

    MET-hours = MET value × minutes / 60

- Only activity at 3 MET or more counts toward the goal.
- A Fitbit workout nobody has confirmed yet counts at the bottom of its Fitbit band.
- The weekly goal is split over the days the user planned to exercise, by the
  minutes planned for each day:

      a day's target = MET-hours left at the start of that day × its minutes / minutes on that day and after

`today_numbers()` puts it together for one day.
"""
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Sequence

MODERATE_MET = 3.0  # below this an activity is light and doesn't count toward the goal
UNCONFIRMED_MET = {"fairly": 3.0, "very": 6.0}  # Fitbit's bands, each counted at its lowest MET
SLOT_MINUTES = {"off": 0, "0": 0, "5": 5, "10": 10, "30": 30, "45": 45}  # a day in the plan → minutes
DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def met_hours(met: float, minutes: float) -> float:
    return met * minutes / 60


def credit(met: float, minutes: float) -> float:
    """MET-hours that count toward the weekly goal: nothing for light activity."""
    return met_hours(met, minutes) if met >= MODERATE_MET else 0.0


def counted_met(workout: Dict[str, Any]) -> float:
    """The MET a workout counts at. `workout` is one entry of Memory's daily.workouts."""
    if not workout.get("confirmed", True) and workout.get("band") in UNCONFIRMED_MET:
        return UNCONFIRMED_MET[workout["band"]]
    return workout["met"]


def day_index(day: date) -> int:
    """0 = Sunday … 6 = Saturday: the week starts on Sunday."""
    return (day.weekday() + 1) % 7


def sunday_of(day: date) -> date:
    return day - timedelta(days=day_index(day))


def total(values: Iterable[float]) -> float:
    """Add up one at a time, in order, as the app does (`reduce((a, b) => a + b, 0)`).

    Python's own sum() corrects for rounding from version 3.12 on, so its last digit can differ
    from the app's: 11.674999999999999 where the app has 11.675, which is 233 brisk minutes
    instead of 234. Adding plainly gives the app's answer on every Python.
    """
    result = 0.0
    for value in values:
        result += value
    return result


def done_by_day(workouts: Iterable[Dict[str, Any]], today: date) -> List[float]:
    """MET-hours earned on each day of today's week, Sunday first. Other weeks and days after today don't count."""
    sunday = sunday_of(today)
    done = [0.0] * 7
    for workout in workouts:
        day = date.fromisoformat(workout["date"])
        if sunday <= day <= today:
            done[(day - sunday).days] += credit(counted_met(workout), workout["duration_min"])
    return done


def daily_targets(goal: float, plan: Sequence[str], done: Sequence[float], today_index: int) -> List[float]:
    """Each day's target in MET-hours, Sunday first (dailyTargets in src/lib/plan.ts).

    `plan` is the 7 days as Memory stores them (off | 0 | 5 | 10 | 30 | 45), `done` the
    MET-hours earned on each day, `today_index` 0 for Sunday.
    """
    minutes = [SLOT_MINUTES[slot] for slot in plan]
    targets = [0.0] * 7

    # Past days and today: what was left at the start of that day, split over that day onward.
    for d in range(today_index + 1):
        left = max(0.0, goal - total(done[:d]))
        ahead = sum(minutes[d:])
        targets[d] = left * minutes[d] / ahead if ahead > 0 else 0.0

    # Later days: what is left after today, split over them. Today counts as at least its own
    # target, so later days don't look bigger just because today isn't over yet.
    left_after_today = max(0.0, goal - total(done[:today_index]) - max(targets[today_index], done[today_index]))
    ahead = sum(minutes[today_index + 1:])
    for d in range(today_index + 1, 7):
        targets[d] = left_after_today * minutes[d] / ahead if ahead > 0 else 0.0
    return targets


def unplanned_left(goal: float, plan: Sequence[str], done: Sequence[float], today_index: int) -> float:
    """MET-hours that no day left in the week can take: every day after today is off (unplannedLeft in src/lib/plan.ts)."""
    target = daily_targets(goal, plan, done, today_index)[today_index]
    left_after_today = max(0.0, goal - total(done[:today_index]) - max(target, done[today_index]))
    minutes_ahead = sum(SLOT_MINUTES[slot] for slot in plan[today_index + 1:])
    return 0.0 if minutes_ahead > 0 else left_after_today


def today_numbers(goal: float, plan: Sequence[str], workouts: Iterable[Dict[str, Any]], today: date) -> Dict[str, Any]:
    """What a suggestion needs to know about today, from the week's goal and plan and the workouts in Memory.

    The names are the ones the suggest routes already use for the same numbers.
    """
    done = done_by_day(workouts, today)
    index = day_index(today)
    target = daily_targets(goal, plan, done, index)[index]
    done_this_week = total(done)
    return {
        "day_name": DAY_NAMES[index],
        "weekly_goal_met_hours": goal,
        "done_this_week_met_hours": done_this_week,
        "left_this_week_met_hours": max(0.0, goal - done_this_week),
        "target_met_hours": target,  # today's share of the goal, fixed at the start of the day
        "done_today_met_hours": done[index],
        "needed_met_hours": max(0.0, target - done[index]),  # what is still missing from today's share
    }
