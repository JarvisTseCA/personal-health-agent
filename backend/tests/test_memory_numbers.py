"""Every number on the app's screens, from Memory (app/memory_numbers.py), and the routes that hand them out:
GET /api/numbers, and the /api/memory routes when the request says which day it is (?date=)."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import calculator, main, memory, memory_numbers, progress
from app.memory_suggest import NotEnoughMemory

WEDNESDAY = date(2026, 11, 25)  # its week starts Monday 2026-11-23
PLAN = ["30", "off", "30", "off", "off", "45", "off"]

# Sam on Wednesday: 7.5 done last week (a trophy), 2.5 on Monday, the app opened Sunday to Tuesday.
SAM = {
    "goals": [{"week_start": "2026-11-16", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}],
    "daily": {
        "workouts": [
            {"id": "w-last", "date": "2026-11-17", "activity_name": "Bicycling", "met": 6.0, "duration_min": 75},
            {"id": "w-mon", "date": "2026-11-23", "activity_name": "Bicycling", "met": 5.0, "duration_min": 30},
        ],
        "app_opens": ["2026-11-22", "2026-11-23", "2026-11-24"],
    },
    "health": {"vo2_max": [
        {"month": "2026-09", "ml_kg_min": 38.0}, {"month": "2026-10", "ml_kg_min": 39.5}, {"month": "2026-11", "ml_kg_min": 41.0},
    ]},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A backend with its own database and Sam in Memory."""
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    memory.save("sam", SAM)
    return TestClient(main.app)


# --- Put together from Memory ------------------------------------------------------------------


def test_one_piece_with_every_part(client):
    n = memory_numbers.for_user("sam", WEDNESDAY)
    assert set(n) == {
        "today", "today_index", "day", "this_week", "streak", "trophy", "trophies",
        "past_weeks", "months", "goal_offer", "summary", "vo2",
    }
    assert (n["today"], n["today_index"]) == ("2026-11-25", 2)
    assert n["streak"] == {"current": 0, "best": 3}  # Sunday to Tuesday were opened; today isn't on record yet
    assert (n["trophy"], n["trophies"]) == (False, 1)
    assert [week["week_start"] for week in n["past_weeks"]] == ["2026-11-16"]
    assert n["summary"]["weeks"] == 1


def test_this_week_has_each_days_target_and_what_is_left(client):
    week = memory_numbers.for_user("sam", WEDNESDAY)["this_week"]
    # 2.5 done on Monday, 5.0 left. Wednesday has 30 of the 75 minutes still planned, Saturday 45.
    assert week["done_met_hours"] == pytest.approx(2.5)
    assert week["left_met_hours"] == pytest.approx(5.0)
    assert week["targets"] == pytest.approx([7.5 * 30 / 105, 0, 2.0, 0, 0, 3.0, 0])
    assert week["targets"] == calculator.daily_targets(7.5, PLAN, week["done_by_day"], 2)
    assert week["unplanned_met_hours"] == 0


def test_todays_numbers_are_the_ones_a_suggestion_is_based_on(client):
    n = memory_numbers.for_user("sam", WEDNESDAY)
    today = calculator.today_numbers(7.5, PLAN, memory.read("sam", ["daily"])["daily"]["workouts"], WEDNESDAY)
    assert n["day"] == {
        "name": "Wednesday",
        "target_met_hours": today["target_met_hours"],
        "done_met_hours": today["done_today_met_hours"],
        "needed_met_hours": today["needed_met_hours"],
        "reached": False,
    }
    assert n["day"]["target_met_hours"] == pytest.approx(2.0)


def test_today_is_reached_once_its_target_is_met_and_never_on_a_day_without_one(client):
    memory.save("sam", {"daily": {"workouts": [
        {"id": "w-wed", "date": "2026-11-25", "activity_name": "Bicycling", "met": 6.0, "duration_min": 20},  # 2.0 of 2.0
    ]}})
    assert memory_numbers.for_user("sam", WEDNESDAY)["day"]["reached"] is True
    thursday = memory_numbers.for_user("sam", date(2026, 11, 26))["day"]  # Thursday is off: no target to reach
    assert (thursday["target_met_hours"], thursday["reached"]) == (0, False)


def test_met_hours_no_day_is_left_for_are_reported(client):
    # Sunday, the last day of the week, and it is off: what is still left has nowhere to go.
    week = memory_numbers.for_user("sam", date(2026, 11, 29))["this_week"]
    assert week["unplanned_met_hours"] == pytest.approx(5.0)


def test_vo2_max_gives_the_latest_reading_and_the_change_since_the_first(client):
    vo2 = memory_numbers.for_user("sam", WEDNESDAY)["vo2"]
    assert [r["month"] for r in vo2["series"]] == ["2026-09", "2026-10", "2026-11"]
    assert (vo2["latest"], vo2["change"]) == (41.0, 3.0)
    assert vo2["peak_mets"] == pytest.approx(41.0 / 3.5)


def test_vo2_max_stops_at_this_month_and_is_empty_without_a_reading():
    readings = [{"month": "2026-10", "ml_kg_min": 39.5}, {"month": "2026-11", "ml_kg_min": 41.0}, {"month": "2026-12", "ml_kg_min": 44.0}]
    assert memory_numbers.vo2_of(readings, WEDNESDAY)["latest"] == 41.0
    assert memory_numbers.vo2_of(readings, date(2026, 10, 5)) == {
        "series": [{"month": "2026-10", "ml_kg_min": 39.5}], "latest": 39.5, "change": 0.0, "peak_mets": pytest.approx(39.5 / 3.5),
    }
    assert memory_numbers.vo2_of([], WEDNESDAY) is None
    assert memory_numbers.vo2_of(readings, date(2026, 9, 30)) is None


def test_without_a_goal_in_memory_there_is_nothing_to_work_out(client):
    with pytest.raises(NotEnoughMemory, match="no weekly goal"):
        memory_numbers.for_user("nobody", WEDNESDAY)


# --- GET /api/numbers --------------------------------------------------------------------------


def numbers(client, user="sam", day="2026-11-25"):
    return client.get("/api/numbers", params={"user_id": user, "date": day}).json()


def test_numbers_route_gives_the_numbers_for_the_day_asked(client):
    res = client.get("/api/numbers?user_id=sam&date=2026-11-25")
    assert res.status_code == 200
    assert res.json() == {"numbers": memory_numbers.for_user("sam", WEDNESDAY)}
    assert numbers(client, day="2026-11-23")["numbers"]["streak"] == {"current": 2, "best": 2}  # Sunday and Monday


def test_numbers_route_without_a_date_uses_the_backends_own_day(client):
    assert client.get("/api/numbers?user_id=sam").json()["numbers"]["today"] == date.today().isoformat()


def test_numbers_route_for_a_user_with_no_goal_says_what_is_missing(client):
    data = numbers(client, user="nobody")
    assert data["numbers"] is None
    assert "no weekly goal" in data["numbers_missing"]


def test_numbers_route_refuses_a_date_it_cannot_read(client):
    res = client.get("/api/numbers?user_id=sam&date=tomorrow")
    assert res.status_code == 422
    assert "2026-11-23" in res.json()["detail"]  # the message shows what a date looks like


def test_asking_for_numbers_saves_nothing(client):
    before = memory.read("sam")
    numbers(client)
    assert memory.read("sam") == before  # reading the numbers writes nothing, not even today as opened


# --- The /api/memory routes, with ?date= -------------------------------------------------------


def test_a_save_with_a_date_comes_back_with_the_numbers_after_it(client):
    res = client.post("/api/memory?user_id=sam&date=2026-11-25", json={"daily": {"workouts": [
        {"id": "w-wed", "date": "2026-11-25", "activity_name": "Bicycling", "met": 6.0, "duration_min": 50},  # 5.0 more
    ]}})
    data = res.json()
    assert data["ok"] is True
    assert data["numbers"]["this_week"]["done_met_hours"] == pytest.approx(7.5)
    assert (data["numbers"]["trophy"], data["numbers"]["trophies"]) == (True, 2)
    assert data["numbers"] == numbers(client)["numbers"]


def test_a_save_without_a_date_answers_as_before(client):
    res = client.post("/api/memory?user_id=sam", json={"daily": {"app_opens": ["2026-11-25"]}})
    assert res.json() == {"ok": True}


def test_a_save_before_any_goal_says_what_is_missing(client):
    data = client.post("/api/memory?user_id=new&date=2026-11-25", json={"who": {"name": "New"}}).json()
    assert data["ok"] is True and data["numbers"] is None
    assert "no weekly goal" in data["numbers_missing"]


def test_a_save_with_a_date_it_cannot_read_stores_nothing(client):
    res = client.post("/api/memory?user_id=sam&date=25-11-2026", json={"daily": {"app_opens": ["2026-11-25"]}})
    assert res.status_code == 422
    assert memory.read("sam", ["daily"])["daily"]["app_opens"] == SAM["daily"]["app_opens"]


def test_a_delete_with_a_date_comes_back_with_the_numbers_without_it(client):
    data = client.delete("/api/memory/workouts/w-last?user_id=sam&date=2026-11-25").json()
    assert data["ok"] is True
    assert data["numbers"]["past_weeks"][0]["done_met_hours"] == 0
    assert data["numbers"]["trophies"] == 0
    assert client.delete("/api/memory/workouts/w-mon?user_id=sam").json() == {"ok": True}


def test_reading_memory_with_a_date_gives_the_numbers_too(client):
    data = client.get("/api/memory?user_id=sam&date=2026-11-25").json()
    assert set(data) == {"memory", "numbers"}
    assert data["memory"] == memory.read("sam")
    assert data["numbers"] == numbers(client)["numbers"]
    assert set(client.get("/api/memory?user_id=sam").json()) == {"memory"}


# --- recent(): Memory as the app is given it ---------------------------------------------------
# With today on Wednesday 2026-11-25 the window starts on the Monday 26 weeks before this week's:
# Monday 2026-05-25. Sunday 2026-05-24 is the last day outside it.

FIRST = "2026-05-25"
BEFORE = "2026-05-24"
OLD = "2026-01-05"  # much older


def goal_row(week, hours=7.5, plan=PLAN):
    return {"week_start": week, "goal_met_hours": hours, "goal_set_by": "default", "plan": plan}


def work(wid, day):
    return {"id": wid, "date": day, "activity_name": "Walking", "met": 3.5, "duration_min": 30}


def full_memory():
    """What memory.read() gives for a user with an entry on each side of the window's first day."""
    days = [BEFORE, FIRST, "2026-11-25", "2026-11-27"]  # outside, the first day, today, after today
    return {
        "who": {"name": "Alex", "fitbit_connected": True},
        "preferences": {"categories": {"Walking": "like"}, "equipment": {"home": ["Dumbbells"], "gym": None}, "no_vigorous": False},
        "goals": [goal_row("2026-05-18"), goal_row(FIRST), goal_row("2026-11-23")],
        "daily": {
            "check_ins": [{"date": d, "minutes": 30, "place": "outside", "energy": "normal", "mood": "surprise"} for d in days],
            "suggestions": [{"id": f"s-{d}", "date": d, "outcome": "accepted"} for d in days],
            "workouts": [work(f"w-{d}", d) for d in days],
            "app_opens": days,
        },
        "health": {
            "vo2_max": [{"month": "2026-01", "ml_kg_min": 38.0, "source": "fitbit"}],
            "heart_rates": [{"workout_id": f"w-{BEFORE}", "avg_bpm": 120}, {"workout_id": f"w-{FIRST}", "avg_bpm": 130}],
        },
        "other": {"notes": [{"id": "n1", "text": "knee is sore", "where": "Today: mood"}]},
    }


def test_recent_leaves_out_what_is_dated_before_the_first_monday_of_the_window():
    daily = memory_numbers.recent(full_memory(), WEDNESDAY)["daily"]
    kept = [FIRST, "2026-11-25", "2026-11-27"]  # the first Monday stays, so do today and the days after it
    assert [e["date"] for e in daily["check_ins"]] == kept
    assert [e["date"] for e in daily["suggestions"]] == kept
    assert [e["date"] for e in daily["workouts"]] == kept
    assert daily["app_opens"] == kept


def test_recent_drops_the_heart_rate_of_a_dropped_workout_and_keeps_the_rest():
    health = memory_numbers.recent(full_memory(), WEDNESDAY)["health"]
    assert health["heart_rates"] == [{"workout_id": f"w-{FIRST}", "avg_bpm": 130}]
    assert health["vo2_max"] == full_memory()["health"]["vo2_max"]  # VO2 max has no week to go by


def test_recent_keeps_the_goal_rows_in_the_window():
    goals = [goal_row(FIRST), goal_row("2026-08-03"), goal_row("2026-11-23")]
    mem = {"goals": goals}
    assert memory_numbers.recent(mem, WEDNESDAY)["goals"] == goals


def test_recent_carries_the_one_row_before_the_window_that_has_both_the_goal_and_the_plan():
    older, latest = goal_row(OLD, 5.0), goal_row("2026-03-02", 6.0, ["off"] * 7)
    mem = {"goals": [goal_row("2025-12-01", 4.0), older, latest, goal_row(FIRST), goal_row("2026-11-23")]}
    # Only the latest before the window stays: it has the goal and the plan both.
    assert memory_numbers.recent(mem, WEDNESDAY)["goals"] == [latest, goal_row(FIRST), goal_row("2026-11-23")]


def test_recent_carries_two_earlier_rows_when_the_latest_has_no_goal():
    goal_row_a = goal_row(OLD, 5.0, PLAN)
    plan_row_b = goal_row("2026-03-02", None, ["off"] * 7)  # a plan saved with no goal
    mem = {"goals": [goal_row("2025-12-01", 4.0, ["10"] * 7), goal_row_a, plan_row_b, goal_row("2026-11-23")]}
    # The goal still in force is row a's, the plan is row b's; the 2025 row is much older than both.
    assert memory_numbers.recent(mem, WEDNESDAY)["goals"] == [goal_row_a, plan_row_b, goal_row("2026-11-23")]


def test_recent_carries_the_goal_row_when_the_latest_has_no_plan():
    goal_only = goal_row("2026-03-02", 6.0, None)
    plan_row = goal_row(OLD, 5.0, PLAN)
    mem = {"goals": [plan_row, goal_only]}
    assert memory_numbers.recent(mem, WEDNESDAY)["goals"] == [plan_row, goal_only]  # oldest first


def test_recent_leaves_who_preferences_and_other_as_they_were():
    mem = full_memory()
    out = memory_numbers.recent(mem, WEDNESDAY)
    for group in ("who", "preferences", "other"):
        assert out[group] == full_memory()[group]


def test_recent_works_on_the_groups_it_is_given():
    mem = full_memory()
    assert set(memory_numbers.recent({"preferences": mem["preferences"]}, WEDNESDAY)) == {"preferences"}
    only_goals = memory_numbers.recent({"goals": [goal_row(OLD), goal_row("2026-11-23")]}, WEDNESDAY)
    assert set(only_goals) == {"goals"} and len(only_goals["goals"]) == 2
    only_daily = memory_numbers.recent({"daily": mem["daily"]}, WEDNESDAY)
    assert set(only_daily) == {"daily"} and len(only_daily["daily"]["workouts"]) == 3
    # Health alone can't tell which workouts are kept: its heart rates stay as they were.
    assert memory_numbers.recent({"health": mem["health"]}, WEDNESDAY) == {"health": mem["health"]}
    assert memory_numbers.recent({}, WEDNESDAY) == {}


def test_recent_does_not_change_the_memory_it_is_given():
    mem = full_memory()
    memory_numbers.recent(mem, WEDNESDAY)
    assert mem == full_memory()


def test_the_window_moves_with_the_day_asked():
    # On Monday 2026-06-01 the window starts 26 weeks back: 2025-12-01. Everything here is inside it.
    daily = memory_numbers.recent(full_memory(), date(2026, 6, 1))["daily"]
    assert [e["date"] for e in daily["workouts"]] == [BEFORE, FIRST, "2026-11-25", "2026-11-27"]


# --- GET /api/memory: all of Memory, or the recent part with ?date= ----------------------------

OLD_DAY = "2026-04-28"  # 30 weeks back, in the week of 2026-04-27


@pytest.fixture
def old_client(client):
    """The client, with Maya added: 30 past weeks of history, a trophy and a 5-day run in the oldest week."""
    memory.save("maya", {
        "goals": [{"week_start": "2026-04-27", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": PLAN}],
        "daily": {
            "check_ins": [{"date": OLD_DAY, "minutes": 30, "place": "outside", "energy": "normal", "mood": "surprise"}],
            "workouts": [
                {"id": "w-old", "date": OLD_DAY, "activity_name": "Bicycling", "met": 5.0, "duration_min": 90},  # 7.5: a trophy
                {"id": "w-new", "date": "2026-11-23", "activity_name": "Walking", "met": 3.5, "duration_min": 30},
            ],
            "app_opens": ["2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01", "2026-11-23"],
        },
        "health": {"heart_rates": [{"workout_id": "w-old", "avg_bpm": 120}]},
    })
    return client


def test_reading_memory_without_a_date_gives_everything_it_holds(old_client):
    mem = old_client.get("/api/memory?user_id=maya").json()["memory"]
    assert [w["id"] for w in mem["daily"]["workouts"]] == ["w-old", "w-new"]
    assert [c["date"] for c in mem["daily"]["check_ins"]] == [OLD_DAY]
    assert len(mem["daily"]["app_opens"]) == 6
    assert mem["goals"][0]["week_start"] == "2026-04-27"
    assert mem["health"]["heart_rates"] == [{"workout_id": "w-old", "avg_bpm": 120}]


def test_reading_memory_with_a_date_leaves_out_what_is_older_than_the_recent_weeks(old_client):
    data = old_client.get("/api/memory?user_id=maya&date=2026-11-25").json()
    assert set(data) == {"memory", "numbers"}
    mem = data["memory"]
    assert [w["id"] for w in mem["daily"]["workouts"]] == ["w-new"]
    assert mem["daily"]["check_ins"] == [] and mem["daily"]["app_opens"] == ["2026-11-23"]
    assert mem["health"]["heart_rates"] == []  # it went with its workout
    # The only goal row is from before the window; the weeks after ran on it, so it stays.
    assert [g["week_start"] for g in mem["goals"]] == ["2026-04-27"]


def test_reading_with_a_date_deletes_nothing(old_client):
    before = old_client.get("/api/memory?user_id=maya").json()
    old_client.get("/api/memory?user_id=maya&date=2026-11-25")
    assert old_client.get("/api/memory?user_id=maya").json() == before
    assert memory.read("maya")["daily"]["workouts"][0]["id"] == "w-old"


def test_the_numbers_in_a_dated_read_still_count_the_older_weeks(old_client):
    n = old_client.get("/api/memory?user_id=maya&date=2026-11-25").json()["numbers"]
    assert len(n["past_weeks"]) == progress.RECENT_WEEKS == 26
    assert n["past_weeks"][0]["week_start"] == "2026-05-25"
    assert n["trophies"] == 1  # the week of 2026-04-27 had 7.5 of its 7.5
    assert n["streak"] == {"current": 0, "best": 5}  # the run in the oldest week; today isn't on record


def test_reading_memory_with_a_date_that_is_not_a_date_is_a_422(old_client):
    res = old_client.get("/api/memory?user_id=maya&date=nonsense")
    assert res.status_code == 422
    assert "2026-11-23" in res.json()["detail"]


def test_reading_one_group_with_a_date_gives_that_group_cut_to_the_recent_weeks(old_client):
    data = old_client.get("/api/memory?user_id=maya&group=daily&date=2026-11-25").json()
    assert set(data["memory"]) == {"daily"}
    assert [w["id"] for w in data["memory"]["daily"]["workouts"]] == ["w-new"]
    assert data["numbers"]["trophies"] == 1
