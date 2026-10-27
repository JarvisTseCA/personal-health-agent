"""
"Up for a challenge" earns its extra MET-hours with intensity, not time.
Mirrors challengePlan in src/lib/suggest.ts; keep the two in step.

- Aim: 1.5x today's target, counting what's already done today.
- Usual length: the shortest allowed session that covers today's need at the
  activity's easiest pace that counts toward the goal (3 MET or more).
- The challenge keeps that length (or trims it, if the harder pace gets there
  sooner) and picks the gentlest pace that reaches the aim. Only if even the
  hardest pace falls short does the session get longer.
"""
from typing import List, Optional, Tuple

from .schemas import Option, SuggestRequest

CHALLENGE_FACTOR = 1.5
MODERATE_MET = 3.0
EPS = 1e-9


def credit(met: float, minutes: int) -> float:
    return met * minutes / 60 if met >= MODERATE_MET else 0.0


def challenge_aim(req: SuggestRequest) -> float:
    """MET-hours this session should earn when the user wants a challenge."""
    target = req.target_met_hours if req.target_met_hours is not None else req.needed_met_hours
    if target <= 0:
        return CHALLENGE_FACTOR if req.boost else 0.0
    done_today = max(0.0, target - req.needed_met_hours)
    return max(0.0, target * CHALLENGE_FACTOR - done_today)


def _paces(req: SuggestRequest, family_id: str) -> List[Option]:
    return sorted((o for o in req.options if o.family_id == family_id and o.met >= MODERATE_MET), key=lambda o: o.met)


def usual_minutes(req: SuggestRequest, family_id: str) -> Optional[int]:
    paces = _paces(req, family_id)
    durations = sorted(req.durations)
    if not paces or not durations:
        return None
    need = req.needed_met_hours
    if need <= 0:
        short = [d for d in durations if d <= 20]
        return short[-1] if short else durations[0]
    return next((d for d in durations if credit(paces[0].met, d) + EPS >= need), durations[-1])


def minutes_for(req: SuggestRequest, o: Option) -> Optional[int]:
    """Challenge length for one pace: no longer than usual if it gets there, else the shortest that does."""
    usual = usual_minutes(req, o.family_id)
    if usual is None:
        return None
    want = challenge_aim(req)
    durations = sorted(req.durations)
    reaches = [d for d in durations if credit(o.met, d) + EPS >= want]
    within = [d for d in reaches if d <= usual]
    if within:
        return within[0]
    longer = [d for d in reaches if d >= usual]
    return longer[0] if longer else durations[-1]


def challenge_plan(req: SuggestRequest, family_id: str) -> Optional[Tuple[Option, int]]:
    """The pace and minutes a challenge should use for this activity."""
    paces = _paces(req, family_id)
    usual = usual_minutes(req, family_id)
    if usual is None:
        return None
    want = challenge_aim(req)
    hit = next((o for o in paces if credit(o.met, usual) + EPS >= want), None)
    pace = hit or paces[-1]
    return pace, minutes_for(req, pace)
