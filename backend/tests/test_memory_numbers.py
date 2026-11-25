"""Every number on the app's screens, from Memory (app/memory_numbers.py), and the routes that hand them out:
GET /api/numbers, and the /api/memory routes when the request says which day it is (?date=)."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import calculator, main, memory, memory_numbers
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
    assert n["streak"] == {"current": 4, "best": 4}  # Sunday, Monday, Tuesday, today
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
    assert memory.read("sam") == before  # today counts in the streak, but it isn't written down as opened


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
