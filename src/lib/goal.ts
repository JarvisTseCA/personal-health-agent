/**
 * Weekly goal adjustment, offered in the Last week section of the Progress tab. The user taps to accept.
 * The same rules apply at every goal level, including below 7.5.
 *
 *  Raise: take the lower of the last 2 weeks and round it down to a multiple
 *         of 2.5 MET-hours. If that's above the current goal, offer it
 *         (capped at the weekly upper limit, once one is set).
 *  Lower: below 50% of the current goal 3 weeks in a row → offer 50% of it.
 * The user always decides: nothing changes until they tap. Clinicians share
 * suggestions in person (and as notes for the coach); they don't set goals.
 */
export const RAISE_STEP = 2.5;
export const RAISE_WINDOW = 2;
export const LOWER_WINDOW = 3;
export const LOWER_THRESHOLD = 0.5;

/**
 * Evidence-based weekly upper limit in MET-hours. Open clinical question:
 * null until the team's clinician sets it. When set, it caps goal raises and
 * the "keep going" nudges.
 */
export const WEEKLY_UPPER_LIMIT: number | null = null;

export interface GoalOffer {
  kind: "raise" | "lower" | "keep";
  from: number;
  to: number;
  reason: string;
}

const EPS = 1e-9;

/** `pastTotals` = completed weeks' MET-hours, oldest first. */
export function goalOffer(current: number, pastTotals: number[]): GoalOffer {
  const keep = (reason: string): GoalOffer => ({ kind: "keep", from: current, to: current, reason });

  const lastLower = pastTotals.slice(-LOWER_WINDOW);
  if (lastLower.length === LOWER_WINDOW && lastLower.every((t) => t + EPS < current * LOWER_THRESHOLD)) {
    return { kind: "lower", from: current, to: current * LOWER_THRESHOLD, reason: `You were under half your goal ${LOWER_WINDOW} weeks in a row.` };
  }

  const lastRaise = pastTotals.slice(-RAISE_WINDOW);
  if (lastRaise.length === RAISE_WINDOW) {
    const floor = Math.floor((Math.min(...lastRaise) + EPS) / RAISE_STEP) * RAISE_STEP;
    const capped = WEEKLY_UPPER_LIMIT === null ? floor : Math.min(floor, WEEKLY_UPPER_LIMIT);
    if (capped > current + EPS) {
      return { kind: "raise", from: current, to: capped, reason: `You reached at least ${capped} MET-hours in each of the last ${RAISE_WINDOW} weeks.` };
    }
  }
  return keep("Your last few weeks fit this goal well.");
}
