"""The /api/memory routes: read, add or update, delete one entry, forget a user (app/main.py → app/memory.py)."""
import pytest
from fastapi.testclient import TestClient

from app import main, memory

# What an app could send after onboarding and one day of use.
SAM = {
    "who": {"name": "Sam", "fitbit_connected": False},
    "preferences": {"categories": {"Bicycling": "like"}, "equipment": {"home": ["Yoga mat"], "gym": None}, "no_vigorous": False},
    "goals": [{"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": ["10"] * 7}],
    "daily": {
        "check_ins": [{"date": "2026-11-23", "minutes": 30, "place": "outside", "energy": "normal", "mood": "surprise"}],
        "suggestions": [
            {"id": "d1", "date": "2026-11-23", "place": "outside", "activity_code": "01015",
             "activity_name": "Bicycling, general", "outcome": "declined", "reason": "weather", "note": None},
        ],
        "workouts": [
            {"id": "w1", "date": "2026-11-23", "activity_code": "17190", "activity_name": "Walking, brisk",
             "met": 4.3, "duration_min": 30, "source": "manual", "confirmed": True, "band": None, "start_time": None},
        ],
    },
    "health": {"vo2_max": [{"month": "2026-11", "ml_kg_min": 41.0, "source": "fitbit"}], "heart_rates": []},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    return TestClient(main.app)


def stored(client, user="sam", **params):
    return client.get("/api/memory", params={"user_id": user, **params}).json()["memory"]


# --- Read --------------------------------------------------------------------------------------


def test_a_new_user_reads_as_the_five_groups_empty(client):
    got = stored(client)
    assert tuple(got) == memory.GROUPS
    assert got["who"] == {"name": None, "fitbit_connected": None}
    assert got["daily"] == {"check_ins": [], "suggestions": [], "workouts": []}


def test_what_is_posted_reads_back_the_same(client):
    assert client.post("/api/memory?user_id=sam", json=SAM).json() == {"ok": True}
    assert stored(client) == SAM


def test_read_can_ask_for_some_groups_only(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    res = client.get("/api/memory?user_id=sam&group=preferences&group=goals")
    assert res.json()["memory"] == {"preferences": SAM["preferences"], "goals": SAM["goals"]}


def test_read_names_a_group_that_does_not_exist(client):
    res = client.get("/api/memory?group=likes")
    assert res.status_code == 422
    assert "unknown group(s) likes" in res.json()["detail"]


# --- Add or update -----------------------------------------------------------------------------


def test_a_preference_is_updated_and_a_workout_is_added(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    client.post("/api/memory?user_id=sam", json={
        "preferences": {"categories": {"Bicycling": "dislike"}},  # changed their mind: still one entry
        "daily": {"workouts": [{"id": "w2", "date": "2026-11-24", "activity_name": "Yoga", "met": 3.0, "duration_min": 20}]},
    })
    got = stored(client)
    assert got["preferences"]["categories"] == {"Bicycling": "dislike"}
    assert [w["id"] for w in got["daily"]["workouts"]] == ["w1", "w2"]
    assert got["who"] == SAM["who"] and got["goals"] == SAM["goals"]  # not sent: stay


def test_a_mistake_is_a_422_that_names_it_and_stores_nothing(client):
    res = client.post("/api/memory?user_id=sam", json={
        "who": {"name": "Sam"},
        "goals": [{"week_start": "2026-11-23", "plan": ["30"] * 6}],
    })
    assert res.status_code == 422
    assert "goals[0].plan should be 7 days" in res.json()["detail"]
    assert stored(client)["who"]["name"] is None


def test_the_body_has_to_be_an_object(client):
    assert client.post("/api/memory?user_id=sam", json=["who"]).status_code == 422


# --- Delete ------------------------------------------------------------------------------------


def test_one_entry_is_deleted_and_asking_again_is_a_404(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    assert client.delete("/api/memory/suggestions/d1?user_id=sam").json() == {"ok": True}
    got = stored(client)
    assert got["daily"]["suggestions"] == []
    assert got["daily"]["workouts"] == SAM["daily"]["workouts"]  # the rest stays

    again = client.delete("/api/memory/suggestions/d1?user_id=sam")
    assert again.status_code == 404
    assert "no suggestions entry 'd1'" in again.json()["detail"]


def test_a_check_in_is_deleted_by_its_date(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    assert client.delete("/api/memory/check_ins/2026-11-23?user_id=sam").status_code == 200
    assert stored(client)["daily"]["check_ins"] == []


def test_only_daily_entries_can_be_deleted_one_by_one(client):
    res = client.delete("/api/memory/vo2_max/2026-11?user_id=sam")
    assert res.status_code == 422
    assert "check_ins, suggestions, workouts" in res.json()["detail"]


def test_forgetting_a_user_leaves_the_others(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    client.post("/api/memory?user_id=alex", json={"who": {"name": "Alex"}})
    assert client.delete("/api/memory?user_id=sam").json() == {"ok": True}
    assert stored(client)["who"]["name"] is None
    assert stored(client)["goals"] == []
    assert stored(client, user="alex")["who"]["name"] == "Alex"


# --- Next to what was there before -------------------------------------------------------------


def test_without_a_user_id_it_is_the_development_user(client):
    client.post("/api/memory", json={"who": {"name": "Dev"}})
    assert stored(client, user="demo")["who"]["name"] == "Dev"
    assert stored(client)["who"]["name"] is None  # sam


def test_memory_and_the_saved_app_state_are_separate(client):
    client.put("/api/state?user_id=sam", json={"version": 2, "goal": 7.5})
    client.post("/api/memory?user_id=sam", json=SAM)

    client.delete("/api/memory?user_id=sam")
    assert client.get("/api/state?user_id=sam").json() == {"state": {"version": 2, "goal": 7.5}}

    client.post("/api/memory?user_id=sam", json=SAM)
    client.delete("/api/state?user_id=sam")
    assert stored(client) == SAM
