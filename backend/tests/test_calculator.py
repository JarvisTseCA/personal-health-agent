"""
The backend's calculator (app/calculator.py) against the app's (src/lib/met.ts, src/lib/plan.ts).

The first two groups repeat the examples in the app's own tests, src/lib/lib.test.ts
("MET-hours" and "daily targets"), with the same numbers, so both sides are held to
the same answers. If one of these fails after a change, check the app's test of the
same name before changing the number here.
"""
from datetime import date

import pytest

from app import calculator
from app.calculator import credit, counted_met, daily_targets, done_by_day, met_hours, today_numbers, total

close = lambda a, b: a == pytest.approx(b, abs=0.005)  # noqa: E731  (the app's tests compare to 2 decimals)

PLAN = ["30", "off", "30", "off", "off", "45", "off"]
NOTHING_DONE = [0] * 7


# --- "MET-hours" in src/lib/lib.test.ts --------------------------------------------------------


def test_matches_the_guideline_150_min_at_3_met_is_75_min_at_6_met_is_7_5():
    assert close(met_hours(3, 150), 7.5)
    assert close(met_hours(6, 75), 7.5)


def test_adding_up_gives_the_apps_answer_on_every_python():
    # Four workouts: 6.8 + 1.025 + 2.175 + 1.675. The app adds them in order and gets 11.675.
    # sum() on Python 3.12 and later gets 11.674999999999999, a brisk minute less once rounded.
    assert total([met_hours(6.8, 60), met_hours(4.1, 15), met_hours(8.7, 15), met_hours(6.7, 15)]) == 11.675
    assert total([]) == 0


def test_light_activity_is_left_out_of_the_goal():
    assert credit(2.3, 30) == 0
    assert close(credit(6, 30), 3)
    assert close(credit(3, 60), 3)  # 3 MET is moderate: it counts


def test_an_unconfirmed_fitbit_workout_counts_at_the_bottom_of_its_band():
    bike = {"met": 6.8, "duration_min": 30, "source": "fitbit", "confirmed": False, "band": "very"}
    assert counted_met(bike) == 6.0  # 6.0 MET, not the guessed 6.8
    assert close(credit(counted_met(bike), 30), 3)
    assert counted_met({**bike, "confirmed": True}) == 6.8  # once confirmed, its own MET
    assert counted_met({**bike, "band": None}) == 6.8  # no band to fall back on


# --- "daily targets" in src/lib/lib.test.ts ----------------------------------------------------


def test_splits_the_goal_by_time_on_each_available_day_off_days_get_nothing():
    t = daily_targets(7.5, PLAN, NOTHING_DONE, 0)
    assert close(t[0], 7.5 * 30 / 105)
    assert t[1] == 0
    assert close(t[5], 7.5 * 45 / 105)
    assert close(sum(t), 7.5)


def test_re_divides_what_is_left_after_a_mid_week_change():
    # 3.0 done by Wednesday night, Thursday off, Friday 30 min, Saturday 45 min: 4.5 left for the two.
    t = daily_targets(7.5, ["off", "off", "off", "off", "30", "45", "off"], [1, 1, 1, 0, 0, 0, 0], 2)
    assert close(t[4] + t[5], 4.5)
    assert close(t[4] / t[5], 30 / 45)
    assert t[3] == 0


def test_extra_effort_today_lowers_later_days_but_not_todays_own_target():
    before = daily_targets(7.5, PLAN, [0, 0, 0, 0, 0, 0, 0], 2)
    after = daily_targets(7.5, PLAN, [0, 0, 5, 0, 0, 0, 0], 2)  # today's target is 3.0; 5 beats it
    assert close(after[2], before[2])
    assert after[5] < before[5]


def test_never_lowers_the_weekly_goal_because_of_off_days():
    assert close(daily_targets(7.5, ["off"] * 6 + ["10"], NOTHING_DONE, 0)[6], 7.5)


def test_zero_minute_days_get_no_target_and_the_goal_is_split_by_minutes():
    t = daily_targets(7.5, ["0", "10", "30", "off", "5", "45", "0"], NOTHING_DONE, 0)
    assert t[0] == 0
    assert t[3] == 0
    assert close(t[5] / t[1], 4.5)


def test_a_shorter_day_re_splits_the_rest_of_the_goal_over_the_other_days():
    before = daily_targets(7.5, ["30"] * 7, NOTHING_DONE, 2)
    after = daily_targets(7.5, ["30", "30", "30", "30", "10", "30", "30"], NOTHING_DONE, 2)
    assert after[4] < before[4]
    assert after[5] > before[5]


def test_the_plan_uses_the_same_minutes_as_the_app():
    # SLOT_MINUTES in src/lib/plan.ts
    assert calculator.SLOT_MINUTES == {"off": 0, "0": 0, "5": 5, "10": 10, "30": 30, "45": 45}


# --- From what Memory holds --------------------------------------------------------------------

MONDAY, WEDNESDAY = date(2026, 11, 23), date(2026, 11, 25)


def workout(day, met, minutes, **more):
    """One entry of Memory's daily.workouts."""
    return {"id": f"{day}-{met}", "date": day, "activity_name": "x", "met": met, "duration_min": minutes,
            "source": "manual", "confirmed": True, "band": None, **more}


WEEK = [
    workout("2026-11-23", 5.0, 30),                                              # Monday: 2.5
    workout("2026-11-23", 2.0, 20),                                              # Monday, light: 0
    workout("2026-11-24", 6.8, 30, source="fitbit", confirmed=False, band="very"),  # Tuesday, unconfirmed: 6.0 × 0.5 = 3.0
    workout("2026-11-22", 8.0, 60),                                              # last Sunday: another week
    workout("2026-11-26", 8.0, 60),                                              # Thursday: after "today"
]


def test_done_by_day_counts_this_week_up_to_today():
    assert done_by_day(WEEK, WEDNESDAY) == pytest.approx([2.5, 3.0, 0, 0, 0, 0, 0])
    assert done_by_day(WEEK, MONDAY) == pytest.approx([2.5, 0, 0, 0, 0, 0, 0])


def test_todays_numbers_on_a_monday_with_nothing_done():
    n = today_numbers(7.5, PLAN, [], MONDAY)
    assert n["day_name"] == "Monday"
    assert n["weekly_goal_met_hours"] == 7.5
    assert n["done_this_week_met_hours"] == 0
    assert close(n["left_this_week_met_hours"], 7.5)
    assert close(n["target_met_hours"], 7.5 * 30 / 105)  # 2.14: 30 of the week's 105 planned minutes
    assert close(n["needed_met_hours"], 7.5 * 30 / 105)


def test_todays_numbers_midweek():
    # 5.5 done by Tuesday night, 2.0 left; Wednesday has 30 of the 75 minutes still planned (Wed 30, Sat 45).
    n = today_numbers(7.5, PLAN, WEEK, WEDNESDAY)
    assert n["day_name"] == "Wednesday"
    assert close(n["done_this_week_met_hours"], 5.5)
    assert close(n["left_this_week_met_hours"], 2.0)
    assert close(n["target_met_hours"], 2.0 * 30 / 75)  # 0.8
    assert n["done_today_met_hours"] == 0
    assert close(n["needed_met_hours"], 0.8)


def test_a_workout_today_lowers_what_is_needed_but_not_the_target():
    n = today_numbers(7.5, PLAN, WEEK + [workout("2026-11-25", 3.0, 10)], WEDNESDAY)  # 0.5 done today
    assert close(n["target_met_hours"], 0.8)
    assert close(n["done_today_met_hours"], 0.5)
    assert close(n["needed_met_hours"], 0.3)
    assert close(n["left_this_week_met_hours"], 1.5)


def test_nothing_is_needed_on_a_day_off_or_once_the_goal_is_reached():
    assert today_numbers(7.5, PLAN, [], date(2026, 11, 24))["needed_met_hours"] == 0  # Tuesday is off
    done = [workout("2026-11-23", 6.0, 90)]  # 9.0 on Monday: over the goal
    n = today_numbers(7.5, PLAN, done, WEDNESDAY)
    assert n["left_this_week_met_hours"] == 0
    assert n["needed_met_hours"] == 0
