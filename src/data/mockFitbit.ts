/**
 * Simulated Fitbit data for the demo.
 *
 * Each persona has about six months of past weeks (for trophies, the
 * weekly goal rules and the month view), the first days of the current
 * week, which days they opened the app (for the streak), their equipment and
 * a monthly VO2 max estimate. Rows are shaped like
 * PMData exercise logs so a loader for Fitabase / PMData / LifeSnaps can
 * produce the same `Session` objects later.
 */
import type { FitbitBand, Session } from "../lib/met";
import type { WeekPlan } from "../lib/plan";
import type { Access, DeclineReason } from "../lib/suggest";

export interface WeekRecord {
  goal: number;
  plan: WeekPlan;
  sessions: Session[];
  /** Days the user opened the app, Monday to Sunday. Missing on a week from Fitbit or an older save: then no day of it counts as opened. */
  signIns?: boolean[];
}

export interface EquipmentProfile {
  home: string[];
  /**
   * Equipment at the user's gym. null: not listed, so a typical gym is assumed. There's no
   * "doesn't use a gym" setting any more; older saves with null are read this way too.
   */
  gym: string[] | null;
}

export interface DemoDecline {
  familyId: string;
  reason: DeclineReason;
  /** Day number relative to this week's Monday (negative = last week) */
  day: number;
}

export interface DemoPersona {
  id: string;
  name: string;
  blurb: string;
  goal: number;
  /**
   * For the demo: the goal was raised by the agent (and accepted) on this week's Monday, from
   * `from` to `goal`, for this reason. Missing: the goal is the default.
   */
  goalRaise?: { from: number; reason: string };
  enjoyed: string[];
  access: Record<string, Access>;
  plan: WeekPlan;
  /** Oldest first */
  history: WeekRecord[];
  thisWeek: Session[];
  /** Days this week the user opens the app (only days up to "today" are used; opening the app puts today on record) */
  signInsThisWeek: boolean[];
  declines: DemoDecline[];
  equipment: EquipmentProfile;
  /**
   * Fitbit's VO2 max estimate (mL/kg/min), one reading a month, oldest
   * first, ending this month. Empty: no estimate yet.
   */
  vo2: number[];
}

let n = 0;
const s = (dayIndex: number, variantId: string, durationMin: number, startTime = "6:10 pm"): Session => ({
  id: `h-${n++}`, variantId, durationMin, dayIndex, source: "fitbit", confirmed: true, startTime,
});
const week = (goal: number, plan: WeekPlan, sessions: Session[]): WeekRecord => ({ goal, plan, sessions });

const USUAL: WeekPlan = ["10", "30", "30", "off", "10", "45", "10"];

/** How many weeks of older history each persona gets, before the 4 recent weeks (about 6 months in all). */
export const OLDER_WEEKS = 22;
/** Week-to-week wobble, so older weeks don't all look the same. */
const WOBBLE = [0.9, 1.1, 0.8, 1, 1.2, 0.95, 0.85, 1.05];

/**
 * Older weeks for the month and 4-month views on Progress: the persona's
 * recent pattern repeated, with each week's minutes scaled by `scale(i)`
 * (i = 0 is the oldest). Same days as the pattern, so streaks don't change.
 */
function older(pattern: WeekRecord[], scale: (i: number) => number): WeekRecord[] {
  return Array.from({ length: OLDER_WEEKS }, (_, i) => {
    const w = pattern[i % pattern.length];
    const f = scale(i) * WOBBLE[i % WOBBLE.length];
    return week(w.goal, w.plan, w.sessions.map((x) => s(x.dayIndex, x.variantId, Math.max(10, Math.round((x.durationMin * f) / 5) * 5), x.startTime)));
  });
}
const withOlder = (recent: WeekRecord[], scale: (i: number) => number) => [...older(recent, scale), ...recent];

/**
 * Which days the persona opened the app. Days with activity always count;
 * on other days they skip about one in `missEvery`. The last `runBefore`
 * days before this week are all signed in, with a miss just before them, so
 * the streak shown is exact.
 */
function withSignIns(history: WeekRecord[], missEvery: number, runBefore: number): WeekRecord[] {
  const total = history.length * 7;
  return history.map((w, i) => {
    const active = Array.from({ length: 7 }, (_, d) => w.sessions.some((x) => x.dayIndex === d));
    const signIns = active.map((a, d) => {
      const k = i * 7 + d;
      const fromEnd = total - k;
      if (fromEnd <= runBefore) return true;
      if (fromEnd === runBefore + 1) return false;
      return a || (k * 37 + 11) % missEvery !== 0;
    });
    return { ...w, signIns };
  });
}

const ALL_WEEK = [true, true, true, true, true, true, true];
const GYM_BASIC = ["treadmill", "stationary-bike", "elliptical", "rowing-machine", "dumbbells", "bench", "weight-machines"];

/**
 * The five personas from the team's persona sheet (5_personas.docx), each built on a published
 * activity pattern, plus a new user for the first log-in. Goals, constraints and workflows in the
 * sheet are design assumptions; the workouts here are made up to show each pattern.
 */
export const PERSONAS: DemoPersona[] = [
  {
    id: "maya",
    name: "Maya",
    blurb: "Getting started: low activity on most days, 10 minutes and no equipment. Under half the goal three weeks running, so the recap offers 3.75.",
    goal: 7.5,
    enjoyed: ["walking", "dancing"],
    access: { walking: "have", dancing: "have" },
    plan: ["10", "10", "10", "10", "10", "off", "off"],
    // Inactive profile (Clark et al., 2021): a little walking, about the same for months.
    history: withSignIns(withOlder([
      week(7.5, USUAL, [s(0, "walking-brisk", 20, "12:15 pm"), s(3, "dancing-video", 15, "7:40 pm")]),
      week(7.5, USUAL, [s(1, "walking-moderate", 25), s(5, "dancing-salsa", 20)]),
      week(7.5, USUAL, [s(3, "walking-stroller", 30)]),
      week(7.5, USUAL, [s(0, "walking-moderate", 20), s(4, "dancing-video", 20, "7:40 pm")]),
    ], () => 1), 3, 4),
    thisWeek: [s(1, "walking-moderate", 10, "12:15 pm")],
    // Opened the app Monday, not Tuesday, back today: a new run starts quietly.
    signInsThisWeek: [true, false, true, true, true, true, true],
    declines: [{ familyId: "dancing", reason: "no-time", day: -4 }, { familyId: "walking", reason: "weather", day: -1 }],
    equipment: { home: [], gym: null },
    vo2: [35, 35, 35, 35, 36, 35],
  },
  {
    id: "alex",
    name: "Alex",
    blurb: "Fits exercise into short windows: 10 to 15 minutes at a time, little sustained activity. A 12-day streak.",
    goal: 7.5,
    enjoyed: ["walking", "cycling", "dancing"],
    access: { walking: "have", cycling: "have", dancing: "have" },
    plan: ["10", "10", "10", "off", "10", "10", "off"],
    // Activity in short bouts (Cai et al., 2026): many short sessions, none long.
    history: withSignIns(withOlder([
      week(7.5, USUAL, [s(0, "walking-brisk", 10, "12:15 pm"), s(1, "cycling-commute", 15, "8:05 am"), s(2, "dancing-video", 10, "9:00 pm"), s(4, "walking-brisk", 15, "12:15 pm"), s(5, "cycling-commute", 15, "8:05 am")]),
      week(7.5, USUAL, [s(0, "cycling-commute", 15, "8:05 am"), s(2, "walking-brisk", 10, "12:15 pm"), s(3, "walking-brisk", 10, "5:30 pm"), s(4, "dancing-video", 15, "9:00 pm"), s(6, "walking-brisk", 15, "4:15 pm")]),
      week(7.5, USUAL, [s(1, "walking-brisk", 15, "12:15 pm"), s(2, "cycling-commute", 15, "8:05 am"), s(4, "cycling-commute", 15, "8:05 am"), s(5, "dancing-video", 10, "9:00 pm")]),
      week(7.5, USUAL, [
        s(0, "walking-brisk", 10, "12:15 pm"), s(1, "cycling-commute", 15, "8:05 am"), s(2, "walking-brisk", 10, "5:30 pm"),
        s(3, "dancing-video", 10, "9:00 pm"), s(4, "cycling-commute", 15, "8:05 am"), s(5, "walking-brisk", 15, "10:30 am"),
      ]),
    ], () => 1), 6, 9),
    thisWeek: [s(0, "walking-brisk", 10, "12:15 pm"), s(1, "cycling-commute", 15, "8:05 am")],
    signInsThisWeek: ALL_WEEK,
    declines: [{ familyId: "dancing", reason: "not-mood", day: -2 }],
    equipment: { home: ["resistance-bands"], gym: GYM_BASIC },
    vo2: [37, 37, 38, 38, 38, 39],
  },
  {
    id: "jordan",
    name: "Jordan",
    blurb: "Exercises on two days: long workouts on the weekend. The agent raised the goal to 10 on Monday after an 11.6 MET-hour week.",
    goal: 10,
    goalRaise: { from: 7.5, reason: "Last week you did 11.6 MET-hours, well above your 7.5 goal." },
    enjoyed: ["running", "cycling", "hiking"],
    access: { running: "have", cycling: "have", hiking: "have" },
    plan: ["off", "off", "off", "off", "off", "45", "45"],
    // Activity concentrated on one or two days (Khurshid et al., 2023).
    history: withSignIns(withOlder([
      week(7.5, USUAL, [s(5, "running-jog", 40, "9:00 am"), s(6, "hiking-normal", 60, "10:00 am")]),
      week(7.5, USUAL, [s(5, "cycling-steady", 45, "9:00 am"), s(6, "running-jog", 30, "9:30 am")]),
      week(7.5, USUAL, [s(5, "running-jog", 45, "9:00 am"), s(6, "hiking-normal", 45, "10:00 am")]),
      week(7.5, USUAL, [s(5, "running-jog", 45, "9:00 am"), s(6, "cycling-steady", 45, "9:30 am")]),
    ], () => 1), 2, 2),
    thisWeek: [],
    // Opened the app Monday (and accepted the raise), then today.
    signInsThisWeek: [true, false, true, true, true, true, true],
    declines: [],
    equipment: { home: [], gym: GYM_BASIC },
    vo2: [42, 42, 43, 43, 43, 44],
  },
  {
    id: "sam",
    name: "Sam",
    blurb: "Rotating shifts: walks a lot at work, fits cardio into days off. Shifts Monday to Wednesday this week.",
    goal: 7.5,
    enjoyed: ["cycling", "swimming", "hiking", "walking"],
    access: { cycling: "have", swimming: "sometimes", hiking: "have", walking: "have" },
    plan: ["5", "5", "5", "45", "45", "30", "30"],
    // Shift workers' activity (Loprinzi, 2015): walking on shift days, the days moving week to week.
    history: withSignIns(withOlder([
      week(7.5, USUAL, [s(0, "walking-moderate", 40, "2:30 pm"), s(1, "walking-moderate", 45, "2:30 pm"), s(2, "walking-moderate", 40, "2:30 pm"), s(4, "cycling-steady", 30, "11:00 am"), s(6, "swimming-laps", 30, "10:00 am")]),
      week(7.5, USUAL, [s(0, "cycling-commute", 30, "11:00 am"), s(2, "walking-moderate", 45, "11:30 pm"), s(3, "walking-moderate", 40, "11:30 pm"), s(4, "walking-moderate", 45, "11:30 pm"), s(6, "hiking-normal", 60, "10:00 am")]),
      week(7.5, USUAL, [s(1, "cycling-steady", 30, "11:00 am"), s(4, "walking-moderate", 30, "2:30 pm"), s(5, "walking-moderate", 30, "2:30 pm"), s(6, "walking-moderate", 30, "2:30 pm")]),
      week(7.5, USUAL, [s(0, "walking-moderate", 30, "2:30 pm"), s(1, "walking-moderate", 30, "2:30 pm"), s(2, "walking-moderate", 30, "2:30 pm"), s(5, "hiking-normal", 45, "10:00 am")]),
    ], () => 1), 4, 3),
    thisWeek: [s(0, "walking-moderate", 35, "2:30 pm"), s(1, "walking-moderate", 40, "3:10 pm")],
    signInsThisWeek: ALL_WEEK,
    declines: [{ familyId: "swimming", reason: "no-access", day: -5 }],
    equipment: { home: [], gym: [...GYM_BASIC, "pool"] },
    vo2: [39, 39, 40, 39, 40, 40],
  },
  {
    id: "priya",
    name: "Priya",
    blurb: "Trains four days a week and wants to see progress. Over 10 MET-hours two weeks running, so the recap offers a raise to 10; VO2 max up 5 since spring.",
    goal: 7.5,
    enjoyed: ["cycling", "hiit", "strength", "running"],
    access: { cycling: "have", hiit: "have", strength: "have", running: "have" },
    plan: ["30", "30", "off", "30", "off", "45", "off"],
    // Regularly active, spread across the week (Khurshid et al., 2023); building up: older weeks were lighter.
    history: withSignIns(withOlder([
      week(7.5, USUAL, [s(0, "cycling-commute", 30), s(2, "hiit-moderate", 25), s(4, "running-jog", 30), s(5, "cycling-steady", 30)]),
      week(7.5, USUAL, [s(1, "cycling-commute", 40), s(2, "hiit-moderate", 30), s(4, "running-jog", 30), s(6, "walking-brisk", 30)]),
      week(7.5, USUAL, [s(0, "running-jog", 30), s(1, "cycling-commute", 30), s(3, "hiit-moderate", 25), s(5, "cycling-steady", 15)]),
      week(7.5, USUAL, [s(0, "cycling-commute", 30), s(2, "running-jog", 30), s(4, "hiit-moderate", 25), s(6, "walking-brisk", 15)]),
    ], (i) => 0.55 + (0.4 * i) / OLDER_WEEKS), 15, 38),
    thisWeek: [s(0, "cycling-commute", 30, "8:05 am"), s(1, "hiit-moderate", 20, "7:00 am")],
    signInsThisWeek: ALL_WEEK,
    declines: [],
    equipment: { home: ["dumbbells", "kettlebell", "jump-rope", "yoga-mat"], gym: [...GYM_BASIC, "barbell", "pool"] },
    vo2: [41, 42, 43, 43, 45, 46],
  },
  {
    id: "fresh",
    name: "Fresh start",
    blurb: "New user: no history, nothing recorded this week. The first log-in button starts here.",
    goal: 7.5,
    enjoyed: ["cycling", "dancing"],
    access: { cycling: "have", dancing: "have" },
    plan: USUAL,
    history: [],
    thisWeek: [],
    signInsThisWeek: [false, false, false, false, false, false, false],
    declines: [],
    equipment: { home: [], gym: null },
    vo2: [],
  },
];

/** A bout Fitbit detected but nobody has confirmed: a guess plus how sure we are. */
export interface DetectedBout {
  guessVariantId: string;
  durationMin: number;
  band: FitbitBand;
  startTime: string;
  avgHeartRate: number;
}

/**
 * What "Sync Fitbit" returns when the user hasn't accepted a suggestion (or
 * did something else): an unconfirmed bout the coach asks about.
 */
export const UNPLANNED_BOUTS: DetectedBout[] = [
  { guessVariantId: "cycling-commute", durationMin: 32, band: "very", startTime: "6:10 pm", avgHeartRate: 138 },
  { guessVariantId: "dancing-video", durationMin: 25, band: "fairly", startTime: "7:40 pm", avgHeartRate: 124 },
  { guessVariantId: "walking-brisk", durationMin: 30, band: "fairly", startTime: "12:15 pm", avgHeartRate: 112 },
];
