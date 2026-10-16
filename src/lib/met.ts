/**
 * Converts workouts into MET-hours toward the weekly goal.
 *
 * The default goal is 7.5 MET-hours a week (450 MET-minutes), which equals the
 * U.S. Physical Activity Guidelines exactly:
 *   150 min × 3 MET (moderate threshold) = 75 min × 6 MET (vigorous threshold) = 450 MET-min.
 *
 *   MET-hours = MET value × minutes / 60
 *
 * Only activity at 3 MET or more counts toward the goal by default. Whether
 * light activity (< 3 MET, e.g. desk stretches) should count is an open
 * clinical question in the workflow doc; flip LIGHT_COUNTS_TOWARD_GOAL once
 * it's answered. Light activity always earns a bronze medal.
 */
import { getVariant, type Intensity } from "./activities";

export const DEFAULT_WEEKLY_GOAL = 7.5;
export const GUIDELINE_GOAL = 7.5;
export const MODERATE_MET = 3;
export const VIGOROUS_MET = 6;
export const LIGHT_COUNTS_TOWARD_GOAL = false;

/** MET used for a Fitbit bout nobody has confirmed yet: the bottom of each Fitbit band. */
export const UNCONFIRMED_MET = { fairly: 3.0, very: 6.0 } as const;
export type FitbitBand = keyof typeof UNCONFIRMED_MET;

export function intensityOf(met: number): Intensity {
  if (met >= VIGOROUS_MET) return "vigorous";
  if (met >= MODERATE_MET) return "moderate";
  return "light";
}

export function metHours(met: number, durationMin: number): number {
  return (met * durationMin) / 60;
}

export function countsTowardGoal(met: number): boolean {
  return LIGHT_COUNTS_TOWARD_GOAL || met >= MODERATE_MET;
}

/** MET-hours that count toward the weekly goal. */
export function creditFor(met: number, durationMin: number): number {
  return countsTowardGoal(met) ? metHours(met, durationMin) : 0;
}

/** Minutes of an activity needed to earn `target` MET-hours (rounded up to 5). */
export function minutesFor(met: number, target: number): number {
  if (!countsTowardGoal(met) || target <= 0) return 0;
  return Math.max(5, Math.ceil(((target * 60) / met - 1e-9) / 5) * 5);
}

/** One decimal for display: 3.4 */
export function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Goals keep up to two decimals so halving 7.5 shows 3.75, not 3.8. */
export function fmtGoal(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export interface Session {
  id: string;
  variantId: string;
  durationMin: number;
  /** 0 = Monday … 6 = Sunday, within its week */
  dayIndex: number;
  source: "fitbit" | "manual";
  /** Fitbit bouts start unconfirmed and count conservatively until the user confirms */
  confirmed: boolean;
  band?: FitbitBand;
  startTime?: string;
  avgHeartRate?: number;
  /** What the user called it, when they typed an activity that isn't in the list */
  customName?: string;
}

export interface SessionWithCredit extends Session {
  familyId: string;
  met: number;
  intensity: Intensity;
  /** MET-hours that count toward the goal */
  credit: number;
}

export function withCredit(s: Session): SessionWithCredit {
  const { family, variant } = getVariant(s.variantId);
  const met = !s.confirmed && s.band ? UNCONFIRMED_MET[s.band] : variant.met;
  return { ...s, familyId: family.id, met, intensity: intensityOf(met), credit: creditFor(met, s.durationMin) };
}

export interface WeekTotals {
  sessions: SessionWithCredit[];
  done: number;
  doneByDay: number[];
  activeByDay: boolean[];
  minutesUsed: number;
}

export function totalsFor(sessions: Session[]): WeekTotals {
  const enriched = sessions.map(withCredit).sort((a, b) => a.dayIndex - b.dayIndex);
  const doneByDay = Array(7).fill(0) as number[];
  const activeByDay = Array(7).fill(false) as boolean[];
  for (const s of enriched) {
    doneByDay[s.dayIndex] += s.credit;
    activeByDay[s.dayIndex] = true;
  }
  return {
    sessions: enriched,
    done: doneByDay.reduce((a, b) => a + b, 0),
    doneByDay,
    activeByDay,
    minutesUsed: enriched.reduce((a, s) => a + s.durationMin, 0),
  };
}

export function formatDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_NAMES_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
