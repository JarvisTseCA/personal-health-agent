/**
 * Weekly planning and daily targets.
 *
 * The user marks the days they can't exercise at all ("off") and a rough
 * amount of time for the rest. The weekly goal never drops because of off
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
export type DaySlot = "off" | "short" | "medium" | "long";

export const SLOT_MINUTES: Record<DaySlot, number> = { off: 0, short: 15, medium: 30, long: 45 };
export const SLOT_LABEL: Record<DaySlot, string> = { off: "Off", short: "Short", medium: "Medium", long: "Long" };
export const SLOT_HINT: Record<DaySlot, string> = { off: "Can't exercise", short: "10–20 min", medium: "About 30 min", long: "45+ min" };
export const SLOTS: DaySlot[] = ["off", "short", "medium", "long"];

export type WeekPlan = DaySlot[];

export const DEFAULT_PLAN: WeekPlan = ["medium", "off", "medium", "short", "off", "long", "short"];

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
