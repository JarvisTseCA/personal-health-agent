"""
Builds the prompts sent to Jev. A suggestion takes two calls:

1. Which activity? One question; the options are today's allowed activities.
2. How long? One question per activity picked in call 1, so each activity
   gets its own duration.

Both calls carry the same `state` (what we know about the user today).

This is the file to edit when tuning the prompt (step 2). Every variable from
the user's check-in goes into `state`; the wording of the questions lives in
the constants below. Jev answers each question with one option plus a
probability for every option.

Jev API reference: https://docs.typesafe.ai/api/system-one.md
"""
from typing import Any, Dict, List

from . import challenge
from .schemas import Option, SuggestRequest

# Open question for the team: what order should these factors be weighed in?
# For now: mood > energy > favorites rank > variety. Placeholder until the
# team agrees on the order.
ACTIVITY_INSTRUCTIONS = (
    "Pick the one activity this person is most likely to enjoy and actually do today. "
    "Weigh, in order: what they are in the mood for, their energy today, how high it is "
    "on their list of favorites, and variety (avoid what they did yesterday or declined "
    "recently). On a low-energy day prefer lighter options. When they want a challenge, "
    "prefer a harder pace that earns 1.5x today's target in their usual session length "
    "over an easier pace done for longer. Options they can only 'sometimes' access are less "
    "likely to happen."
)

# Open question for the team: when a shorter and a longer session both fit,
# which should Jev lean towards? For now: a shorter session they will finish
# beats a longer one they will skip. Placeholder until the team decides.
DURATION_INSTRUCTIONS = (
    "How long should today's {activity} session be? It is {met} MET, so 1 MET-hour takes "
    "about {min_per_met_hour} minutes. Aim to cover the MET-hours still needed today without "
    "going far past it. A shorter session they will finish beats a longer one they will "
    "skip, especially on a low-energy day."
)

# Added to the duration question when the user is up for a challenge.
CHALLENGE_DURATION_INSTRUCTIONS = (
    " They are up for a challenge: aim for about {aim} MET-hours (1.5x today's target). Their "
    "usual session today is {usual} minutes; keep it no longer than that and let the harder pace "
    "earn the extra. Go longer only if this pace can't reach the aim in {usual} minutes."
)

ENERGY_TEXT = {
    "challenge": "up for a challenge",
    "normal": "normal",
    "low": "low energy",
}

PLACE_TEXT = {
    "home": "at home",
    "gym": "at the gym",
    "office": "at the office",
    "outside": "outside",
    "traveling": "traveling",
    "other": "somewhere else",
}


def _days_ago_text(days: int) -> str:
    if days == 0:
        return "earlier today"
    if days == 1:
        return "yesterday"
    return f"{days} days ago"


def build_state(req: SuggestRequest) -> Dict[str, Any]:
    """Everything Jev should know about the user today, in plain words."""
    names = {e.family_id: e.name for e in req.enjoyed}
    names.update({o.family_id: o.family_name for o in req.options})
    c = req.check_in

    state: Dict[str, Any] = {
        "today": req.day_name,
        "time_available_min": c.minutes,
        "where": PLACE_TEXT.get(c.place, c.place),
        "energy": ENERGY_TEXT.get(c.energy, c.energy),
        "in_the_mood_for": "no preference" if c.mood == "surprise" else names.get(c.mood, c.mood),
        "met_hours_still_needed_today": round(req.needed_met_hours, 2),
        "wants_more_than_usual_today": req.boost,
        "favorites_in_order": [f"{e.rank}. {e.name} (access: {e.access})" for e in req.enjoyed],
        "recently_done": [f"{names.get(r.family_id, r.family_id)}, {_days_ago_text(r.days_ago)}" for r in req.recent],
        "recently_declined": [
            f"{names.get(d.family_id, d.family_id)}, {_days_ago_text(d.days_ago)}, reason: {d.reason}"
            + (f" ({d.note})" if d.note else "")
            for d in req.declines
        ],
    }
    if req.boost:
        state["challenge_aim_met_hours"] = round(challenge.challenge_aim(req), 2)
    if req.limits.no_vigorous:
        state["health_limit"] = "No vigorous activity (health flag or clinician limit)"
    if req.constraint_notes:
        state["after_earlier_declines_today"] = req.constraint_notes
    return state


def duration_question(o: Option) -> str:
    """The name of the duration question for one activity, e.g. "duration_yoga_power"."""
    return "duration_" + o.variant_id.replace("-", "_")


def build_activity_request(req: SuggestRequest, model: str) -> Dict[str, Any]:
    """Call 1: which activity? Options come from the request, so they change every day."""
    rank = {e.family_id: e.rank for e in req.enjoyed}
    options = {
        o.variant_id: (
            f"{o.family_name}, {o.label.lower()} ({o.met} MET, {o.setting}). {o.description}. "
            f"Favorite #{rank.get(o.family_id, '?')}."
        )
        for o in req.options
    }
    return {
        "model": model,
        "state": build_state(req),
        "questions": {"activity": {"type": "choice", "instructions": ACTIVITY_INSTRUCTIONS, "criteria": options}},
    }


def _duration_instructions(req: SuggestRequest, o: Option) -> str:
    text = DURATION_INSTRUCTIONS.format(
        activity=f"{o.family_name.lower()} ({o.label.lower()})", met=o.met, min_per_met_hour=round(60 / o.met)
    )
    usual = challenge.usual_minutes(req, o.family_id) if req.boost else None
    if usual is not None:
        text += CHALLENGE_DURATION_INSTRUCTIONS.format(aim=round(challenge.challenge_aim(req), 2), usual=usual)
    return text


def build_duration_request(req: SuggestRequest, picked: List[Option], model: str) -> Dict[str, Any]:
    """Call 2: how long, asked once for each activity picked in call 1."""
    options = {str(d): f"{d} minutes" for d in req.durations}
    questions = {
        duration_question(o): {
            "type": "choice",
            "instructions": _duration_instructions(req, o),
            "criteria": options,
        }
        for o in picked
    }
    return {"model": model, "state": build_state(req), "questions": questions}
