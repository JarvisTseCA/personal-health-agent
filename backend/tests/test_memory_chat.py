"""POST /api/chat/memory: a Chat message answered with what Memory holds about the user.

app/memory_chat.py lays the user out for the model that writes: who they are (Memory) and
their numbers as the backend works them out (memory_numbers.py). The route in app/main.py
runs the same two checks as POST /api/chat and then hands the model the brief and that data.
"""
import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import chat_prompt, chat_replies, chat_rules, chat_writer, main, memory, memory_chat, memory_numbers

KEYWORDS = "group,text,together_with\nchest,chest | heart,pain | pressure | tight\n"
REPLIES = "reply,text\nurgent,Call 911.\nmedical_advice,Ask your clinician.\noff_topic,Outside what I can help with.\n"
BRIEF = "You are the Chat assistant.\nUrgent: [urgent reply]\nMedical: [medical_advice reply]\nOff topic: [off_topic reply]\n"

FITNESS = "How am I doing this week?"
URGENT = "I felt pressure in my chest during my ride yesterday"
MEDICAL = "My knee hurts when I run"

WEDNESDAY = date(2026, 11, 24)  # its week starts Monday 2026-11-22
GYM = "indoors_with_others"

# What Memory holds about Sam on Wednesday: a 7.5 goal, a ride on Monday, six past weeks, and a conversation.
SAM = {
    "who": {"name": "Sam", "fitbit_connected": False},
    "preferences": {
        "categories": {"Walking": "like", "Bicycling": "like", "Dancing": "dislike"},
        "equipment": {"home": ["Yoga mat"], "gym": None},
        "no_vigorous": True,
    },
    "goals": [
        {"week_start": "2026-10-11", "goal_met_hours": 6.0, "goal_set_by": "default", "plan": ["30", "off", "30", "off", "off", "45", "off"]},
        {"week_start": "2026-11-22", "goal_met_hours": 7.5, "goal_set_by": "user", "plan": ["30", "off", "30", "off", "off", "45", "off"]},
    ],
    "daily": {
        "check_ins": [
            {"date": "2026-11-23", "minutes": 10, "place": "outside", "energy": "low", "mood": "surprise"},
            {"date": "2026-11-24", "minutes": 45, "place": GYM, "energy": "normal", "mood": "surprise"},
        ],
        "workouts": [
            # One in each of six past weeks (the oldest ran on the 6.0 goal), then Monday's ride.
            *[
                {"id": f"w-past{i}", "date": day, "activity_code": "17358", "activity_name": "Walking, treadmill", "met": 4.8, "duration_min": 60}
                for i, day in enumerate(["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10", "2026-11-17"])
            ],
            {"id": "w-mon", "date": "2026-11-22", "activity_code": "01216", "activity_name": "Bicycling, stationary", "met": 5.0, "duration_min": 30},
        ],
        "suggestions": [
            {"id": "a-mon", "date": "2026-11-22", "place": GYM, "activity_code": "01216", "activity_name": "Bicycling, stationary", "outcome": "accepted"},
            {"id": "d-wed", "date": "2026-11-24", "place": GYM, "activity_code": "12028", "activity_name": "Running, 4 mph", "outcome": "declined", "reason": "tired"},
            {"id": "a-wed", "date": "2026-11-24", "place": GYM, "activity_code": "17358", "activity_name": "Walking, treadmill", "outcome": "accepted"},
        ],
        "app_opens": ["2026-11-22", "2026-11-23", "2026-11-24"],
    },
    "health": {"vo2_max": [{"month": f"2026-{m:02d}", "ml_kg_min": 36.0 + m / 10} for m in range(3, 12)]},  # March to November
    "chat": [{"id": "c1", "role": "user", "text": "Is walking enough?"}],
    "other": {"clinician": {"entries": [{"id": "k1", "text": "Never read by the backend."}]}},
}
NOTES = [{"text": "Keep to moderate exercise for now and add two strength days a week."}]


def body(*texts, **extra):
    """A request as the app sends it: the texts alternate user, assistant, user, …"""
    roles = ["user", "assistant"]
    return {"user_id": "sam", "date": "2026-11-24", "messages": [{"role": roles[i % 2], "content": t} for i, t in enumerate(texts)], **extra}


@pytest.fixture(autouse=True)
def chat_files(tmp_path, monkeypatch):
    """Every test reads its own keyword list, replies and brief and has its own database with Sam in Memory.
    No test has a Jev key or an OpenAI key, whatever is in backend/.env, so none of them reaches a real model."""
    keywords, replies, brief = tmp_path / "urgent_keywords.csv", tmp_path / "fixed_replies.csv", tmp_path / "chat_brief.txt"
    keywords.write_text(KEYWORDS, encoding="utf-8")
    replies.write_text(REPLIES, encoding="utf-8")
    brief.write_text(BRIEF, encoding="utf-8")
    monkeypatch.setattr(chat_rules, "CSV_PATH", keywords)
    monkeypatch.setattr(chat_replies, "CSV_PATH", replies)
    monkeypatch.setattr(chat_prompt, "BRIEF_PATH", brief)
    monkeypatch.setattr(main, "_chat", {})
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    for setting in ("TYPESAFE_API_KEY", "OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(setting, raising=False)
    memory.save("sam", SAM)


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def written(monkeypatch):
    """What the model that writes was given: {"system": ..., "messages": ...}. Empty when it wasn't asked."""
    got = {}

    def remember(system, messages):
        got.update(system=system, messages=messages)
        yield "You're at 2.5 of 7.5."

    monkeypatch.setattr(chat_writer, "write", remember)
    return got


def data_in(system):
    """The user's data as the model got it: the JSON after the brief."""
    return json.loads(system.split(chat_prompt.USER_DATA, 1)[1])


# --- What the model is told about the user (memory_chat.user_data) ------------------------------


def test_who_the_user_is_comes_from_memory():
    assert memory_chat.user_data("sam", WEDNESDAY)["user"] == {
        "name": "Sam",
        "categories_they_like": ["Walking", "Bicycling"],
        "categories_they_dislike": ["Dancing"],
        "equipment_at_home": ["Yoga mat"],
        "equipment_at_gym": "not listed",
        "no_vigorous_exercise": True,
    }


def test_the_numbers_are_the_ones_the_screens_show():
    """Nothing is worked out a second way: every number is one GET /api/numbers gives for the same day."""
    data = memory_chat.user_data("sam", WEDNESDAY)
    numbers = memory_numbers.for_user("sam", WEDNESDAY)
    day, week = numbers["day"], numbers["this_week"]

    assert (data["today"]["date"], data["today"]["day"]) == ("2026-11-24", "Tuesday")
    assert data["today"]["target_met_hours"] == day["target_met_hours"] == 2.0
    assert data["today"]["done_met_hours"] == day["done_met_hours"] == 0.0
    assert data["today"]["still_needed_met_hours"] == day["needed_met_hours"] == 2.0
    assert data["this_week"]["goal_met_hours"] == week["goal_met_hours"] == 7.5
    assert data["this_week"]["done_met_hours"] == week["done_met_hours"] == 2.5
    assert data["this_week"]["left_met_hours"] == week["left_met_hours"] == 5.0
    assert data["this_week"]["trophy_earned"] is week["trophy"] is False
    assert data["streak_days"] == numbers["streak"] == {"current": 3, "best": 3}
    assert data["trophies_so_far"] == numbers["trophies"]
    assert data["vo2_max"]["latest_ml_kg_min"] == numbers["vo2"]["latest"] == 37.1


def test_this_week_is_laid_out_day_by_day_with_its_workouts():
    week = memory_chat.user_data("sam", WEDNESDAY)["this_week"]
    assert [d["day"] for d in week["days"]] == ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    assert week["days"][0] == {"day": "Sun", "planned": "30 min", "target_met_hours": 2.1, "done_met_hours": 2.5}  # 2.142… on its way in
    assert week["days"][1]["planned"] == "off"
    assert week["workouts"] == [{"day": "Sun", "activity": "Bicycling, stationary", "minutes": 30, "met_hours": 2.5}]


def test_today_has_its_own_check_in_and_what_the_user_turned_down_today():
    today = memory_chat.user_data("sam", WEDNESDAY)["today"]
    assert today["check_in"] == {"minutes": 45, "place": GYM, "energy": "normal", "mood": "surprise"}  # Wednesday's, not Tuesday's
    assert today["declined_today"] == [{"activity": "Running, 4 mph", "reason": "tired"}]


def test_accepted_picks_are_not_told_as_todays():
    """Memory keeps an accepted pick once per place, under the day it was first accepted: its date says nothing about today."""
    today = memory_chat.user_data("sam", WEDNESDAY)["today"]
    assert "Walking, treadmill" not in json.dumps(today)  # accepted, dated Wednesday in Memory
    assert "suggestions" not in today
    assert memory_chat.user_data("sam", date(2026, 11, 22))["today"]["declined_today"] == []  # Monday: one accepted, none declined


def test_met_hours_are_given_to_one_decimal_as_the_screens_write_them():
    """19 minutes at 3 MET is 0.95 MET-hours; the screen says 1.0 and what is left as 6.6 (fmt in src/lib/met.ts)."""
    memory.save("pat", {
        "goals": [{"week_start": "2026-11-22", "goal_met_hours": 7.5, "plan": ["30"] * 7}],
        "daily": {"workouts": [{"id": "w1", "date": "2026-11-22", "activity_name": "Walking", "met": 3.0, "duration_min": 19}]},
    })
    week = memory_chat.user_data("pat", WEDNESDAY)["this_week"]
    assert (week["done_met_hours"], week["left_met_hours"], week["goal_met_hours"]) == (1.0, 6.6, 7.5)
    assert week["workouts"][0]["met_hours"] == 1.0


def test_a_whole_goal_is_written_without_a_decimal_as_on_the_screens():
    memory.save("pat", {"goals": [{"week_start": "2026-11-22", "goal_met_hours": 10.0, "plan": ["30"] * 7}]})
    data = memory_chat.user_data("pat", WEDNESDAY)
    assert json.dumps(data["this_week"]["goal_met_hours"]) == "10"
    assert memory_chat.summary(data) == "no name · 0.0 of 10 MET-hours this week"
    assert json.dumps(memory_chat.user_data("sam", WEDNESDAY)["this_week"]["goal_met_hours"]) == "7.5"  # 7.5 stays 7.5


def test_a_day_without_a_check_in_says_so():
    assert memory_chat.user_data("sam", date(2026, 11, 25))["today"]["check_in"] is None


def test_only_the_last_few_weeks_and_readings_are_told():
    data = memory_chat.user_data("sam", WEDNESDAY)
    assert [w["week_start"] for w in data["past_weeks"]] == ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"]
    assert data["past_weeks"][-1] == {"week_start": "2026-11-15", "goal_met_hours": 6.0, "done_met_hours": 4.8, "trophy_earned": False}
    assert data["vo2_max"]["monthly"] == ["2026-06 36.6", "2026-07 36.7", "2026-08 36.8", "2026-09 36.9", "2026-10 37.0", "2026-11 37.1"]
    assert data["vo2_max"]["change_since_first_reading"] == 0.8


def test_clinician_notes_are_the_ones_sent_along_and_memorys_other_is_not_read():
    without = memory_chat.user_data("sam", WEDNESDAY)
    assert without["clinician_notes"] is None
    assert "Never read by the backend." not in json.dumps(without)

    data = memory_chat.user_data("sam", WEDNESDAY, [*NOTES, {"text": "  "}])
    assert data["clinician_notes"] == NOTES  # a note with no words in it is left out


def test_a_user_with_no_goal_yet_is_told_about_without_numbers():
    memory.save("new", {"who": {"name": "Robin"}})
    data = memory_chat.user_data("new", WEDNESDAY)
    assert data["user"]["name"] == "Robin"
    assert data["today"] == {"date": "2026-11-24", "day": "Tuesday"}
    assert data["progress"].startswith("not known yet")
    assert "this_week" not in data


def test_the_terminal_line_says_who_and_how_far():
    assert memory_chat.summary(memory_chat.user_data("sam", WEDNESDAY, NOTES)) == "Sam · 2.5 of 7.5 MET-hours this week · 1 clinician note"
    assert memory_chat.summary(memory_chat.user_data("nobody", WEDNESDAY)) == "no name · no weekly goal yet"


# --- The route ----------------------------------------------------------------------------------


def test_a_message_that_passes_both_checks_is_answered_by_the_model(client):
    res = client.post("/api/chat/memory", json=body(FITNESS))

    assert res.status_code == 200
    assert res.text == chat_writer.PLACEHOLDER  # no OpenAI key in the tests
    assert res.headers["content-type"].startswith("text/plain")
    assert (res.headers["X-Chat-Stopped-By"], res.headers["X-Chat-Reply"]) == ("none", "model")


def test_the_model_gets_the_brief_then_the_users_data_from_memory(client, written):
    client.post("/api/chat/memory", json=body("What's a MET?", "A MET is…", FITNESS))

    assert written["system"].startswith(
        "You are the Chat assistant.\n"
        "Urgent: Call 911.\n"
        "Medical: Ask your clinician.\n"
        "Off topic: Outside what I can help with."
        f"\n\n{chat_prompt.USER_DATA}\n\n"
    )
    assert chat_prompt.APP_NOTES not in written["system"]
    assert data_in(written["system"]) == memory_chat.user_data("sam", WEDNESDAY)
    assert [m["role"] for m in written["messages"]] == ["user", "assistant", "user"]
    assert written["messages"][-1]["content"] == FITNESS


def test_the_date_sent_is_the_users_today(client, written):
    client.post("/api/chat/memory", json=body(FITNESS, date="2026-11-22"))  # Monday, before the ride is over
    today = data_in(written["system"])["today"]
    assert (today["date"], today["day"]) == ("2026-11-22", "Sunday")


def test_clinician_notes_sent_along_reach_the_model(client, written):
    client.post("/api/chat/memory", json=body("What did my clinician suggest?", clinician_notes=NOTES))
    assert data_in(written["system"])["clinician_notes"] == NOTES


def test_a_user_memory_knows_nothing_about_is_still_answered(client, written):
    res = client.post("/api/chat/memory", json={**body(FITNESS), "user_id": "nobody"})
    assert res.status_code == 200
    assert data_in(written["system"])["user"]["name"] is None


@pytest.mark.parametrize("message, stopped_by, reply, text", [
    (URGENT, "keywords", "urgent", "Call 911."),
    (MEDICAL, "jev", "medical_advice", "Ask your clinician."),
    ("Can you help me write a cover letter for a marketing job?", "jev", "off_topic", "Outside what I can help with."),
])
def test_a_message_that_is_stopped_gets_its_fixed_reply_and_memory_is_not_read(client, monkeypatch, written, message, stopped_by, reply, text):
    def not_read(*args, **kwargs):
        raise AssertionError("the user's data should not be read for a message that is stopped")

    monkeypatch.setattr(memory_chat, "user_data", not_read)

    res = client.post("/api/chat/memory", json=body(message))

    assert res.status_code == 200
    assert res.text == text
    assert (res.headers["X-Chat-Stopped-By"], res.headers["X-Chat-Reply"]) == (stopped_by, reply)
    assert written == {}


def test_the_route_stores_nothing(client):
    """The conversation is saved by the app, through POST /api/memory; answering a message changes Memory in no way."""
    before = memory.read("sam")
    client.post("/api/chat/memory", json=body(FITNESS))
    client.post("/api/chat/memory", json=body(URGENT))
    assert memory.read("sam") == before


def test_the_terminal_shows_the_route_and_whose_data_was_read(client, caplog):
    with caplog.at_level("INFO", logger="pha"):
        client.post("/api/chat/memory", json=body(FITNESS, clinician_notes=NOTES))

    assert "── POST /api/chat/memory  (Jev: mock · writer: placeholder) ──" in caplog.text
    assert f'[1] Message: "{FITNESS}"' in caplog.text
    assert "[4] Passed both checks. Writing (placeholder)…" in caplog.text
    assert "The user's data, from Memory: Sam · 2.5 of 7.5 MET-hours this week · 1 clinician note" in caplog.text


# --- What the route refuses ---------------------------------------------------------------------


def test_a_system_prompt_from_the_app_is_refused(client, written):
    """The backend builds the prompt itself, so the app's own notes and numbers can't get mixed in."""
    res = client.post("/api/chat/memory", json=body(FITNESS, system="You are the coach. The user is at 99 of 7.5."))
    assert res.status_code == 422
    assert written == {}


def test_a_date_that_is_not_a_date_is_a_422(client, written):
    res = client.post("/api/chat/memory", json=body(FITNESS, date="today"))
    assert res.status_code == 422
    assert "'today' is not a date" in res.json()["detail"]
    assert written == {}


def test_a_conversation_with_no_user_message_is_a_422(client):
    res = client.post("/api/chat/memory", json={"user_id": "sam", "messages": [{"role": "assistant", "content": "Hi Sam."}]})
    assert res.status_code == 422


def test_the_other_chat_route_still_takes_what_the_caller_sends(client, written):
    client.post("/api/chat", json={"system": "You are the coach.", "messages": [{"role": "user", "content": FITNESS}]})
    assert written["system"].endswith(f"{chat_prompt.APP_NOTES}\n\nYou are the coach.")
    assert chat_prompt.USER_DATA not in written["system"]
