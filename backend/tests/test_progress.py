"""
Progress (app/progress.py): the streak, the trophies, the past weeks, the months, the goal offer and the Summary numbers.

The first group repeats the examples in the app's own tests, src/lib/lib.test.ts ("streaks
and trophies", "goal adjustment") and src/lib/periods.test.ts, with the same numbers. If one
of these fails after a change, check the app's test of the same name before changing the
number here. The rest is what only the backend has to do: find the weeks in Memory's dates.
"""
from datetime import date, timedelta

import pytest

from app import memory, progress
from app.memory_suggest import NotEnoughMemory
from app.progress import brisk_minutes, goal_offer, streak_of, trophy_earned

MONDAY = date(2026, 11, 23)
WEDNESDAY = date(2026, 11, 25)  # its week starts on MONDAY; last week started 2026-11-16
PLAN = ["30", "off", "30", "off", "off", "45", "off"]
THIS_WEEK = [{"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]


def workout(day, met=5.0, minutes=30, name="Bicycling, stationary", code=None, **more):
    """One entry of Memory's daily.workouts, as read() gives it."""
    return {
        "id": f"w-{day}-{name}-{minutes}", "date": day, "activity_code": code, "activity_name": name,
        "met": met, "duration_min": minutes, "source": "manual", "confirmed": True, "band": None, "start_time": None, **more,
    }


def numbers(workouts=(), opens=(), goals=None, today=WEDNESDAY):
    return progress.numbers(THIS_WEEK if goals is None else goals, {"workouts": list(workouts), "app_opens": list(opens)}, today)


def days_of(week_start, *which):
    """Dates in the week that starts on `week_start`: days_of("2026-11-16", 5, 6) is that Saturday and Sunday."""
    return [(date.fromisoformat(week_start) + timedelta(days=d)).isoformat() for d in which]


# --- "streaks and trophies" in src/lib/lib.test.ts ---------------------------------------------


def test_counts_days_in_a_row_the_app_was_opened_ending_today():
    assert streak_of([True, True, True]) == {"current": 3, "best": 3}
    assert streak_of([True, True, False, True]) == {"current": 1, "best": 2}
    assert streak_of([False, False, True]) == {"current": 1, "best": 1}


def test_earns_a_trophy_when_the_week_reaches_its_goal():
    assert trophy_earned(7.5, 7.5) is True
    assert trophy_earned(7.49, 7.5) is False


# --- "goal adjustment" in src/lib/lib.test.ts --------------------------------------------------


def test_raises_to_the_lower_of_the_last_2_weeks_rounded_down_to_2_5():
    offer = goal_offer(7.5, [11.0, 10.3])  # doc: 11.0 and 10.3 → 10
    assert (offer["kind"], offer["from"], offer["to"]) == ("raise", 7.5, 10)
    assert offer["reason"] == "You reached at least 10 MET-hours in each of the last 2 weeks."


def test_keeps_the_goal_when_the_rounded_value_is_not_higher():
    offer = goal_offer(7.5, [9.2, 8.4])  # doc: 9.2 and 8.4 → 7.5
    assert (offer["kind"], offer["to"]) == ("keep", 7.5)
    assert offer["reason"] == "Your last few weeks fit this goal well."


def test_halves_after_3_weeks_under_50_percent():
    offer = goal_offer(7.5, [3.0, 2.6, 3.4])  # doc: 3.0, 2.6, 3.4 → 3.75
    assert (offer["kind"], offer["to"]) == ("lower", 3.75)
    assert offer["reason"] == "You were under half your goal 3 weeks in a row."
    assert goal_offer(7.5, [3.0, 4.0, 3.4])["kind"] == "keep"
    assert goal_offer(7.5, [3.0, 2.6])["kind"] == "keep"  # two weeks aren't three


def test_applies_the_same_rules_below_7_5():
    offer = goal_offer(3.75, [6.1, 5.4])  # doc: 3.75 with 6.1 and 5.4 → 5
    assert (offer["kind"], offer["to"]) == ("raise", 5)


def test_a_raise_stops_at_the_weekly_upper_limit_once_one_is_set(monkeypatch):
    assert goal_offer(7.5, [16.0, 15.2])["to"] == 15
    monkeypatch.setattr(progress, "WEEKLY_UPPER_LIMIT", 12.5)
    offer = goal_offer(7.5, [16.0, 15.2])
    assert (offer["kind"], offer["to"]) == ("raise", 12.5)
    assert offer["reason"] == "You reached at least 12.5 MET-hours in each of the last 2 weeks."


def test_brisk_minutes_round_a_half_up_the_way_the_app_does():
    assert brisk_minutes(7.5) == 150  # the guideline: 150 minutes
    assert brisk_minutes(0.025) == 1  # 0.5 of a minute; Python's own round() would say 0
    assert progress._round(22.5) == 23
    assert progress._round(106.5) == 107


# --- The streak, from Memory's dates -----------------------------------------------------------


def test_today_is_not_opened_until_it_is_on_record():
    n = numbers()
    assert n["streak"] == {"current": 0, "best": 0}
    assert n["this_week"]["app_opens"] == [False] * 7
    assert (n["today"], n["today_index"]) == ("2026-11-25", 2)


def test_today_counts_as_opened_once_it_is_on_record():
    n = numbers(opens=["2026-11-25"])
    assert n["streak"] == {"current": 1, "best": 1}
    assert n["this_week"]["app_opens"] == [False, False, True, False, False, False, False]


def test_a_day_not_on_record_today_ends_the_run_at_0_and_the_best_run_stays():
    # The same days as the next test, without today: Thursday to Tuesday is 6 days, and today is not on record.
    n = numbers(opens=days_of("2026-11-16", 0, 3, 4, 5, 6) + days_of("2026-11-23", 0, 1))
    assert n["streak"] == {"current": 0, "best": 6}
    assert n["this_week"]["app_opens"][n["today_index"]] is False


def test_the_streak_runs_across_weeks():
    # Last week: Monday, then Thursday to Sunday. This week: Monday, Tuesday and today.
    n = numbers(opens=days_of("2026-11-16", 0, 3, 4, 5, 6) + days_of("2026-11-23", 0, 1, 2))
    assert n["streak"] == {"current": 7, "best": 7}
    assert n["past_weeks"][-1]["app_opens"] == [True, False, False, True, True, True, True]


def test_a_missed_day_starts_a_new_run_and_the_best_run_stays():
    friday = date(2026, 11, 27)
    n = numbers(opens=days_of("2026-11-16", 0, 1, 2, 3, 4, 5, 6) + days_of("2026-11-23", 0, 1, 3, 4), today=friday)
    assert n["streak"] == {"current": 2, "best": 9}  # Wednesday was missed; Thursday and today make 2


def test_a_past_week_with_workouts_and_no_opens_has_no_day_opened():
    weekend = [workout(day) for day in days_of("2026-11-16", 5, 6)]
    n = numbers(workouts=weekend, today=MONDAY)
    last_week = n["past_weeks"][-1]
    assert last_week["app_opens"] == [False] * 7
    assert n["streak"] == {"current": 0, "best": 0}  # the workouts add no day to the streak
    assert last_week["done_met_hours"] == pytest.approx(5.0)  # but they count as always: 2 x 2.5
    assert last_week["active_days"] == [False, False, False, False, False, True, True]


def test_a_past_week_with_some_opens_counts_exactly_those_days():
    weekend = [workout(day) for day in days_of("2026-11-16", 5, 6)]
    opens = days_of("2026-11-16", 1, 2) + ["2026-11-23"]  # Tuesday, Wednesday, and today
    n = numbers(workouts=weekend, opens=opens, today=MONDAY)
    assert n["past_weeks"][-1]["app_opens"] == [False, True, True, False, False, False, False]
    assert n["past_weeks"][-1]["active_days"] == [False, False, False, False, False, True, True]
    assert n["streak"] == {"current": 1, "best": 2}  # Sunday had a workout but no open, so today starts a new run


def test_a_workout_this_week_does_not_open_its_day():
    n = numbers(workouts=[workout("2026-11-23")])  # a workout on Monday, synced later; the app wasn't opened
    assert n["this_week"]["app_opens"] == [False] * 7
    assert n["streak"]["current"] == 0


def test_whatever_is_dated_after_today_is_left_out():
    n = numbers(workouts=[workout("2026-11-23"), workout("2026-11-27", met=6.0, minutes=60)], opens=["2026-11-25", "2026-11-27", "2026-11-28"])
    week = n["this_week"]
    assert week["done_met_hours"] == pytest.approx(2.5)
    assert week["active_days"] == [True, False, False, False, False, False, False]
    assert week["app_opens"] == [False, False, True, False, False, False, False]
    assert [row["day"] for row in week["workouts"]] == [0]
    assert n["streak"] == {"current": 1, "best": 1}


# --- The past weeks ----------------------------------------------------------------------------


def test_past_weeks_run_from_the_earliest_week_memory_knows_to_last_week():
    # A goal saved three weeks ago and nothing since: three empty weeks, not none.
    goals = [{"week_start": "2026-11-02", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]
    n = numbers(goals=goals)
    assert [week["week_start"] for week in n["past_weeks"]] == ["2026-11-02", "2026-11-09", "2026-11-16"]
    assert [week["done_met_hours"] for week in n["past_weeks"]] == [0, 0, 0]
    assert n["this_week"]["week_start"] == "2026-11-23"
    assert n["goal_offer"]["kind"] == "lower"  # under half the goal three weeks in a row


def test_a_new_user_has_no_past_weeks():
    n = numbers()
    assert n["past_weeks"] == [] and n["months"] == []
    assert (n["trophy"], n["trophies"]) == (False, 0)
    assert n["goal_offer"]["kind"] == "keep"
    assert n["summary"]["weeks"] == 0 and n["summary"]["avg_met_hours"] == 0


def test_a_week_before_the_first_goal_saved_runs_on_that_first_goal():
    # A workout from four weeks back (brought in from Fitbit); the only goal saved is this week's.
    n = numbers(workouts=[workout("2026-10-28", met=5.0, minutes=90)])
    assert [week["week_start"] for week in n["past_weeks"]] == ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]
    first = n["past_weeks"][0]
    assert (first["goal_met_hours"], first["plan"], first["trophy"]) == (7.5, PLAN, True)


def test_each_week_keeps_the_goal_it_had():
    goals = [
        {"week_start": "2026-11-02", "goal_met_hours": 5.0, "goal_set_by": "default", "plan": PLAN},
        {"week_start": "2026-11-16", "goal_met_hours": 10.0, "goal_set_by": "recap", "plan": None},  # the goal changed, the plan didn't
    ]
    done = [workout("2026-11-03", minutes=60), workout("2026-11-10", met=6.0, minutes=60), workout("2026-11-17", met=6.0, minutes=60)]
    n = numbers(workouts=done, goals=goals)
    assert [week["goal_met_hours"] for week in n["past_weeks"]] == [5.0, 5.0, 10.0]
    assert [week["plan"] for week in n["past_weeks"]] == [PLAN, PLAN, PLAN]
    assert [week["trophy"] for week in n["past_weeks"]] == [True, True, False]  # 5.0 of 5, 6.0 of 5, 6.0 of 10
    assert n["this_week"]["goal_met_hours"] == 10.0
    assert n["trophies"] == 2


def test_a_week_counts_its_workouts_the_way_the_calculator_does():
    week = numbers(workouts=[
        workout("2026-11-23", met=2.0, minutes=30, name="Stretching"),  # light: active, but nothing toward the goal
        workout("2026-11-24", met=6.8, minutes=30, source="fitbit", confirmed=False, band="very"),  # counts at 6.0
        workout("2026-11-25", met=4.0, minutes=45, name="Walking, treadmill", code="17358"),
    ])["this_week"]
    assert week["done_by_day"] == pytest.approx([0, 3.0, 3.0, 0, 0, 0, 0])
    assert week["done_met_hours"] == pytest.approx(6.0)
    assert week["active_days"] == [True, True, True, False, False, False, False]
    assert week["minutes"] == 105
    assert [(r["day"], r["counted_met"], r["met_hours"], r["intensity"]) for r in week["workouts"]] == [
        (0, 2.0, 0.0, "light"), (1, 6.0, 3.0, "vigorous"), (2, 4.0, 3.0, "moderate"),
    ]
    assert week["top_activity"] == {"activity_code": "17358", "activity_name": "Walking, treadmill", "minutes": 45}


def test_this_weeks_trophy_counts_as_soon_as_the_goal_is_reached():
    n = numbers(workouts=[workout("2026-11-17", met=6.0, minutes=75), workout("2026-11-23", met=6.0, minutes=75)])
    assert n["past_weeks"][-1]["trophy"] is True  # 7.5 of 7.5
    assert (n["trophy"], n["trophies"]) == (True, 2)


# --- The months (src/lib/periods.test.ts) ------------------------------------------------------


def test_a_week_belongs_to_the_month_its_thursday_falls_in():
    assert progress._month_of(date(2026, 8, 31)) == "2026-09"  # Aug 31 → September
    assert progress._month_of(date(2026, 9, 28)) == "2026-10"  # Sep 28 → October
    assert progress._month_of(date(2026, 10, 26)) == "2026-10"
    assert progress._month_of(date(2025, 12, 29)) == "2026-01"  # its Thursday is Jan 1


def test_months_add_up_met_hours_goals_trophies_active_days_and_streaks_newest_first():
    # As in the app's test: three October weeks doing 8, 5 and 9; the app opened every day but Sunday.
    goals = [{"week_start": "2026-09-28", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]
    done = (
        [workout(day, met=4.0, minutes=30) for day in days_of("2026-10-05", 0, 1, 2, 3)]  # 4 days × 2.0 = 8
        + [workout(day, met=5.0, minutes=30) for day in days_of("2026-10-12", 0, 1)]  # 2 days × 2.5 = 5
        + [workout(day, met=3.6, minutes=30) for day in days_of("2026-10-19", 0, 1, 2, 3, 4)]  # 5 days × 1.8 = 9
    )
    opens = [day for week in ("2026-10-05", "2026-10-12", "2026-10-19") for day in days_of(week, 0, 1, 2, 3, 4, 5)]
    months = numbers(workouts=done, opens=opens, goals=goals, today=date(2026, 10, 26))["months"]

    assert [(m["month"], len(m["week_starts"])) for m in months] == [("2026-10", 4)]  # Sep 28 counts in October too
    october = months[0]
    assert october["week_starts"] == ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]
    assert october["done_met_hours"] == pytest.approx(22)
    assert october["goal_met_hours"] == pytest.approx(30)  # four weeks at 7.5
    assert (october["trophies"], october["active_days"], october["app_open_days"]) == (2, 11, 18)
    assert october["best_streak"] == 6
    assert october["partial"] is True  # this week, Oct 26, is an October week as well


def test_months_come_newest_first_and_a_finished_month_is_not_partial():
    goals = [{"week_start": "2026-10-05", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]
    months = numbers(goals=goals)["months"]  # today is Wednesday Nov 25
    assert [(m["month"], len(m["week_starts"]), m["partial"]) for m in months] == [("2026-11", 3, True), ("2026-10", 4, False)]


# --- The Summary page --------------------------------------------------------------------------

BIKE = dict(name="Bicycling, stationary", code="01216")
WALK = dict(name="Walking, treadmill", code="17358")
SIX_WEEKS = [
    workout("2026-10-12", met=3.0, minutes=60, name="Walking"),  # week of Oct 12: 3.0
    workout("2026-10-19", met=5.0, minutes=90, name="Bicycling"),  # Oct 19: 7.5, a trophy
    workout("2026-10-28", met=4.0, minutes=60, **WALK),  # Oct 26: 4.0
    workout("2026-11-03", met=6.0, minutes=60, **BIKE),  # Nov 2: 6.0 …
    workout("2026-11-05", met=2.0, minutes=30, name="Stretching"),  # … plus a light half hour
    workout("2026-11-09", met=6.0, minutes=80, **BIKE),  # Nov 9: 8.0, a trophy
    workout("2026-11-21", met=4.0, minutes=30, **WALK),  # Nov 16: 2.0 …
    workout("2026-11-22", met=4.0, minutes=45, **WALK),  # … + 3.0 = 5.0
    workout("2026-11-23", met=5.0, minutes=30, name="Bicycling"),  # this week: 2.5
]


def test_summary_averages_the_last_4_full_weeks():
    n = numbers(workouts=SIX_WEEKS)
    s = n["summary"]
    assert s["weeks"] == 4
    assert s["avg_met_hours"] == pytest.approx(5.75)  # (4.0 + 6.0 + 8.0 + 5.0) / 4
    assert s["avg_brisk_min"] == 115
    assert s["pct_of_guideline"] == pytest.approx(5.75 / 7.5)
    assert s["goal_min"] == 150
    assert s["goal_weeks"] == 1  # only the 8.0 week reached 7.5
    assert s["avg_active_days"] == pytest.approx(1.5)  # 1, 2, 1, 2
    assert [(c["week_start"], c["days"].count(True)) for c in s["calendar"]] == [
        ("2026-10-26", 1), ("2026-11-02", 2), ("2026-11-09", 1), ("2026-11-16", 2),
    ]
    assert (n["trophies"], n["goal_offer"]["kind"]) == (2, "keep")


def test_summary_chart_is_the_last_6_weeks_ending_with_this_one():
    chart = numbers(workouts=SIX_WEEKS)["summary"]["chart"]
    assert [c["week_start"] for c in chart] == ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]
    assert [c["met_hours"] for c in chart] == pytest.approx([7.5, 4.0, 6.0, 8.0, 5.0, 2.5])
    assert [c["brisk_min"] for c in chart] == [150, 80, 120, 160, 100, 50]
    assert [c["reached"] for c in chart] == [True, False, False, True, False, False]
    assert [c["current"] for c in chart] == [False, False, False, False, False, True]
    assert {c["goal_min"] for c in chart} == {150}


def test_summary_minutes_a_week_by_effort_and_by_activity():
    s = numbers(workouts=SIX_WEEKS)["summary"]
    # Over the 4 weeks: light 30, moderate 60 + 30 + 45 = 135, vigorous 60 + 80 = 140. Halves round up.
    assert s["intensity"] == {"light": 8, "moderate": 34, "vigorous": 35}
    assert s["mix"] == [
        {"activity_code": "01216", "activity_name": "Bicycling, stationary", "min_per_week": 35},
        {"activity_code": "17358", "activity_name": "Walking, treadmill", "min_per_week": 34},
        {"activity_code": None, "activity_name": "Stretching", "min_per_week": 8},
    ]


def test_summary_groups_minutes_by_the_activitys_name():
    # Two kinds of walking with different table codes, saved under one name: one activity, as in the app.
    walks = [
        workout("2026-11-16", met=3.5, minutes=60, name="Walking", code="17190"),
        workout("2026-11-17", met=4.3, minutes=60, name="Walking", code="17200"),
        workout("2026-11-18", met=6.0, minutes=100, name="Cycling", code="01010"),
    ]
    assert numbers(workouts=walks)["summary"]["mix"] == [
        {"activity_code": "17190", "activity_name": "Walking", "min_per_week": 120},
        {"activity_code": "01010", "activity_name": "Cycling", "min_per_week": 100},
    ]


def test_weeks_add_up_the_way_the_app_adds_them():
    # 6.8 + 1.025 + 2.175 + 1.675 is 11.675 added in order, and 233.5 brisk minutes rounds up to 234.
    # Python 3.12's sum() makes it 11.674999999999999 and 233.
    week = [
        workout("2026-11-16", met=6.8, minutes=60), workout("2026-11-17", met=4.1, minutes=15),
        workout("2026-11-18", met=8.7, minutes=15), workout("2026-11-19", met=6.7, minutes=15),
    ]
    n = numbers(workouts=week)
    assert n["past_weeks"][0]["done_met_hours"] == 11.675
    assert n["summary"]["avg_brisk_min"] == 234
    assert n["summary"]["chart"][0]["brisk_min"] == 234


def test_summary_longest_gap_is_counted_over_everything_on_record_up_to_today():
    n = numbers(workouts=SIX_WEEKS)
    assert n["summary"]["longest_gap"] == 11  # Nov 10 to Nov 20; a light day (Nov 5) is still an active day
    assert n["past_weeks"][-1]["top_activity"] == {"activity_code": "17358", "activity_name": "Walking, treadmill", "minutes": 75}


# --- Reading from Memory -----------------------------------------------------------------------


def test_it_works_from_what_memory_gives_back(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    memory.save("sam", {
        "goals": THIS_WEEK,
        "daily": {
            "workouts": [
                {"id": "w1", "date": "2026-11-17", "activity_name": "Bicycling", "met": 6.0, "duration_min": 75},
                {"id": "w2", "date": "2026-11-23", "activity_name": "Bicycling", "met": 5.0, "duration_min": 30},
            ],
            "app_opens": ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"],
        },
    })
    mem = memory.read("sam", ["goals", "daily"])
    n = progress.numbers(mem["goals"], mem["daily"], WEDNESDAY)
    assert n["streak"] == {"current": 4, "best": 4}  # Sunday, Monday, Tuesday, today
    assert [week["week_start"] for week in n["past_weeks"]] == ["2026-11-16"]
    assert n["past_weeks"][0]["done_met_hours"] == pytest.approx(7.5)
    assert n["this_week"]["done_met_hours"] == pytest.approx(2.5)
    assert (n["trophy"], n["trophies"]) == (False, 1)
    assert [row["id"] for row in n["this_week"]["workouts"]] == ["w2"]


def test_no_goal_saved_yet_says_so(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    mem = memory.read("nobody", ["goals", "daily"])  # a user Memory knows nothing about
    with pytest.raises(NotEnoughMemory, match="no weekly goal"):
        progress.numbers(mem["goals"], mem["daily"], WEDNESDAY)


# --- More than RECENT_WEEKS past weeks ---------------------------------------------------------
# With today on Wednesday 2026-11-25, last week starts 2026-11-16. The 26 most recent past weeks
# start on 2026-05-25 (26 Mondays back from 2026-11-23) and run to 2026-11-16. Thirty past weeks
# start on 2026-04-27, so the four oldest (04-27, 05-04, 05-11, 05-18) are outside the 26.


def weeks_back(n):
    """The Monday n weeks before MONDAY, as a date string: weeks_back(1) is last week's start."""
    return (MONDAY - timedelta(weeks=n)).isoformat()


def long_history(weeks=30):
    """(goals, workouts, opens) for a user whose first goal was saved `weeks` weeks ago, goal 7.5.

    The oldest week (weeks ago) has one 7.5 MET-hour workout on its Monday and the second oldest one on its
    Sunday: both reach the goal. The three weeks after them have one 2.5 workout on their Monday, and so does
    every week after, this week too. The Sunday workout leaves the longest gap in the oldest weeks: the 12 days
    between the first Monday and the next Sunday. The opens are 5 days in a row in the oldest week.
    """
    first = weeks_back(weeks)
    goals = [{"week_start": first, "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]
    workouts = [workout(first, met=5.0, minutes=90), workout(days_of(weeks_back(weeks - 1), 6)[0], met=5.0, minutes=90)]
    workouts += [workout(weeks_back(n)) for n in range(weeks - 2, 0, -1)] + [workout(MONDAY.isoformat())]
    return goals, workouts, days_of(first, 0, 1, 2, 3, 4)


def test_past_weeks_are_the_last_recent_weeks_oldest_first():
    goals, workouts, opens = long_history(30)
    weeks = [week["week_start"] for week in numbers(goals=goals, workouts=workouts, opens=opens)["past_weeks"]]
    assert len(weeks) == progress.RECENT_WEEKS == 26
    assert (weeks[0], weeks[-1]) == ("2026-05-25", "2026-11-16")
    assert weeks == [weeks_back(n) for n in range(26, 0, -1)]  # one Monday after the other, no gaps


@pytest.mark.parametrize("past, kept, first", [
    (progress.RECENT_WEEKS - 1, 25, "2026-06-01"),  # 25 past weeks: all of them
    (progress.RECENT_WEEKS, 26, "2026-05-25"),  # exactly 26: nothing cut
    (progress.RECENT_WEEKS + 1, 26, "2026-05-25"),  # 27: the oldest one (05-18) is cut
])
def test_nothing_is_cut_up_to_recent_weeks_and_the_oldest_goes_after_that(past, kept, first):
    goals = [{"week_start": weeks_back(past), "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}]
    weeks = numbers(goals=goals)["past_weeks"]
    assert len(weeks) == kept
    assert (weeks[0]["week_start"], weeks[-1]["week_start"]) == (first, "2026-11-16")


def test_trophies_count_weeks_older_than_the_recent_ones():
    goals, workouts, opens = long_history(30)
    n = numbers(goals=goals, workouts=workouts, opens=opens)
    # The two trophy weeks (04-27 and 05-04) are among the four that "past_weeks" no longer has.
    assert [week["trophy"] for week in n["past_weeks"]] == [False] * 26
    assert (n["trophy"], n["trophies"]) == (False, 2)


def test_the_best_streak_keeps_a_run_in_weeks_older_than_the_recent_ones():
    goals, workouts, opens = long_history(30)
    n = numbers(goals=goals, workouts=workouts, opens=opens)
    assert all(not any(week["app_opens"]) for week in n["past_weeks"])  # no open in the 26 weeks shown
    assert n["streak"] == {"current": 0, "best": 5}  # Monday to Friday of the oldest week


def test_months_are_made_from_the_recent_weeks_only():
    goals, workouts, opens = long_history(30)
    n = numbers(goals=goals, workouts=workouts, opens=opens)
    in_months = [start for month in n["months"] for start in month["week_starts"]]
    assert sorted(in_months) == [week["week_start"] for week in n["past_weeks"]]  # the same 26 weeks
    # A week belongs to the month of its Thursday: 05-25 is a May week, and April is not there at all.
    assert [month["month"] for month in n["months"]] == [f"2026-{m:02d}" for m in (11, 10, 9, 8, 7, 6, 5)]
    assert n["months"][-1]["week_starts"] == ["2026-05-25"]
    assert sum(month["trophies"] for month in n["months"]) == 0  # the trophy weeks are older than these


def test_the_longest_gap_still_sees_weeks_older_than_the_recent_ones():
    goals, workouts, opens = long_history(30)
    n = numbers(goals=goals, workouts=workouts, opens=opens)
    # Apr 28 to May 9 (the first Monday's workout, then the next Sunday's) is 12 days without one.
    # Every week after has a Monday workout, so the gaps there are at most 6.
    assert n["summary"]["longest_gap"] == 12


def test_the_goal_offer_and_summary_averages_follow_the_latest_weeks():
    goals, workouts, opens = long_history(30)
    n = numbers(goals=goals, workouts=workouts, opens=opens)
    assert n["summary"]["weeks"] == progress.SUMMARY_WEEKS  # four full weeks, however many there are
    assert n["summary"]["avg_met_hours"] == pytest.approx(2.5)  # each of the last four had one 2.5 workout
