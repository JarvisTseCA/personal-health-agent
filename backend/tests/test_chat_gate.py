"""The second check on a Chat message: three yes/no questions for Jev, and what the code does with the answers."""
import pytest

from app import chat_gate
from app.chat_gate import Decision, GateError


def user(text):
    return {"role": "user", "content": text}


def assistant(text):
    return {"role": "assistant", "content": text}


def answers(urgent, medical_advice, about_health_or_app):
    """Jev's answer to the three questions, as it comes back from the API."""
    return {
        "urgent": {"type": "noul", "noul": urgent},
        "medical_advice": {"type": "noul", "noul": medical_advice},
        "about_health_or_app": {"type": "noul", "noul": about_health_or_app},
    }


# --- The request ------------------------------------------------------------


def test_the_request_asks_three_yes_no_questions_about_the_message():
    body = chat_gate.build_request([user("Is it OK to cycle two days in a row?")], "jev-latest")

    assert body["model"] == "jev-latest"
    assert body["state"] == {"message": "Is it OK to cycle two days in a row?"}
    assert list(body["questions"]) == ["urgent", "medical_advice", "about_health_or_app"]
    for question in body["questions"].values():
        assert question["type"] == "noul"
        assert question["instructions"].endswith("?")
        assert set(question["criteria"]) == {"true", "false"}


def test_the_message_checked_is_the_last_one_the_user_wrote():
    body = chat_gate.build_request(
        [user("What's a MET?"), assistant("A MET is…"), user("  And how many do I need?  "), assistant("")],
        "jev-latest",
    )

    assert body["state"]["message"] == "And how many do I need?"


def test_jev_also_sees_the_two_messages_before_it():
    chat = [user("one"), assistant("two"), user("three"), assistant("four"), user("And how much of it?")]

    state = chat_gate.build_request(chat, "jev-latest")["state"]

    assert state == {
        "message": "And how much of it?",
        "earlier_in_this_chat": [{"from": "user", "text": "three"}, {"from": "assistant", "text": "four"}],
    }


@pytest.mark.parametrize("chat", [[], [assistant("Hi Alex")], [user("   ")]])
def test_a_chat_without_a_user_message_is_an_error(chat):
    with pytest.raises(GateError, match="no user message"):
        chat_gate.build_request(chat, "jev-latest")


# --- The decision -----------------------------------------------------------


@pytest.mark.parametrize("urgent, medical_advice, about_health_or_app, reply", [
    (0.03, 0.05, 0.97, None),              # a fitness question goes on
    (0.80, 0.05, 0.97, "urgent"),
    (0.50, 0.05, 0.97, "urgent"),          # at the threshold counts
    (0.49, 0.05, 0.97, None),
    (0.03, 0.81, 0.97, "medical_advice"),
    (0.03, 0.70, 0.97, "medical_advice"),  # at the threshold counts
    (0.03, 0.69, 0.97, None),              # not sure it is medical advice: the model that writes gets it
    (0.03, 0.05, 0.10, "off_topic"),
    (0.03, 0.05, 0.30, None),              # off topic only when Jev is clearly saying no
    (0.90, 0.90, 0.05, "urgent"),          # urgent comes first
    (0.03, 0.90, 0.05, "medical_advice"),  # then medical advice, then off topic
])
def test_the_code_decides_from_the_three_probabilities(urgent, medical_advice, about_health_or_app, reply):
    decision = chat_gate.decide(answers(urgent, medical_advice, about_health_or_app))

    assert decision == Decision(
        reply=reply,
        probabilities={"urgent": urgent, "medical_advice": medical_advice, "about_health_or_app": about_health_or_app},
    )


def test_the_thresholds_are_the_three_numbers_at_the_top(monkeypatch):
    unsure = answers(0.40, 0.60, 0.97)
    assert chat_gate.decide(unsure).reply is None

    monkeypatch.setattr(chat_gate, "MEDICAL_ADVICE_AT", 0.6)
    assert chat_gate.decide(unsure).reply == "medical_advice"

    monkeypatch.setattr(chat_gate, "URGENT_AT", 0.4)
    assert chat_gate.decide(unsure).reply == "urgent"


@pytest.mark.parametrize("broken", [
    {},                                                                  # nothing came back
    {"urgent": {"type": "noul", "noul": 0.1}},                           # two answers missing
    {**answers(0.1, 0.1, 0.9), "medical_advice": {"type": "noul"}},      # no number
    {**answers(0.1, 0.1, 0.9), "urgent": {"type": "noul", "noul": 1.7}},  # not a probability
    {**answers(0.1, 0.1, 0.9), "urgent": {"type": "noul", "noul": "high"}},
])
def test_an_answer_that_is_not_three_probabilities_is_an_error(broken):
    with pytest.raises(GateError, match="has no probability between 0 and 1"):
        chat_gate.decide(broken)


# --- The mock (no API key) --------------------------------------------------


@pytest.mark.parametrize("message, reply", [
    ("Is it OK to cycle two days in a row?", None),
    ("thanks!", None),
    ("My knee hurts when I run", "medical_advice"),
    ("Should I take ibuprofen before a long run?", "medical_advice"),
    ("Can you help me write a cover letter for a marketing job?", "off_topic"),
    ("This is an emergency", "urgent"),
    ("Lately I feel suicidal", "urgent"),  # self-harm is part of urgent, not a question of its own
])
def test_the_mock_answers_in_jevs_format_and_covers_every_outcome(message, reply):
    mocked = chat_gate.mock_answers([user(message)])

    assert list(mocked) == list(chat_gate.QUESTIONS)
    assert all(a["type"] == "noul" and 0 <= a["noul"] <= 1 for a in mocked.values())
    assert chat_gate.decide(mocked).reply == reply
