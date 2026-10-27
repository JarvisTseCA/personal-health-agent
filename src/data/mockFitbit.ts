/**
 * Simulated Fitbit data for the demo.
 *
 * Each persona has four past weeks (for streaks, gold weeks and the weekly
 * goal rules) and the first days of the current week. Rows are shaped like
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
  enjoyed: string[];
  access: Record<string, Access>;
  plan: WeekPlan;
  /** Oldest first */
  history: WeekRecord[];
  thisWeek: Session[];
  declines: DemoDecline[];
}

let n = 0;
const s = (dayIndex: number, variantId: string, durationMin: number, startTime = "6:10 pm"): Session => ({
  id: `h-${n++}`, variantId, durationMin, dayIndex, source: "fitbit", confirmed: true, startTime,
});
const week = (goal: number, plan: WeekPlan, sessions: Session[]): WeekRecord => ({ goal, plan, sessions });

const USUAL: WeekPlan = ["10", "30", "30", "off", "10", "45", "10"];

export const PERSONAS: DemoPersona[] = [
  {
    id: "alex",
    name: "Alex",
    blurb: "34, working parent. A 10-day streak; the recap keeps the goal at 7.5.",
    goal: 7.5,
    enjoyed: ["cycling", "dancing", "walking"],
    access: { cycling: "have", dancing: "have", walking: "have" },
    plan: USUAL,
    history: [
      week(7.5, USUAL, [s(0, "dancing-salsa", 40), s(2, "cycling-commute", 30, "8:05 am"), s(5, "walking-stroller", 30, "10:30 am"), s(6, "walking-stroller", 20, "4:15 pm")]),
      week(7.5, USUAL, [s(1, "cycling-easy", 25), s(3, "dancing-salsa", 30, "8:20 pm"), s(5, "walking-stroller", 30, "10:30 am")]),
      week(7.5, USUAL, [s(0, "cycling-commute", 30, "8:05 am"), s(2, "dancing-salsa", 40, "8:20 pm"), s(4, "walking-brisk", 20, "12:15 pm"), s(6, "walking-stroller", 20, "4:15 pm")]),
      week(7.5, USUAL, [
        s(0, "walking-stroller", 20, "5:30 pm"), s(1, "cycling-commute", 30, "8:05 am"), s(2, "desk-stretch", 10, "2:00 pm"),
        s(3, "dancing-salsa", 30, "8:20 pm"), s(4, "walking-stroller", 15, "5:30 pm"), s(5, "cycling-easy", 30, "9:45 am"), s(6, "walking-stroller", 20, "4:15 pm"),
      ]),
    ],
    thisWeek: [s(0, "walking-stroller", 20, "5:30 pm"), s(1, "cycling-easy", 25, "6:10 pm")],
    declines: [{ familyId: "dancing", reason: "not-mood", day: -2 }],
  },
  {
    id: "roll",
    name: "On a roll",
    blurb: "Over 10 MET-hours two weeks running; the recap offers a raise to 10.",
    goal: 7.5,
    enjoyed: ["cycling", "hiit", "running"],
    access: { cycling: "have", hiit: "have", running: "have" },
    plan: ["30", "30", "30", "off", "30", "45", "off"],
    history: [
      week(7.5, USUAL, [s(0, "cycling-commute", 30), s(2, "hiit-moderate", 25), s(4, "running-jog", 30), s(5, "cycling-steady", 30)]),
      week(7.5, USUAL, [s(1, "cycling-commute", 40), s(2, "hiit-moderate", 30), s(4, "running-jog", 30), s(6, "walking-brisk", 30)]),
      week(7.5, USUAL, [s(0, "running-jog", 30), s(1, "cycling-commute", 30), s(3, "hiit-moderate", 25), s(5, "cycling-steady", 15)]),
      week(7.5, USUAL, [s(0, "cycling-commute", 30), s(2, "running-jog", 30), s(4, "hiit-moderate", 25), s(6, "walking-brisk", 15)]),
    ],
    thisWeek: [s(0, "cycling-commute", 30, "8:05 am"), s(1, "hiit-moderate", 20, "7:00 am")],
    declines: [],
  },
  {
    id: "tough",
    name: "Tough month",
    blurb: "Under half the goal three weeks running; the recap offers 3.75.",
    goal: 7.5,
    enjoyed: ["walking", "dancing", "yoga"],
    access: { walking: "have", dancing: "sometimes", yoga: "have" },
    plan: ["10", "off", "30", "off", "10", "30", "off"],
    history: [
      week(7.5, USUAL, [s(0, "walking-brisk", 30), s(2, "dancing-salsa", 30), s(5, "walking-moderate", 40)]),
      week(7.5, USUAL, [s(1, "walking-moderate", 25), s(5, "dancing-salsa", 20)]),
      week(7.5, USUAL, [s(3, "walking-stroller", 30)]),
      week(7.5, USUAL, [s(0, "walking-moderate", 20), s(4, "yoga-power", 25)]),
    ],
    thisWeek: [s(1, "walking-stroller", 15, "5:30 pm")],
    declines: [{ familyId: "dancing", reason: "no-time", day: -4 }, { familyId: "walking", reason: "weather", day: -1 }],
  },
  {
    id: "fresh",
    name: "Fresh start",
    blurb: "New user: no history, nothing recorded this week.",
    goal: 7.5,
    enjoyed: ["cycling", "dancing"],
    access: { cycling: "have", dancing: "have" },
    plan: USUAL,
    history: [],
    thisWeek: [],
    declines: [],
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
