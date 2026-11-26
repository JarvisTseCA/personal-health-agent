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
        "app_opens": ["2026-11-23"],
    },
    "health": {"vo2_max": [{"month": "2026-11", "ml_kg_min": 41.0, "source": "fitbit"}], "heart_rates": []},
    "chat": [
        {"id": "c1", "role": "user", "text": "Is walking enough?", "at": "2026-11-23T14:03:20.000Z", "reply": None, "app": None},
        {"id": "c2", "role": "agent", "text": "Ask your clinician.", "at": None, "reply": "medical_advice", "app": None},
    ],
    "other": {"notes": [{"id": "n1", "text": "mornings work best", "where": "Onboarding: health", "day": 0}]},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    return TestClient(main.app)


def stored(client, user="sam", **params):
    return client.get("/api/memory", params={"user_id": user, **params}).json()["memory"]


# --- Read --------------------------------------------------------------------------------------


def test_a_new_user_reads_as_the_seven_groups_empty(client):
    got = stored(client)
    assert tuple(got) == memory.GROUPS
    assert got["who"] == {"name": None, "fitbit_connected": None}
    assert got["daily"] == {"check_ins": [], "suggestions": [], "workouts": [], "app_opens": []}
    assert got["chat"] == []
    assert got["other"] == {}


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


def test_an_opened_day_and_what_the_app_keeps_go_in_and_come_back(client):
    client.post("/api/memory?user_id=sam", json=SAM)  # opened on the 23rd, one note
    today = {"step": "time", "entries": [{"id": "t1", "role": "agent", "text": "How much time today?"}]}
    res = client.post("/api/memory?user_id=sam", json={
        "daily": {"app_opens": ["2026-11-24", "2026-11-23"]},  # the next day; the 23rd is there already
        "other": {"today": today},
    })
    assert res.json() == {"ok": True}
    got = stored(client)
    assert got["daily"]["app_opens"] == ["2026-11-23", "2026-11-24"]
    assert got["other"] == {"notes": SAM["other"]["notes"], "today": today}
    assert stored(client, group="other") == {"other": got["other"]}


def test_a_chat_message_is_added_to_the_conversation_and_one_can_be_taken_out(client):
    client.post("/api/memory?user_id=sam", json=SAM)  # two messages
    more = [{"id": "c3", "role": "user", "text": "And cycling?", "at": "2026-11-23T14:06:00.000Z"}]
    assert client.post("/api/memory?user_id=sam", json={"chat": more}).json() == {"ok": True}
    assert [m["id"] for m in stored(client)["chat"]] == ["c1", "c2", "c3"]

    assert client.delete("/api/memory/chat/c2?user_id=sam").json() == {"ok": True}
    assert [m["id"] for m in stored(client)["chat"]] == ["c1", "c3"]
    assert client.delete("/api/memory/chat/c2?user_id=sam").status_code == 404


def test_the_app_is_given_the_whole_conversation(client):
    """With ?date= the weeks are cut to the last 26; the conversation has no such cut."""
    client.post("/api/memory?user_id=sam", json=SAM)
    old = [{"id": f"old{i}", "role": "user", "text": f"from last year {i}", "at": "2025-06-01T09:00:00.000Z"} for i in range(40)]
    client.post("/api/memory?user_id=sam", json={"chat": old})
    given = stored(client, date="2026-11-25")
    assert len(given["chat"]) == 42
    assert [m["id"] for m in given["chat"][:2]] == ["c1", "c2"]


def test_a_conversation_kept_under_other_can_move_to_the_chat_group(client):
    """What the app does once, the first time it opens after Chat got a group of its own."""
    before = [{"id": "c1", "role": "user", "text": "Is walking enough?", "at": 1795478400000}]
    client.post("/api/memory?user_id=sam", json={"other": {"chat": before, "notes": []}})
    res = client.post("/api/memory?user_id=sam", json={
        "chat": [{"id": "c1", "role": "user", "text": "Is walking enough?", "at": "2026-11-23T14:03:20.000Z"}],
    })
    assert res.json() == {"ok": True}
    assert client.delete("/api/memory/other/chat?user_id=sam").json() == {"ok": True}
    got = stored(client)
    assert [m["text"] for m in got["chat"]] == ["Is walking enough?"]
    assert got["other"] == {"notes": []}


def test_a_day_that_is_not_a_date_is_a_422(client):
    res = client.post("/api/memory?user_id=sam", json={"daily": {"app_opens": ["2026-11-23", "today"]}})
    assert res.status_code == 422
    assert "daily.app_opens[1]: 'today' is not a date" in res.json()["detail"]
    assert stored(client)["daily"]["app_opens"] == []


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


def test_only_some_kinds_of_entry_can_be_deleted_one_by_one(client):
    res = client.delete("/api/memory/vo2_max/2026-11?user_id=sam")
    assert res.status_code == 422
    assert "check_ins, suggestions, workouts, chat, other" in res.json()["detail"]


def test_forgetting_a_user_leaves_the_others(client):
    client.post("/api/memory?user_id=sam", json=SAM)
    client.post("/api/memory?user_id=alex", json={"who": {"name": "Alex"}})
    assert client.delete("/api/memory?user_id=sam").json() == {"ok": True}
    assert stored(client)["who"]["name"] is None
    assert stored(client)["goals"] == []
    assert stored(client)["daily"]["app_opens"] == []
    assert stored(client)["other"] == {}
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
