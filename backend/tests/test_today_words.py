"""ChatGPT on the Today tab (today_words.py): a typed answer → fields, the "Based on" line, Monday's recap.
Every answer is checked before it goes back; a model is never reached here (chat_writer.complete is replaced)."""
import json

import pytest
from fastapi.testclient import TestClient

from app import chat_writer, main, today_words
from app.today_words import TodayWordsError, check_read, check_recap, check_why


@pytest.fixture(autouse=True)
def no_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    for setting in ("TYPESAFE_API_KEY", "OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(setting, raising=False)


@pytest.fixture
def client():
    return TestClient(main.app)


def answering(monkeypatch, reply):
    """ChatGPT, replaced: it answers `reply` (a dict is sent as JSON) and keeps what it was asked."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-1234")
    asked = []

    def complete(system, user, as_json=False):
        asked.append({"system": system, "user": user, "as_json": as_json})
        return json.dumps(reply) if isinstance(reply, dict) else reply

    monkeypatch.setattr(chat_writer, "complete", complete)
    return asked


# --- 1. A typed answer → fields ---------------------------------------------------------------


def test_a_check_in_answer_becomes_the_fields_the_buttons_give():
    raw = json.dumps({"intent": "answer", "minutes": 20, "place": "indoors_private", "energy": "low", "reason": "hurts"})
    assert check_read(raw) == {"intent": "answer", "minutes": 20, "place": "indoors_private", "energy": "low", "reason": "hurts"}


def test_values_that_aren_t_allowed_are_dropped_not_guessed():
    raw = json.dumps({"intent": "maybe", "minutes": 900, "place": "the gym", "energy": "high", "reason": "busy",
                      "goal": 0, "day_off": "yes", "plan": {"thursday": "off", "fri": "20", "funday": "30"}})
    assert check_read(raw) == {"intent": "answer", "plan": {3: "off"}}


def test_a_question_is_marked_as_one():
    assert check_read('{"intent": "question"}') == {"intent": "question"}


def test_json_wrapped_in_words_is_still_read_and_no_json_is_refused():
    assert check_read('Sure! ```json\n{"minutes": 30}\n```')["minutes"] == 30
    with pytest.raises(TodayWordsError):
        check_read("Thirty minutes at home.")


def test_read_route_sends_the_step_the_question_and_the_text(client, monkeypatch):
    asked = answering(monkeypatch, {"intent": "answer", "minutes": 20, "place": "indoors_private"})
    res = client.post("/api/today/read", json={"step": "time", "question": "How much time do you have today?",
                                                "text": "maybe 20 min at home"})
    assert res.status_code == 200
    assert res.json() == {"intent": "answer", "minutes": 20, "place": "indoors_private"}
    assert asked[0]["as_json"] is True
    assert "Typed answer: maybe 20 min at home" in asked[0]["user"] and "How much time" in asked[0]["user"]


# --- 2. The "Based on" line ------------------------------------------------------------------


def test_a_good_line_passes_and_gets_its_full_stop():
    assert check_why("Based on your love of cycling and a low-energy day") == "Based on your love of cycling and a low-energy day."


@pytest.mark.parametrize("line, why", [
    ("You like cycling.", "Based on"),
    ("Based on your 3 rides this week.", "number"),
    ("Based on your likes. Also it's sunny.", "one sentence"),
    ("Based on " + "very " * 40 + "much.", "too long"),
])
def test_a_line_that_breaks_a_rule_is_refused(line, why):
    with pytest.raises(TodayWordsError):
        check_why(line)


def test_why_route_without_a_key_answers_503_so_the_app_keeps_its_own_words(client):
    res = client.post("/api/today/why", json={"activity": "Bicycling, stationary", "facts": ["You like cycling"]})
    assert res.status_code == 503


def test_why_route_refuses_a_line_with_a_number(client, monkeypatch):
    answering(monkeypatch, "Based on your 2 rest days.")
    assert client.post("/api/today/why", json={"activity": "Yoga", "facts": ["Rested two days"]}).status_code == 422


def test_why_route_names_the_facts_and_nothing_else(client, monkeypatch):
    asked = answering(monkeypatch, "Based on your love of cycling.")
    res = client.post("/api/today/why", json={"activity": "Bicycling, stationary", "facts": ["You like cycling", "Fits in 30 min"]})
    assert res.json() == {"line": "Based on your love of cycling."}
    assert asked[0]["user"] == "Activity: Bicycling, stationary\nFacts:\n- You like cycling\n- Fits in 30 min"


# --- 3. Monday's recap -----------------------------------------------------------------------

FACTS = {"goal_met_hours": 7.5, "done_met_hours": 8.2, "active_days": 4, "trophy": True, "top_activity": "Walking"}


def test_a_recap_with_the_given_numbers_passes():
    text = "Last week you did 8.2 of your 7.5 MET-hours across 4 days, mostly walking. Keep that rhythm going this week."
    assert check_recap(text, FACTS) == text


@pytest.mark.parametrize("text", [
    "You did 9 MET-hours last week. Great.",  # a number that isn't given
    "One. Two. Three.",  # three sentences
    "x" * 400,
])
def test_a_recap_that_breaks_a_rule_is_refused(text):
    with pytest.raises(TodayWordsError):
        check_recap(text, FACTS)


def test_recap_route(client, monkeypatch):
    answering(monkeypatch, "You did 8.2 MET-hours on 4 days last week. Let's build on it.")
    res = client.post("/api/today/recap", json={"facts": FACTS})
    assert res.status_code == 200 and res.json()["text"].startswith("You did 8.2")


def test_a_model_that_cant_be_reached_is_a_502(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-1234")

    def down(*args, **kwargs):
        raise chat_writer.WriterError("Could not reach the chat model")

    monkeypatch.setattr(chat_writer, "complete", down)
    assert client.post("/api/today/read", json={"step": "time", "text": "20 min"}).status_code == 502


def test_complete_without_a_key_refuses_before_any_request():
    with pytest.raises(chat_writer.WriterError):
        chat_writer.complete("system", "user")


def test_the_prompts_name_every_allowed_value():
    for value in (*today_words.PLACES, *today_words.ENERGIES, *today_words.REASONS):
        assert f'"{value}"' in today_words.READ_SYSTEM
