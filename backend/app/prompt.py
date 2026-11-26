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
import re
from typing import Any, Dict, Iterable, List, Optional

from . import challenge
from .schemas import Option, SuggestBase, SuggestRequest, TableSuggestRequest

# Open question for the team: what order should these factors be weighed in?
# For now: mood > energy > favorites rank > variety. Placeholder until the
# team agrees on the order.
ACTIVITY_INSTRUCTIONS = (
    "Pick the one activity this person is most likely to enjoy and actually do today. "
    "Weigh, in order: what they are in the mood for, their energy today, how high it is "
    "on their list of favorites (learned from what they accepted; an option not on it is fine, and "
    "trying one now and then helps learn more), whether it's in a category they said they like, "
    "and variety (avoid what they did yesterday or declined "
    "recently). On a low-energy day prefer lighter options. When they want a challenge, "
    "prefer a harder pace that earns 1.5x today's target in their usual session length "
    "over an easier pace done for longer. Options they can only 'sometimes' access are less "
    "likely to happen. The equipment list is what the user said they have here; use it as a "
    "reference."
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
    "indoors_private": "indoors, in a private space (e.g. home or a hotel room)",
    "indoors_with_others": "indoors, around other people (e.g. a gym or an office)",
    "outside": "outside",
    "home": "at home",
    "gym": "at the gym",
}


def _days_ago_text(days: int) -> str:
    if days == 0:
        return "earlier today"
    if days == 1:
        return "yesterday"
    return f"{days} days ago"


def build_state(req: SuggestBase) -> Dict[str, Any]:
    """Everything Jev should know about the user today, in plain words.

    Names come from the frontend, which has the full activity library; ids
    never reach the prompt. Recent and declined lists go newest first.
    """
    c = req.check_in
    recent = sorted(req.recent, key=lambda r: r.days_ago)
    declines = sorted(req.declines, key=lambda d: d.days_ago)

    # The week first, then today, from the bigger picture down.
    state: Dict[str, Any] = {
        "weekly_goal_met_hours": round(req.weekly_goal_met_hours, 2),
        "done_this_week_met_hours": round(req.done_this_week_met_hours, 2),
        "left_this_week_met_hours": round(req.left_this_week_met_hours, 2),
        "today": req.day_name,
        "met_hours_still_needed_today": round(req.needed_met_hours, 2),
        "time_available_min": c.minutes,
        "where": PLACE_TEXT.get(c.place, c.place),
    }
    if req.equipment_here is not None:
        state["equipment_here_as_the_user_described_it"] = req.equipment_here
    state.update({
        "energy": ENERGY_TEXT.get(c.energy, c.energy),
        "in_the_mood_for": "no preference" if c.mood == "surprise" else c.mood_name,
        "wants_more_than_usual_today": req.boost,
        "favorites_in_order": [f"{e.rank}. {e.name} (access: {e.access})" for e in req.enjoyed],
        "recently_done": [f"{r.name}, {_days_ago_text(r.days_ago)}" for r in recent],
        "recently_declined": [
            f"{d.name}, {_days_ago_text(d.days_ago)}, reason: {d.reason}"
            + (f" ({d.note})" if d.note else "")
            for d in declines
        ],
    })
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
            + (f"Favorite #{rank[o.family_id]}." if o.family_id in rank else "Not picked before.")
            + (" In a category they like." if o.category and o.category in req.liked_categories else "")
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


# --- From the activity table (POST /api/suggest/table) -----------------------
# Here the options are rows of the activity table (activities.candidates), and
# a suggestion takes three calls:
#
# 1. Which heading? One question; the options are the major_headings that
#    have a candidate today (Bicycling, Walking, ...).
# 2. Which activity? One question per heading Jev ranked highest (up to
#    five), so the pick and the four backups are different kinds of activity.
# 3. How long? One question per activity picked in call 2, as above.
#
# Why the heading comes first: one user can have hundreds of candidates, more
# than a question takes (255 options). And if every row were one option, a
# heading with 54 rows would outweigh one with 15 on numbers alone.
#
# The wording below is a first draft made from the sentences above; the same
# open questions for the team apply.

HEADING_INSTRUCTIONS = (
    "Pick the kind of activity this person is most likely to enjoy and actually do today. "
    "Weigh, in order: what they are in the mood for, their energy today, the categories they like "
    "and the kinds they picked before (earlier in that list means liked more), and variety (avoid "
    "what they did yesterday or declined recently). On a low-energy day prefer a kind with lighter "
    "options. A kind they haven't tried is fine: likes rank higher, they don't rule anything out."
)

TABLE_ACTIVITY_INSTRUCTIONS = (
    "Pick the one {heading} activity this person is most likely to enjoy and actually do today. "
    "On a low-energy day prefer lighter options. When they want a challenge, prefer a harder pace "
    "over an easier pace done for longer. The equipment list is what the user said they have "
    "here; use it as a reference."
)

# Same rule as DURATION_INSTRUCTIONS; only the first sentence differs, because a
# table description is longer than a name ("Walking, treadmill, 3.5 to 3.9 mph, 0% grade").
TABLE_DURATION_INSTRUCTIONS = (
    "How long should today's session of this activity be: {activity}? It is {met} MET, so 1 MET-hour "
    "takes about {min_per_met_hour} minutes. Aim to cover the MET-hours still needed today without "
    "going far past it. A shorter session they will finish beats a longer one they will "
    "skip, especially on a low-energy day."
)

# The table has no "usual session length" for an activity yet, so this is shorter than
# CHALLENGE_DURATION_INSTRUCTIONS.
TABLE_CHALLENGE_DURATION_INSTRUCTIONS = (
    " They are up for a challenge: aim for about {aim} MET-hours (1.5x today's target), and let "
    "a harder pace earn the extra rather than a much longer session."
)

Row = Dict[str, Any]  # one row of the activity table


def heading_key(heading: str) -> str:
    """The option name for a heading: "Water Activities" → "water_activities"."""
    return re.sub(r"[^a-z0-9]+", "_", heading.lower()).strip("_")


def table_activity_question(heading: str) -> str:
    """The name of the activity question for one heading, e.g. "activity_in_bicycling"."""
    return "activity_in_" + heading_key(heading)


def table_duration_question(row: Row) -> str:
    """The name of the duration question for one activity, e.g. "duration_01216"."""
    return "duration_" + row["activity_code"]


def group_by_heading(rows: List[Row]) -> Dict[str, List[Row]]:
    """Candidates sorted into their major_heading: {"Bicycling": [...], "Walking": [...]}."""
    groups: Dict[str, List[Row]] = {}
    for r in rows:
        groups.setdefault(r["major_heading"], []).append(r)
    return groups


def build_table_state(
    req: TableSuggestRequest, picked_headings: List[str], descriptions: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """The same state as build_state, plus what the user likes, in the table's own words.

    `picked_headings` is the major_heading of each activity picked before, favorites first
    (activities.headings_of). `descriptions` maps Compendium codes to the table's description
    (activities.descriptions_of): recent and declined activities sent with a code are named by
    it, so Jev sees "Bicycling, stationary, 50 watts, light effort, yesterday".
    """
    descriptions = descriptions or {}
    named = lambda code, name: descriptions.get((code or "").zfill(5), name) if code else name  # noqa: E731
    state: Dict[str, Any] = {}
    for key, value in build_state(req).items():
        if key == "recently_done":
            value = [f"{named(r.code, r.name)}, {_days_ago_text(r.days_ago)}" for r in sorted(req.recent, key=lambda r: r.days_ago)]
        elif key == "recently_declined":
            value = [
                f"{named(d.code, d.name)}, {_days_ago_text(d.days_ago)}, reason: {d.reason}" + (f" ({d.note})" if d.note else "")
                for d in sorted(req.declines, key=lambda d: d.days_ago)
            ]
        if key != "favorites_in_order":
            state[key] = value
            continue
        if req.enjoyed:
            state[key] = value
        if req.liked_categories:
            state["categories_they_like"] = req.liked_categories
        state["kinds_of_activity_picked_before"] = picked_headings
    return state


def _examples(rows: List[Row]) -> List[str]:
    """Up to three descriptions that show a heading's range: its lightest, a middle and its hardest row."""
    by_met = sorted(rows, key=lambda r: r["met_value"])
    spots = sorted({0, len(by_met) // 2, len(by_met) - 1})
    return [by_met[i]["activity_description"] for i in spots]


def build_heading_request(
    state: Dict[str, Any], by_heading: Dict[str, List[Row]], liked: List[str], model: str,
    liked_categories: Iterable[str] = (),
) -> Dict[str, Any]:
    """Call 1: which kind of activity? One option per heading that has a candidate today.

    `liked` is the headings picked before, favorites first; `liked_categories` the ones marked 👍.
    Both are named in the option, so Jev can rank them higher. Neither limits the options.
    """
    thumbs = set(liked_categories)
    options = {}
    for heading, rows in by_heading.items():
        mets = [r["met_value"] for r in rows]
        text = (
            f"{heading}. {len(rows)} activities fit today, {min(mets):g} to {max(mets):g} MET. "
            f"For example: {'; '.join(_examples(rows))}."
        )
        if heading in thumbs:
            text += " A category they like."
        if heading in liked:
            text += f" Picked before (#{liked.index(heading) + 1})."
        options[heading_key(heading)] = text
    return {
        "model": model,
        "state": state,
        "questions": {"heading": {"type": "choice", "instructions": HEADING_INSTRUCTIONS, "criteria": options}},
    }


def build_table_activity_request(
    state: Dict[str, Any], by_heading: Dict[str, List[Row]], model: str, picked_codes: Iterable[str] = ()
) -> Dict[str, Any]:
    """Call 2: which activity, asked once for each heading given. The option names are activity codes.

    An activity the user picked before says so ("Picked before."), so Jev can rank it higher.
    """
    picked = {str(c).strip().zfill(5) for c in picked_codes}
    questions = {
        table_activity_question(heading): {
            "type": "choice",
            "instructions": TABLE_ACTIVITY_INSTRUCTIONS.format(heading=heading),
            "criteria": {
                r["activity_code"]: f"{r['activity_description']} ({r['met_value']:g} MET)"
                + (" Picked before." if r["activity_code"] in picked else "")
                for r in rows
            },
        }
        for heading, rows in by_heading.items()
    }
    return {"model": model, "state": state, "questions": questions}


def build_table_duration_request(
    req: TableSuggestRequest, state: Dict[str, Any], picked: List[Row], model: str
) -> Dict[str, Any]:
    """Call 3: how long, asked once for each activity picked in call 2."""
    options = {str(d): f"{d} minutes" for d in req.durations}
    questions = {}
    for r in picked:
        text = TABLE_DURATION_INSTRUCTIONS.format(
            activity=r["activity_description"], met=f"{r['met_value']:g}", min_per_met_hour=round(60 / r["met_value"])
        )
        if req.boost:
            text += TABLE_CHALLENGE_DURATION_INSTRUCTIONS.format(aim=round(challenge.challenge_aim(req), 2))
        questions[table_duration_question(r)] = {"type": "choice", "instructions": text, "criteria": options}
    return {"model": model, "state": state, "questions": questions}
