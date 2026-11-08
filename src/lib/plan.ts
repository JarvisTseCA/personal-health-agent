/**
 * Weekly planning and daily targets.
 *
 * The user marks the days they can't exercise at all ("off") and how much
 * time they have on the rest, from the same list as Today's check-in
 * (0, 5, 10, 30 or 45+ min; 0 means desk moves only). The weekly goal never drops because of off
 * days; it is split across the available days, weighted by their time:
 *
 *   daily target(d) = MET-hours left × minutes on d / minutes on all remaining days
 *
 * Today's target is fixed at the start of the day (what's left before today,
 * split over today and the days after it), so silver is judged against a
 * number that doesn't move while you work out. Anything done today then
 * re-divides the rest of the week, so extra effort today lowers later days.
 * Later days assume today's target gets met; if it doesn't, tomorrow's
 * start-of-day split picks up the shortfall.
 */
export type DaySlot = "off" | "0" | "5" | "10" | "30" | "45";

export const SLOT_MINUTES: Record<DaySlot, number> = { off: 0, "0": 0, "5": 5, "10": 10, "30": 30, "45": 45 };
export const SLOT_LABEL: Record<DaySlot, string> = { off: "Off", "0": "0 min", "5": "5 min", "10": "10 min", "30": "30 min", "45": "45+ min" };
export const SLOT_HINT: Record<DaySlot, string> = {
  off: "Can't exercise", "0": "Desk moves only", "5": "About 5 min", "10": "About 10 min", "30": "About 30 min", "45": "45 min or more",
};
export const SLOTS: DaySlot[] = ["off", "0", "5", "10", "30", "45"];
/** How the options are laid out on Today and Progress: Off / 0, 5, 10, 30 min / 45+ min. */
export const SLOT_ROWS: DaySlot[][] = [["off"], ["0", "5", "10", "30"], ["45"]];

export type WeekPlan = DaySlot[];

export const DEFAULT_PLAN: WeekPlan = ["30", "off", "30", "10", "off", "45", "10"];

/**
 * Where a day's time came from. The weekly planning session sets every day
 * ("plan"), and the app puts each day's time on the user's calendar as an
 * exercise block. If the user edits a block on their calendar, that day's
 * time follows the block ("calendar"). Empty space on the calendar is never
 * treated as free time: only these two sources count.
 */
export type DaySource = "plan" | "calendar";
export const ALL_FROM_PLAN: DaySource[] = Array(7).fill("plan");

/** Saves from before calendar blocks: every day came from the plan. */
export function migrateSources(sources: readonly string[] | undefined): DaySource[] {
  return Array.from({ length: 7 }, (_, i) => (sources?.[i] === "calendar" ? "calendar" : "plan"));
}

/**
 * Demo stand-in for the user shortening a day's exercise block on their
 * calendar: the next shorter time on the list (45 → 30 → 10 → 5). Null when
 * the day has no block to shorten (off, desk moves only, or already 5 min).
 */
export function shorterSlot(slot: DaySlot): DaySlot | null {
  const order: DaySlot[] = ["45", "30", "10", "5"];
  const i = order.indexOf(slot);
  return i < 0 || i === order.length - 1 ? null : order[i + 1];
}

/** A day's exercise block was changed on the calendar: the plan follows it. */
export function applyCalendarEdit(plan: WeekPlan, sources: DaySource[], day: number, slot: DaySlot): { plan: WeekPlan; sources: DaySource[] } {
  return {
    plan: plan.map((s, i) => (i === day ? slot : s)),
    sources: sources.map((s, i) => (i === day ? "calendar" : s)),
  };
}

/** Saves from before the time list: Short → 10, Medium → 30, Long → 45 min. */
const LEGACY: Record<string, DaySlot> = { short: "10", medium: "30", long: "45" };
export function migratePlan(plan: readonly string[]): WeekPlan {
  return plan.map((s) => (s in SLOT_MINUTES ? (s as DaySlot) : LEGACY[s] ?? "30"));
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function dailyTargets(goal: number, plan: WeekPlan, doneByDay: number[], todayIndex: number): number[] {
  const w = plan.map((s) => SLOT_MINUTES[s]);
  const targets = Array(7).fill(0) as number[];

  // Past days and today: what was left at the start of that day, split over that day onward.
  for (let d = 0; d <= todayIndex; d++) {
    const left = Math.max(0, goal - sum(doneByDay.slice(0, d)));
    const denom = sum(w.slice(d));
    targets[d] = denom > 0 ? (left * w[d]) / denom : 0;
  }

  // Future days: what's left after today, split over the remaining available days.
  // Today counts as at least its own target, so later days don't look bigger
  // just because today isn't over yet; any shortfall moves on tomorrow.
  const leftAfterToday = Math.max(0, goal - sum(doneByDay.slice(0, todayIndex)) - Math.max(targets[todayIndex], doneByDay[todayIndex]));
  const futureDenom = sum(w.slice(todayIndex + 1));
  for (let d = todayIndex + 1; d < 7; d++) {
    targets[d] = futureDenom > 0 ? (leftAfterToday * w[d]) / futureDenom : 0;
  }
  return targets;
}

/** MET-hours that no remaining day can absorb (every day after today is off). */
export function unplannedLeft(goal: number, plan: WeekPlan, doneByDay: number[], todayIndex: number): number {
  const todayTarget = dailyTargets(goal, plan, doneByDay, todayIndex)[todayIndex];
  const leftAfterToday = Math.max(0, goal - sum(doneByDay.slice(0, todayIndex)) - Math.max(todayTarget, doneByDay[todayIndex]));
  const futureMinutes = sum(plan.slice(todayIndex + 1).map((s) => SLOT_MINUTES[s]));
  return futureMinutes > 0 ? 0 : leftAfterToday;
}
