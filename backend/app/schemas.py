"""
Request and response shapes for the API.

The frontend sends everything as variables: today's check-in, the user's
ranked activities, and the options that passed the hard filters (enjoyed,
accessible, fits the time, allowed by health limits). The backend only turns
these into a prompt for Jev and Jev's answers into a suggestion. All MET-hour
math stays in the frontend calculator (src/lib).

POST /api/suggest/table is the same idea with one difference: the options
come from the activity table in the backend, not from the frontend
(TableSuggestRequest, TablePick).
"""
from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CheckIn(BaseModel):
    minutes: int
    place: str  # home | gym | office | outside | traveling | other
    energy: str  # challenge | normal | low
    mood: str  # an activity family id, or "surprise"
    mood_name: Optional[str] = None  # the name shown to people, e.g. "Cycling"; none for "surprise"

    @model_validator(mode="after")
    def _mood_has_a_name(self):
        if self.mood != "surprise" and not self.mood_name:
            raise ValueError("mood_name is required unless mood is 'surprise'")
        return self


class Enjoyed(BaseModel):
    family_id: str
    name: str
    rank: int  # 1 = favorite
    access: str  # have | sometimes


class Option(BaseModel):
    """One activity variant the user could do today, e.g. cycling at an easy pace."""

    variant_id: str
    family_id: str
    family_name: str
    kind: str
    label: str
    met: float
    description: str
    setting: str  # indoor | outdoor
    # Its category in the activity table (major_heading, e.g. "Bicycling"); empty from older clients.
    category: str = ""


class Recent(BaseModel):
    family_id: str
    name: str  # the name shown to people, e.g. "Desk moves"
    days_ago: int
    # Its Compendium code, when the activity came from the activity table. The table route then
    # names it by the table's description, e.g. "Bicycling, stationary, 50 watts, light effort".
    code: Optional[str] = None


class Decline(BaseModel):
    family_id: str
    name: str
    reason: str
    days_ago: int
    note: Optional[str] = None
    code: Optional[str] = None  # as in Recent


class Limits(BaseModel):
    no_vigorous: bool = False
    max_session_min: Optional[int] = None


class SuggestBase(BaseModel):
    """What both suggestion routes need to know about the user today."""

    user_id: str = "demo"
    weekly_goal_met_hours: float
    done_this_week_met_hours: float
    left_this_week_met_hours: float
    day_name: str
    check_in: CheckIn
    needed_met_hours: float = Field(description="MET-hours still needed to reach today's target")
    # Names of the equipment the user said they have where they are today, their own tags included.
    # None: no equipment on file (older saves), so nothing was filtered by equipment.
    equipment_here: Optional[List[str]] = None
    target_met_hours: Optional[float] = Field(default=None, description="Today's full target (a challenge aims for 1.5x this)")
    boost: bool = False  # "Up for a challenge" or "I want more today": aim for 1.5× today's need
    enjoyed: List[Enjoyed]
    durations: List[int]
    recent: List[Recent] = []
    declines: List[Decline] = []
    limits: Limits = Limits()
    constraint_notes: List[str] = []  # e.g. "Indoors only (weather)"
    # Table categories the user marked 👍 in onboarding or Settings. Disliked ones are filtered
    # out by the app before the options are sent.
    liked_categories: List[str] = []


class SuggestRequest(SuggestBase):
    """POST /api/suggest: the app has already filtered its own activity library and sends the options."""

    options: List[Option]


class TableSuggestRequest(SuggestBase):
    """POST /api/suggest/table: the options come from the activity table, so the app sends none.

    Instead it says what the backend needs to filter the table (activities.candidates).
    """

    # Not needed here: what the user likes comes from liked_categories and picked_codes.
    enjoyed: List[Enjoyed] = []
    # Compendium codes of the activities the user accepted before, favorites first. They rank
    # higher (named to Jev as "picked before"); they never limit what can be suggested.
    picked_codes: List[str] = []
    # major_headings to leave out today: 👎 categories, or after "Did this recently" on a Bicycling pick.
    exclude_headings: List[str] = []
    # Activities ruled out today ("Not in the mood", "Can't access it", "Other"): only that row goes.
    exclude_codes: List[str] = []
    # After "Weather": only what can be done at the gym or at home.
    indoor_only: bool = False
    # Light activity (under 3 MET) doesn't count toward the goal, so it isn't offered.
    min_met: Optional[float] = 3.0
    # Only activities under this MET, e.g. after "Too tired". limits.no_vigorous already means under 6.
    below_met: Optional[float] = None


class Pick(BaseModel):
    variant_id: str
    family_id: str
    duration_min: int
    probability: float
    reasons: List[str]


class SuggestResponse(BaseModel):
    source: Literal["jev", "mock"]
    model: str
    lead: Pick
    backups: List[Pick]
    jev_request: dict
    jev_answers: Dict[str, dict]
    log_id: int


class TablePick(BaseModel):
    """One suggested activity from the activity table, with what the app needs to show it."""

    activity_code: str  # 5-digit Compendium code, the id both sides share
    major_heading: str
    activity_description: str
    label: str  # the description up to its effort level, for the card: "Bicycling, stationary, 50 watts"
    # Where it can be done, from the table's place columns: any of "gym", "home", "outside".
    places: List[str] = []
    met_value: float
    duration_min: int
    heading_probability: float  # Jev's probability for this heading (1.0 when there was only one)
    probability: float  # Jev's probability for this activity among the ones in its heading
    reasons: List[str]


class TableSuggestResponse(BaseModel):
    source: Literal["jev", "mock"]
    model: str
    lead: TablePick
    backups: List[TablePick]
    candidate_count: int  # how many activities in the table fit today, before Jev chose
    jev_request: dict
    jev_answers: Dict[str, dict]
    log_id: int


class MemorySuggestRequest(BaseModel):
    """POST /api/suggest/memory: today's check-in. Everything else about the user is read from Memory.

    There is no place here for the weekly goal, what is done, or what is needed today. The
    backend works those out itself (calculator.py), and a request that carries them anyway
    is refused, so the app's own numbers can never get mixed in with the backend's.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: str = "demo"
    check_in: CheckIn
    # The user's "today", e.g. "2026-11-23". Left out: the date on the backend's own clock.
    date: Optional[str] = None
    # "I want more today": aim for 1.5× what is still needed.
    want_more: bool = False


class TodayNumbers(BaseModel):
    """Today's numbers as the backend worked them out, in MET-hours. The app shows these as they are."""

    day_name: str
    weekly_goal_met_hours: float
    done_this_week_met_hours: float
    left_this_week_met_hours: float
    target_met_hours: float  # today's share of the weekly goal
    done_today_met_hours: float
    needed_met_hours: float  # what is still missing from today's share


class MemoryPick(TablePick):
    """A pick from the activity table, plus what it would add toward the weekly goal.

    On /api/suggest/table the app works that out itself. Here the backend does the math, so the app only shows it.
    """

    met_hours: float


class MemorySuggestResponse(TableSuggestResponse):
    """The table route's answer, plus the numbers it was based on and what each pick would add."""

    lead: MemoryPick
    backups: List[MemoryPick]
    today: TodayNumbers


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """What the Chat tab sends to POST /api/chat (HttpAgent in src/services/agent.ts).

    `system` is the prompt the app built for the model that writes, with the user's numbers in it.
    `messages` is the conversation so far, oldest first; the last user message is the one to answer.
    """

    system: str = ""
    messages: List[ChatMessage]


class TodayReadRequest(BaseModel):
    """A typed answer on the Today tab, for ChatGPT to turn into fields (POST /api/today/read)."""

    step: str
    question: str = ""
    text: str = Field(min_length=1, max_length=500)


class TodayWhyRequest(BaseModel):
    """Today's pick and the facts the code already has, for the "Based on" line (POST /api/today/why)."""

    activity: str
    facts: List[str] = Field(default_factory=list, max_length=12)


class TodayRecapRequest(BaseModel):
    """Last week's numbers, for Monday's two-sentence recap (POST /api/today/recap)."""

    facts: Dict[str, Union[float, int, str, bool]]
