"""
The second check on a Chat message: Jev sorts it before any text is written.

A message that got past the urgent keywords (chat_rules.py) goes to Jev with
three yes/no questions, in one request:

    urgent               Does the user need urgent help? Urgent symptoms, and
                         thoughts of self-harm: both get the "urgent" reply.
    medical_advice       Is the user asking for medical advice?
    about_health_or_app  Is the message about exercise, health or this app?

Jev answers each with the probability of yes, from 0 to 1 (a "noul"). The
code decides what happens, in this order:

    urgent               at or above URGENT_AT          → fixed reply "urgent"
    medical_advice       at or above MEDICAL_ADVICE_AT  → fixed reply "medical_advice"
    about_health_or_app  below ON_TOPIC_BELOW           → fixed reply "off_topic"
    anything else                                       → on to the model that writes

Three questions and not one question with three options: a choice question
always picks an option, even when none fits, and this way each question has
its own threshold.

Open question for the team: the wording of the three questions and the three
thresholds are a first draft. They have not been tried on real messages, and
where "medical advice" starts is a clinical call.

Not connected to a route yet.
"""
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# A yes at least this likely stops the message. Missing an urgent message costs
# the most, so "more likely yes than no" is enough for that one.
URGENT_AT = 0.5
MEDICAL_ADVICE_AT = 0.7
# Off topic only when Jev is clearly saying no to "about exercise, health or this app".
ON_TOPIC_BELOW = 0.3

# How many messages before the latest one Jev sees, to make sense of "and how much of it?".
# Kept short: Jev's answers get worse as the state fills with text the question isn't about.
EARLIER_MESSAGES = 2

QUESTIONS: Dict[str, Dict[str, Any]] = {
    "urgent": {
        "type": "noul",
        "instructions": "Does the user need urgent help?",
        "criteria": {
            "true": (
                "The user reports, now or during or after recent exercise, chest pain or pressure, trouble "
                "breathing, fainting or nearly fainting, a racing or irregular heartbeat while resting, signs of "
                "a stroke, a severe allergic reaction, signs of heat stroke, a seizure, a blow to the head, or "
                "heavy bleeding. Or the user says they are thinking about harming themselves or ending their life."
            ),
            "false": (
                "The user reports ordinary effects of exercise (tired, sweaty, out of breath after effort, "
                "sore muscles), asks a general question, or mentions an illness someone had in the past."
            ),
        },
    },
    "medical_advice": {
        "type": "noul",
        "instructions": "Is the user asking for medical advice that should come from a clinician?",
        "criteria": {
            "true": (
                "The user asks what a symptom, pain or injury means or how to treat it; whether to take, change "
                "or stop a medication or supplement; or whether exercise is safe for them given a medical "
                "condition, pregnancy, surgery or injury."
            ),
            "false": (
                "The user asks a general fitness question: how an activity counts, how hard or how often to "
                "exercise, what VO2 max or MET-hours mean, how they are doing this week, or about ordinary "
                "tiredness or muscle soreness after a workout."
            ),
        },
    },
    "about_health_or_app": {
        "type": "noul",
        "instructions": "Is the message about exercise, fitness, health, or how this app works?",
        "criteria": {
            "true": (
                "The message is about physical activity, fitness, VO2 max, MET-hours, sleep or eating around "
                "exercise, the user's goal, progress, suggestions or rewards in the app, or what their clinician "
                "said. A greeting, a thank-you or a short reply to the assistant also counts."
            ),
            "false": (
                "The message asks for something else: help with writing, homework or code, news, weather, "
                "entertainment, shopping, or another app."
            ),
        },
    },
}


class GateError(Exception):
    """The gate can't decide: there is no user message to judge, or Jev's answer isn't what was asked for."""


@dataclass(frozen=True)
class Decision:
    reply: Optional[str]             # "urgent", "medical_advice" or "off_topic". None: the message goes on
    probabilities: Dict[str, float]  # Jev's three answers, e.g. {"urgent": 0.03, "medical_advice": 0.81, ...}


def latest_user_message(messages: List[Dict[str, str]]) -> str:
    """The message being judged: the last one the user wrote."""
    for m in reversed(messages):
        if m.get("role") == "user" and (m.get("content") or "").strip():
            return m["content"].strip()
    raise GateError("There is no user message to check")


def build_request(messages: List[Dict[str, str]], model: str) -> Dict[str, Any]:
    """The request for Jev: the latest user message, a little of what came before it, and the three questions.

    `messages` is the chat as the app sends it: [{"role": "user" or "assistant", "content": "..."}, ...].
    """
    message = latest_user_message(messages)
    last = max(i for i, m in enumerate(messages) if m.get("role") == "user" and (m.get("content") or "").strip())
    earlier = [
        {"from": m.get("role", ""), "text": (m.get("content") or "").strip()}
        for m in messages[max(0, last - EARLIER_MESSAGES):last]
    ]
    state: Dict[str, Any] = {"message": message}
    if earlier:
        state["earlier_in_this_chat"] = earlier
    return {"model": model, "state": state, "questions": QUESTIONS}


def _noul(answers: Dict[str, dict], name: str) -> float:
    answer = answers.get(name) or {}
    value = answer.get("noul")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
        raise GateError(f"Jev's answer to '{name}' has no probability between 0 and 1: {answer!r}")
    return float(value)


def decide(answers: Dict[str, dict]) -> Decision:
    """What happens to the message, given Jev's three answers."""
    p = {name: _noul(answers, name) for name in QUESTIONS}
    if p["urgent"] >= URGENT_AT:
        reply: Optional[str] = "urgent"
    elif p["medical_advice"] >= MEDICAL_ADVICE_AT:
        reply = "medical_advice"
    elif p["about_health_or_app"] < ON_TOPIC_BELOW:
        reply = "off_topic"
    else:
        reply = None
    return Decision(reply, p)


# --- Mock -------------------------------------------------------------------
# Used when TYPESAFE_API_KEY isn't set, so the Chat flow runs locally. A few
# word lists that return Jev-shaped answers. It is a stand-in for testing the
# plumbing, not a model of what Jev would answer.

_MOCK_URGENT = {"emergency", "ambulance", "911", "suicide", "suicidal"}
_MOCK_MEDICAL = {
    "pain", "hurt", "hurts", "injury", "injured", "medication", "medicine", "pill", "pills", "ibuprofen",
    "dose", "diagnose", "diagnosis", "symptom", "symptoms", "surgery", "pregnant", "prescription",
}
_MOCK_ON_TOPIC = {
    "exercise", "workout", "run", "running", "walk", "walking", "cycle", "cycling", "bike", "swim", "gym",
    "yoga", "strength", "cardio", "hiit", "met", "mets", "vo2", "goal", "progress", "week", "today", "streak",
    "trophy", "sleep", "heart", "fit", "fitness", "train", "training", "activity", "active", "sore", "tired",
    "stretch", "count", "counts", "minutes", "health", "clinician", "doctor",
}


def mock_answers(messages: List[Dict[str, str]]) -> Dict[str, dict]:
    """Mock of the gate call: yes when the latest user message has a word from the matching list."""
    words = re.findall(r"[a-z0-9]+", latest_user_message(messages).lower())
    medical = any(w in _MOCK_MEDICAL for w in words)
    # A short message is taken as a greeting or a reply ("thanks!", "ok, and then?"), which is on topic.
    on_topic = medical or len(words) <= 3 or any(w in _MOCK_ON_TOPIC for w in words)
    return {
        "urgent": {"type": "noul", "noul": 0.9 if any(w in _MOCK_URGENT for w in words) else 0.05},
        "medical_advice": {"type": "noul", "noul": 0.9 if medical else 0.05},
        "about_health_or_app": {"type": "noul", "noul": 0.95 if on_topic else 0.05},
    }
