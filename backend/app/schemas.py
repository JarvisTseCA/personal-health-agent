"""
Request and response shapes for the API.

The frontend sends everything as variables: today's check-in, the user's
ranked activities, and the options that passed the hard filters (enjoyed,
accessible, fits the time, allowed by health limits). The backend only turns
these into a prompt for Jev and Jev's answers into a suggestion. All MET-hour
math stays in the frontend calculator (src/lib).
"""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class CheckIn(BaseModel):
    minutes: int
    place: str  # home | office | outside | traveling | other
    energy: str  # challenge | normal | low
    mood: str  # an activity family id, or "surprise"


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


class Recent(BaseModel):
    family_id: str
    days_ago: int


class Decline(BaseModel):
    family_id: str
    reason: str
    days_ago: int
    note: Optional[str] = None


class Limits(BaseModel):
    no_vigorous: bool = False
    max_session_min: Optional[int] = None


class SuggestRequest(BaseModel):
    user_id: str = "demo"
    day_name: str
    check_in: CheckIn
    needed_met_hours: float = Field(description="MET-hours still needed to reach today's target")
    target_met_hours: Optional[float] = Field(default=None, description="Today's full target (a challenge aims for 1.5x this)")
    boost: bool = False  # "Up for a challenge" or "I want more today": aim for 1.5× today's need
    enjoyed: List[Enjoyed]
    options: List[Option]
    durations: List[int]
    recent: List[Recent] = []
    declines: List[Decline] = []
    limits: Limits = Limits()
    constraint_notes: List[str] = []  # e.g. "Indoors only (weather)"


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
