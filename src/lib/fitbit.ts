/**
 * Turns real Fitbit data (Google Health API rows, from the backend) into the
 * app's own records: each workout becomes a Session, the weeks before this one
 * become history, and the VO2 max readings become the monthly series.
 *
 * Which activity a workout was comes from Fitbit's exercise type
 * (EXERCISE_VARIANTS). How hard it was comes from the heart rate zones: mostly
 * vigorous or peak is Fitbit's "very active" band, anything else "fairly
 * active". A type the app has no activity for becomes "Other activity" under
 * the user's name for it, counted at the bottom of its band.
 *
 * Dates are the user's own calendar days as the backend sends them
 * ("2026-11-16T18:10:00"), so week math never touches time zones.
 */
import type { FitbitBand, Session } from "./met";

/** One workout as the backend's /api/fitbit/sync sends it. */
export interface FitbitWorkout {
  /** Google's data point name, stable across syncs */
  id: string;
  /** Fitbit's exercise type, e.g. "RUNNING" */
  exercise_type: string;
  name: string | null;
  /** Start on the user's own clock, "2026-11-16T18:10:00" */
  start: string;
  duration_min: number;
  avg_heart_rate: number | null;
  zone_min: { light: number; moderate: number; vigorous: number; peak: number };
}

export interface Vo2Reading {
  date: string;
  vo2_max: number;
  method: string | null;
}

export interface FitbitData {
  workouts: FitbitWorkout[];
  vo2: Vo2Reading[];
}

/** What a sync hands the reducer: already converted, so the reducer needs no clock. */
export interface FitbitImport {
  /** 0 = Monday … 6 = Sunday, from the user's real calendar */
  todayIndex: number;
  /** This week's Monday, "2026-11-16" */
  week: string;
  /** This week's workouts; earlier days are confirmed, today's are not yet */
  thisWeek: Session[];
  /** Earlier weeks' workouts, oldest first, starting at the first week with any */
  history: Session[][];
  /** Monthly VO2 max, oldest first, ending this month */
  vo2: number[];
}

/** Weeks of history to import: about six months, like the demo personas. */
export const HISTORY_WEEKS = 26;
/** Months of VO2 max shown on Progress and Summary. */
export const VO2_MONTHS = 6;

const pair = (fairly: string, very = fairly): Record<FitbitBand, string> => ({ fairly, very });
const RUN = pair("running-jog", "running-6mph");
const WALK = pair("walking-moderate", "walking-brisk");
const BIKE = pair("cycling-easy", "cycling-steady");
const DANCE = pair("dancing-salsa", "dancing-nightclub");
const HIIT = pair("hiit-moderate", "hiit-vigorous");
const SWIM = pair("swimming-laps", "swimming-fast");
const HIKE = pair("hiking-normal", "hiking-cross");
const WEIGHTS = pair("strength-weights", "strength-supersets");
const BODYWEIGHT = pair("strength-bodyweight", "strength-hard");

/**
 * Fitbit exercise type → the app's variant for a fairly active and a very
 * active session. Types not listed here count as "Other activity".
 * Full list: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
 */
export const EXERCISE_VARIANTS: Record<string, Record<FitbitBand, string>> = {
  RUNNING: RUN, TRAIL_RUN: RUN, INCLINE_RUN: RUN,
  // Fitbit's plain "Treadmill" is used for walks and runs alike: the effort decides.
  TREADMILL: pair("walking-treadmill", "running-jog"),
  WALKING: WALK, POWER_WALKING: WALK, NORDIC_WALKING: WALK,
  STROLLER_WALK: pair("walking-stroller"),
  TREADMILL_WALK: pair("walking-treadmill"), INCLINE_WALK: pair("walking-treadmill"),
  BIKING: BIKE, OUTDOOR_BIKE: BIKE, MOUNTAIN_BIKE: BIKE,
  STATIONARY_BIKE: pair("cycling-stationary", "cycling-spin"), SPINNING: pair("cycling-spin"),
  DANCING: DANCE, HIP_HOP: DANCE, JAZZ_DANCE: DANCE, MODERN_DANCE: DANCE, BREAKDANCING: DANCE,
  BALLROOM_DANCE: pair("dancing-ballroom"), TANGO: pair("dancing-ballroom"),
  ZUMBA: pair("zumba-video", "zumba-class"),
  HIIT, INTERVAL_WORKOUT: HIIT, BOOTCAMP: HIIT, CROSSFIT: HIIT, TABATA_WORKOUT: pair("hiit-vigorous"),
  SWIMMING: SWIM, SWIMMING_POOL: SWIM, SWIMMING_OPEN_WATER: SWIM,
  HIKING: HIKE, BACKPACKING: HIKE,
  YOGA: pair("yoga-hatha", "yoga-power"), YOGA_HATHA: pair("yoga-hatha"),
  YOGA_POWER: pair("yoga-power"), YOGA_VINYASA: pair("yoga-power"),
  ROWING_MACHINE: pair("rowing-moderate", "rowing-vigorous"),
  ELLIPTICAL: pair("elliptical-moderate", "elliptical-vigorous"),
  STRENGTH_TRAINING: WEIGHTS, WEIGHTS, WEIGHTLIFTING: WEIGHTS, FREE_WEIGHTS: WEIGHTS,
  WEIGHT_MACHINES: WEIGHTS, FUNCTIONAL_STRENGTH_TRAINING: WEIGHTS, CIRCUIT_TRAINING: WEIGHTS,
  BODY_WEIGHT: BODYWEIGHT, CALISTHENICS: BODYWEIGHT,
  BASKETBALL: pair("basketball-casual", "basketball-game"),
};

/** "Very active" when most of the time was in the vigorous or peak heart rate zone; no zones is "fairly". */
export function bandOf(w: FitbitWorkout): FitbitBand {
  const z = w.zone_min;
  return z.vigorous + z.peak > z.light + z.moderate ? "very" : "fairly";
}

/** "2026-11-16T18:10:00" → "6:10 pm", the way the app writes times. */
export function clockTime(start: string): string {
  const [h, m] = start.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** One workout as a Session on `dayIndex` of its week. */
export function sessionOf(w: FitbitWorkout, dayIndex: number, confirmed: boolean): Session {
  const band = bandOf(w);
  const known = EXERCISE_VARIANTS[w.exercise_type];
  return {
    id: w.id,
    variantId: known ? known[band] : `other-${band}`,
    durationMin: w.duration_min,
    dayIndex,
    source: "fitbit",
    confirmed,
    band,
    startTime: clockTime(w.start),
    ...(w.avg_heart_rate !== null ? { avgHeartRate: w.avg_heart_rate } : {}),
    // Not in the activity list: keep Fitbit's name for it ("Tennis"), like a name the user typed.
    ...(known ? {} : { customName: w.name ?? w.exercise_type.toLowerCase().replace(/_/g, " ") }),
  };
}

/** Days since 1970-01-01 for the date part of "2026-11-16…". */
function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Day 0 was a Thursday; this makes Monday 0 and Sunday 6. */
const weekdayOf = (day: number) => (day + 3) % 7;

/** Day number → "2026-11-16". */
function dayDate(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday `n` weeks before the week starting on Monday `week`. */
export function weekBefore(week: string, n: number): string {
  return dayDate(dayNumber(week) - 7 * n);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The first date a sync asks for: enough for HISTORY_WEEKS of workouts and VO2_MONTHS of VO2 max. */
export function syncSince(now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weeks = new Date(today);
  weeks.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 7 * HISTORY_WEEKS);
  const months = new Date(today.getFullYear(), today.getMonth() - (VO2_MONTHS - 1), 1);
  return isoDate(weeks < months ? weeks : months);
}

/**
 * One VO2 max per month for the last `months` months, ending this month: the
 * month's latest reading, rounded like Fitbit shows it. A month without a
 * reading keeps the last one, since that's the estimate Fitbit still shows.
 * Months before the first reading are left out.
 */
export function monthlyVo2(readings: Vo2Reading[], now: Date, months = VO2_MONTHS): number[] {
  const monthOf = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const latest = new Map<number, Vo2Reading>();
  for (const r of readings) {
    const prev = latest.get(monthOf(r.date));
    if (!prev || r.date >= prev.date) latest.set(monthOf(r.date), r);
  }
  const thisMonth = now.getFullYear() * 12 + now.getMonth();
  const out: number[] = [];
  let last: number | null = null;
  for (let k = thisMonth - months + 1; k <= thisMonth; k++) {
    const r = latest.get(k);
    if (r) last = Math.round(r.vo2_max);
    if (last !== null) out.push(last);
  }
  return out;
}

/** Sorts the synced workouts into this week and earlier weeks, as of `now` on the user's clock. */
export function importFitbit(data: FitbitData, now: Date): FitbitImport {
  const today = dayNumber(isoDate(now));
  const todayIndex = weekdayOf(today);
  const monday = today - todayIndex;
  const weeks: Session[][] = Array.from({ length: HISTORY_WEEKS }, () => []);
  const thisWeek: Session[] = [];
  for (const w of [...data.workouts].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = dayNumber(w.start);
    if (day > today) continue;
    if (day >= monday) {
      thisWeek.push(sessionOf(w, day - monday, day < today));
      continue;
    }
    const weeksAgo = Math.ceil((monday - day) / 7);
    if (weeksAgo <= HISTORY_WEEKS) weeks[HISTORY_WEEKS - weeksAgo].push(sessionOf(w, weekdayOf(day), true));
  }
  // Leading empty weeks are before the user had a Fitbit, not weeks they missed.
  const first = weeks.findIndex((w) => w.length > 0);
  return { todayIndex, week: dayDate(monday), thisWeek, history: first < 0 ? [] : weeks.slice(first), vo2: monthlyVo2(data.vo2, now) };
}
