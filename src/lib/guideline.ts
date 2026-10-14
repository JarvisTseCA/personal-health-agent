/**
 * Converts workouts into "guideline minutes" toward the U.S. Physical
 * Activity Guidelines for adults: 150 min of moderate activity, or 75 min of
 * vigorous activity, or an equivalent mix, per week.
 *
 * Rule used here (standard equivalence):
 *   light    (< 3.0 MET)      → counts 0×
 *   moderate (3.0 – 5.9 MET)  → counts 1×
 *   vigorous (≥ 6.0 MET)      → counts 2×  (1 vigorous min = 2 moderate min)
 */
import { getVariant, type Intensity } from "./activities";

export const WEEKLY_GOAL_MINUTES = 150;

export function intensityOf(met: number): Intensity {
  if (met >= 6) return "vigorous";
  if (met >= 3) return "moderate";
  return "light";
}

export function multiplierOf(met: number): 0 | 1 | 2 {
  const i = intensityOf(met);
  return i === "vigorous" ? 2 : i === "moderate" ? 1 : 0;
}

export function guidelineMinutes(met: number, durationMin: number): number {
  return multiplierOf(met) * durationMin;
}

export interface Session {
  id: string;
  variantId: string;
  durationMin: number;
  /** 0 = Monday … 6 = Sunday, within the current week */
  dayIndex: number;
  source: "fitbit" | "manual";
  avgHeartRate?: number;
}

export interface SessionWithCredit extends Session {
  familyId: string;
  met: number;
  intensity: Intensity;
  credit: number;
}

export function withCredit(s: Session): SessionWithCredit {
  const { family, variant } = getVariant(s.variantId);
  return {
    ...s,
    familyId: family.id,
    met: variant.met,
    intensity: intensityOf(variant.met),
    credit: guidelineMinutes(variant.met, s.durationMin),
  };
}

export interface WeekSummary {
  sessions: SessionWithCredit[];
  doneMinutes: number;
  remainingMinutes: number;
  percent: number;
  clockMinutesUsed: number;
  moderateMinutes: number;
  vigorousMinutes: number;
  metMinutes: number;
}

export function summarizeWeek(sessions: Session[], goal = WEEKLY_GOAL_MINUTES): WeekSummary {
  const enriched = sessions.map(withCredit);
  const doneMinutes = enriched.reduce((a, s) => a + s.credit, 0);
  return {
    sessions: enriched,
    doneMinutes,
    remainingMinutes: Math.max(0, goal - doneMinutes),
    percent: Math.round((doneMinutes / goal) * 100),
    clockMinutesUsed: enriched.reduce((a, s) => a + s.durationMin, 0),
    moderateMinutes: enriched.filter((s) => s.intensity === "moderate").reduce((a, s) => a + s.durationMin, 0),
    vigorousMinutes: enriched.filter((s) => s.intensity === "vigorous").reduce((a, s) => a + s.durationMin, 0),
    metMinutes: Math.round(enriched.reduce((a, s) => a + s.met * s.durationMin, 0)),
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
