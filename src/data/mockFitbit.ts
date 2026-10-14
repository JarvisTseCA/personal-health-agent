/**
 * Simulated Fitbit data for the demo.
 *
 * Shaped like the exercise logs in PMData (activity type, duration, effort)
 * so the same code path can later read real rows from Fitabase / PMData /
 * LifeSnaps, or from the Fitbit Web API.
 */
import type { Session } from "../lib/guideline";

export interface DemoPersona {
  id: string;
  name: string;
  blurb: string;
  sessions: Session[];
}

export const PERSONAS: DemoPersona[] = [
  {
    id: "alex",
    name: "Alex",
    blurb: "34, working parent. Two short sessions so far this week.",
    sessions: [
      { id: "fb-1", variantId: "walking-stroller", durationMin: 20, dayIndex: 0, source: "fitbit", avgHeartRate: 104 },
      { id: "fb-2", variantId: "cycling-easy", durationMin: 25, dayIndex: 1, source: "fitbit", avgHeartRate: 118 },
    ],
  },
  {
    id: "fresh",
    name: "Fresh start",
    blurb: "Nothing recorded yet this week.",
    sessions: [],
  },
  {
    id: "almost",
    name: "Nearly there",
    blurb: "A busy week of commuting by bike.",
    sessions: [
      { id: "fb-3", variantId: "cycling-commute", durationMin: 30, dayIndex: 0, source: "fitbit", avgHeartRate: 136 },
      { id: "fb-4", variantId: "dancing-salsa", durationMin: 40, dayIndex: 1, source: "fitbit", avgHeartRate: 121 },
      { id: "fb-5", variantId: "cycling-commute", durationMin: 15, dayIndex: 2, source: "fitbit", avgHeartRate: 133 },
    ],
  },
];

/**
 * What a "Sync Fitbit" press returns in the demo: the next plausible
 * workout for today. Cycles through a few realistic options.
 */
export const SIMULATED_SYNCS: Array<Omit<Session, "id" | "dayIndex">> = [
  { variantId: "cycling-commute", durationMin: 25, source: "fitbit", avgHeartRate: 138 },
  { variantId: "dancing-video", durationMin: 20, source: "fitbit", avgHeartRate: 131 },
  { variantId: "walking-brisk", durationMin: 30, source: "fitbit", avgHeartRate: 112 },
];
