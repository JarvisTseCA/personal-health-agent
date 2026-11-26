/**
 * What travels between the app and the backend when the app runs with the backend:
 *
 *  - Memory: what the backend remembers about the user, in six groups (backend/app/memory.py).
 *  - The numbers: everything on screen that is worked out, as the backend worked it out
 *    (backend/app/memory_numbers.py, backend/app/progress.py).
 *
 * Five of Memory's groups are facts the backend works with. The sixth, "other", is the app's
 * own: the backend keeps it and hands it back as it was. The app puts five things there:
 *
 *    today       the Today conversation
 *    chat        the Chat messages
 *    notes       what the user typed that the app couldn't turn into a choice
 *    clinician   the clinician's feedback, as typed in Chat
 *    app         the rest of what the app needs to open as it was (AppOwn below)
 *
 * Dates here are "2026-11-25" strings. The helpers at the bottom work on them in UTC, so a
 * time zone can never move a day.
 */
import type { TableActivity } from "../lib/tableActivities";
import type { CategoryPrefs } from "../lib/categories";
import type { DaySource } from "../lib/plan";
import type { Access } from "../lib/suggest";
import type { ChatMessage, ClinicianNotes, GoalSet, NoteRecord, SuggestSource, TodayState, UsualTime } from "../state/types";

// --- Memory ------------------------------------------------------------------------------------

export interface MemoryGoalWeek {
  /** The week's Monday */
  week_start: string;
  goal_met_hours: number | null;
  /** default, recap (the agent's offer, accepted) or user (typed in Settings, onboarding or Today's first conversation) */
  goal_set_by: "default" | "recap" | "user" | null;
  /** Monday to Sunday: off | 0 | 5 | 10 | 30 | 45 */
  plan: string[] | null;
}

export interface MemoryCheckIn {
  date: string;
  minutes: number | null;
  place: string | null;
  energy: string | null;
  mood: string | null;
}

export interface MemorySuggestion {
  id: string;
  date: string;
  place: string | null;
  /** Compendium code, for an activity from the activity table */
  activity_code: string | null;
  activity_name: string;
  outcome: "accepted" | "declined";
  reason: string | null;
  note: string | null;
}

export interface MemoryWorkout {
  id: string;
  date: string;
  activity_code: string | null;
  activity_name: string;
  met: number;
  duration_min: number;
  source: "manual" | "fitbit";
  confirmed: boolean;
  band: string | null;
  start_time: string | null;
}

export interface Memory {
  who: { name: string | null; fitbit_connected: boolean | null };
  preferences: {
    categories: CategoryPrefs;
    /** Names, as the backend tells Jev about them. null: not listed */
    equipment: { home: string[] | null; gym: string[] | null };
    no_vigorous: boolean | null;
  };
  goals: MemoryGoalWeek[];
  daily: { check_ins: MemoryCheckIn[]; suggestions: MemorySuggestion[]; workouts: MemoryWorkout[]; app_opens: string[] };
  health: {
    vo2_max: Array<{ month: string; ml_kg_min: number; source?: string }>;
    heart_rates: Array<{ workout_id: string; avg_bpm: number }>;
  };
  other: Record<string, unknown>;
}

/** Any part of Memory, as POST /api/memory takes it. */
export interface MemoryPart {
  who?: Memory["who"];
  preferences?: Memory["preferences"];
  goals?: MemoryGoalWeek[];
  daily?: Partial<Memory["daily"]>;
  health?: Partial<Memory["health"]>;
  other?: Record<string, unknown>;
}

/** The rest of the app's state: what Memory's five groups have no place for. Kept under other.app. */
export interface AppOwn {
  version: 1;
  onboarded: boolean;
  personaId: string;
  /** Today in the demo week, 0 = Monday. With a real Fitbit it is the real day. */
  todayIndex: number;
  /** The Monday of the week this was saved in. A different Monday at the next open means a new week has started. */
  week: string;
  profile: { enjoyed: string[]; access: Record<string, Access>; usualTime: UsualTime; fitbitLive?: boolean };
  planSource: DaySource[];
  recapHandled: boolean;
  syncCount: number;
  painReports: number;
  fitbitWeek?: string;
  removedFitbitIds?: string[];
  suggestSource?: SuggestSource;
  tableActivities?: Record<string, TableActivity>;
  /** Workouts by id: which of the app's own activities each one is, and the user's name for it if they typed one */
  workouts: Record<string, { variantId: string; customName?: string }>;
  /** Declines by id: the app's activity for the ones that aren't from the activity table */
  declines: Record<string, { familyId: string }>;
  /** This week's goal change: who set it, on which day, from what, and the agent's reason (shown beside the goal) */
  goalSet?: GoalSet;
  /** Today's first conversation still sets the week's goal and plan */
  weekSetup?: boolean;
}

/** What the app keeps under Memory's "other". */
export interface OtherOfApp {
  today?: TodayState;
  chat?: ChatMessage[];
  notes?: NoteRecord[];
  clinician?: ClinicianNotes;
  app?: AppOwn;
}

// --- The numbers ---------------------------------------------------------------------------------

export interface NumbersWorkout {
  id: string | null;
  /** 0 = Monday … 6 = Sunday */
  day: number;
  activity_code: string | null;
  activity_name: string;
  duration_min: number;
  /** The bottom of its Fitbit band while unconfirmed, otherwise its own MET */
  counted_met: number;
  /** What it adds toward the goal */
  met_hours: number;
  intensity: "light" | "moderate" | "vigorous";
}

export interface NumbersActivity {
  activity_code: string | null;
  activity_name: string;
  minutes: number;
}

export interface NumbersWeek {
  week_start: string;
  goal_met_hours: number;
  plan: string[];
  done_met_hours: number;
  done_by_day: number[];
  active_days: boolean[];
  app_opens: boolean[];
  trophy: boolean;
  minutes: number;
  top_activity: NumbersActivity | null;
  workouts: NumbersWorkout[];
}

export interface NumbersThisWeek extends NumbersWeek {
  left_met_hours: number;
  /** Each day's target, Monday first */
  targets: number[];
  unplanned_met_hours: number;
}

export interface NumbersMonth {
  /** "2026-11" */
  month: string;
  week_starts: string[];
  done_met_hours: number;
  goal_met_hours: number;
  trophies: number;
  active_days: number;
  app_open_days: number;
  best_streak: number;
  partial: boolean;
}

export interface NumbersSummary {
  weeks: number;
  avg_met_hours: number;
  avg_brisk_min: number;
  pct_of_guideline: number;
  goal_min: number;
  goal_weeks: number;
  avg_active_days: number;
  chart: Array<{ week_start: string; current: boolean; met_hours: number; brisk_min: number; goal_met_hours: number; goal_min: number; reached: boolean }>;
  calendar: Array<{ week_start: string; days: boolean[] }>;
  longest_gap: number;
  intensity: { light: number; moderate: number; vigorous: number };
  mix: Array<{ activity_code: string | null; activity_name: string; min_per_week: number }>;
}

/** Every number on the app's screens, as GET /api/numbers gives them. */
export interface Numbers {
  today: string;
  today_index: number;
  day: { name: string; target_met_hours: number; done_met_hours: number; needed_met_hours: number; reached: boolean };
  this_week: NumbersThisWeek;
  /** Days in a row on record as opened, ending today; `best` is the longest run in everything Memory holds */
  streak: { current: number; best: number };
  trophy: boolean;
  /** All so far, this week's included, counted over everything Memory holds */
  trophies: number;
  /** Oldest first; the last one is last week. The last 26 at most: Memory keeps the weeks before them */
  past_weeks: NumbersWeek[];
  /** Newest first; made from past_weeks */
  months: NumbersMonth[];
  goal_offer: { kind: "raise" | "lower" | "keep"; from: number; to: number; reason: string };
  summary: NumbersSummary;
  vo2: { series: Array<{ month: string; ml_kg_min: number }>; latest: number; change: number; peak_mets: number } | null;
}

// --- Dates ---------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const two = (n: number) => String(n).padStart(2, "0");

/** "2026-11-25" + 3 → "2026-11-28" */
export function addDays(iso: string, days: number): string {
  const d = new Date(utc(iso) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** The Monday of the week `now` is in, on the user's own calendar. */
export function mondayOf(now: Date): string {
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return addDays(today, -((now.getDay() + 6) % 7));
}

/** The Monday of the week a date is in. */
export function weekOf(iso: string): string {
  return addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7));
}

/** "2026-11" moved by `months`: addMonths("2026-11", -2) → "2026-09" */
export function addMonths(month: string, months: number): string {
  const k = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
  return `${Math.floor(k / 12)}-${two((k % 12) + 1)}`;
}
