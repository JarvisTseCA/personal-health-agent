"""
ChatGPT on the Today tab: three short jobs, each one turning words into fields or fields into words.
Jev still ranks the activities, and code still counts MET-hours; ChatGPT never decides either.

1. read_answer  POST /api/today/read   A typed answer ("maybe 20 min at home, my knee is sore") →
                                       the fields the buttons would give (20 min, indoors private,
                                       "Something hurts"), or "it's a question" (the app then sends
                                       it to /api/chat, through the same checks as the Chat tab).
2. why_line     POST /api/today/why    The pick and the facts the code already has → one sentence
                                       that starts "Based on". No numbers in it.
3. recap        POST /api/today/recap  Last week's numbers → two sentences for Monday's check-in.
                                       Every number in them must be one of the numbers given.

Every answer is checked here before it goes back; one that fails the check is refused (422), and
the app keeps its own words. Without OPENAI_API_KEY the routes answer 503 and the app does the same.
"""
import json
import re
from typing import Any, Dict, Iterable, List, Optional, Set

from . import chat_writer


class TodayWordsError(Exception):
    """ChatGPT's answer didn't pass the check. The message says what was wrong."""


# --- 1. A typed answer → fields -------------------------------------------------------------

PLACES = ("indoors_private", "indoors_with_others", "outside")
ENERGIES = ("challenge", "normal", "low")
REASONS = ("no-time", "tired", "not-mood", "recent", "no-access", "weather", "hurts", "other")
SLOTS = ("off", "0", "5", "10", "30", "45")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

READ_SYSTEM = """You read one typed answer in a fitness app's daily check-in and turn it into fields.
Answer with one JSON object and nothing else. Leave out every key the message doesn't state; never guess.

Keys:
- intent: "question" if the user asks something (how, why, what, can I, does ... count), else "answer".
- minutes: whole minutes of free time today (0 if they say they have none).
- day_off: true if they want no exercise at all today.
- keep_time: true if they agree to keep the time they were asked about ("yes", "sure", "that works").
- place: "indoors_private" (home, hotel room, alone), "indoors_with_others" (gym, office, school, shared), or "outside".
- energy: "challenge" (energetic, wants to push), "normal", or "low" (tired, drained, sore).
- reason: why they don't want the suggested activity: "no-time", "tired", "not-mood", "recent" (did it recently),
  "no-access" (no equipment, closed, can't get there), "weather", "hurts" (pain, injury, soreness), or "other".
- goal: a weekly goal in MET-hours, as a number.
- plan: changes to the week's plan, as an object from "mon" ... "sun" to one of "off", "5", "10", "30", "45" (minutes).
- done: true if they say the plan is fine or they are finished with it."""


def read_prompt(step: str, question: str, text: str) -> str:
    return f"Step: {step}\nQuestion the app asked: {question or '(none)'}\nTyped answer: {text}"


def _json_object(raw: str) -> Dict[str, Any]:
    """The JSON object in the model's text, also when it came wrapped in a code fence or a sentence."""
    try:
        data = json.loads(raw)
    except ValueError:
        found = re.search(r"\{.*\}", raw, re.S)
        if not found:
            raise TodayWordsError("No JSON object in the answer") from None
        try:
            data = json.loads(found.group(0))
        except ValueError as e:
            raise TodayWordsError("The JSON object in the answer can't be read") from e
    if not isinstance(data, dict):
        raise TodayWordsError("The answer is not a JSON object")
    return data


def _number(value: Any, low: float, high: float) -> Optional[float]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if low <= n <= high else None


def check_read(raw: str) -> Dict[str, Any]:
    """Keep only the fields that hold an allowed value. Anything else is dropped, not guessed at."""
    data = _json_object(raw)
    out: Dict[str, Any] = {"intent": "question" if data.get("intent") == "question" else "answer"}
    minutes = _number(data.get("minutes"), 0, 240)
    if minutes is not None:
        out["minutes"] = int(round(minutes))
    for key in ("day_off", "keep_time", "done"):
        if data.get(key) is True:
            out[key] = True
    if data.get("place") in PLACES:
        out["place"] = data["place"]
    if data.get("energy") in ENERGIES:
        out["energy"] = data["energy"]
    if data.get("reason") in REASONS:
        out["reason"] = data["reason"]
    goal = _number(data.get("goal"), 1, 60)
    if goal is not None:
        out["goal"] = goal
    plan = data.get("plan")
    if isinstance(plan, dict):
        days = {DAYS.index(str(d).lower()[:3]): str(slot) for d, slot in plan.items()
                if str(d).lower()[:3] in DAYS and str(slot) in SLOTS}
        if days:
            out["plan"] = days
    return out


def read_answer(step: str, question: str, text: str) -> Dict[str, Any]:
    return check_read(chat_writer.complete(READ_SYSTEM, read_prompt(step, question, text), as_json=True))


# --- 2. Why this pick ------------------------------------------------------------------------

WHY_SYSTEM = """You write the one line under today's suggested activity in a fitness app.
Write one sentence of at most 20 words that starts with "Based on" and says why this activity fits the user today.
Use only the facts given and add none. No numbers, no medical claims, no exclamation marks. Plain, friendly words."""


def why_prompt(activity: str, facts: Iterable[str]) -> str:
    return f"Activity: {activity}\nFacts:\n" + "\n".join(f"- {f}" for f in facts)


def check_why(raw: str) -> str:
    line = " ".join(raw.strip().strip('"').split())
    if not line.startswith("Based on"):
        raise TodayWordsError("The line doesn't start with 'Based on'")
    if re.search(r"\d", line):
        raise TodayWordsError("The line has a number in it; numbers on the card come from code")
    if len(line) > 160:
        raise TodayWordsError("The line is too long")
    if not line.endswith((".", "!")):
        line += "."
    if re.search(r"[.!?]\s+\S", line):
        raise TodayWordsError("More than one sentence")
    return line


def why_line(activity: str, facts: List[str]) -> str:
    return check_why(chat_writer.complete(WHY_SYSTEM, why_prompt(activity, facts)))


# --- 3. Monday's recap of last week ---------------------------------------------------------

RECAP_SYSTEM = """You write a two-sentence recap of the user's last week, shown at the start of a new week in a fitness app.
First sentence: what they did, using the numbers given. Second sentence: one encouraging, specific line for the week ahead.
Use only the facts given; every number you write must be one of them. Never mention a missed goal, a broken streak,
or anything that went down: rewards only add up. No medical advice. Plain, friendly words, no lists."""


def recap_prompt(facts: Dict[str, Any]) -> str:
    return "Last week:\n" + "\n".join(f"- {k.replace('_', ' ')}: {v}" for k, v in facts.items())


def _forms(value: Any) -> Set[str]:
    """How a number from the facts may be written: 7.5, 7.50; 10, 10.0."""
    out: Set[str] = set()
    if isinstance(value, bool):
        return out
    if isinstance(value, (int, float)):
        f = float(value)
        out |= {f"{f:g}", f"{f:.1f}", f"{f:.2f}"}
        if f.is_integer():
            out.add(str(int(f)))
    elif isinstance(value, str):
        out |= set(re.findall(r"\d+(?:\.\d+)?", value))
    return out


def check_recap(raw: str, facts: Dict[str, Any]) -> str:
    text = " ".join(raw.strip().strip('"').split())
    if not text:
        raise TodayWordsError("The recap is empty")
    if len(text) > 320:
        raise TodayWordsError("The recap is too long")
    if len(re.findall(r"[.!?](?:\s|$)", text)) > 2:
        raise TodayWordsError("More than two sentences")
    allowed: Set[str] = set()
    for v in facts.values():
        allowed |= _forms(v)
    for n in re.findall(r"\d+(?:\.\d+)?", text):
        if n not in allowed:
            raise TodayWordsError(f"The number {n} isn't one of the numbers given")
    return text


def recap(facts: Dict[str, Any]) -> str:
    return check_recap(chat_writer.complete(RECAP_SYSTEM, recap_prompt(facts)), facts)
