/**
 * Medals and streaks.
 *
 *  Bronze: any activity that day, light activity included.
 *  Silver: that day's MET-hours reach its daily target (replaces bronze).
 *  Gold:   the weekly goal is reached; every medal that week turns gold,
 *          including ones earned later that week.
 *
 * The streak counts consecutive days with at least a bronze. Any day with no
 * activity ends it, planned off or not. Today doesn't break the streak until
 * it's over, so it shows as "pending" while it's still empty.
 */
export type Medal = "none" | "bronze" | "silver" | "gold";

const EPS = 1e-9;

export function weekMedals(activeByDay: boolean[], doneByDay: number[], targets: number[], weekDone: number, goal: number, lastDay = 6): Medal[] {
  const goldWeek = weekDone + EPS >= goal;
  return activeByDay.map((active, d) => {
    if (d > lastDay || !active) return "none";
    if (goldWeek) return "gold";
    if (targets[d] > 0 && doneByDay[d] + EPS >= targets[d]) return "silver";
    return "bronze";
  });
}

export interface Streak {
  current: number;
  best: number;
  /** True when today has no medal yet but the streak is still alive */
  todayPending: boolean;
}

/** `days` = every day up to and including today, oldest first. */
export function streakOf(days: Medal[]): Streak {
  let best = 0;
  let run = 0;
  for (const m of days) {
    run = m === "none" ? 0 : run + 1;
    best = Math.max(best, run);
  }
  const today = days[days.length - 1];
  const todayPending = today === "none";
  let current = 0;
  for (let i = days.length - (todayPending ? 2 : 1); i >= 0 && days[i] !== "none"; i--) current++;
  return { current, best, todayPending };
}

export const MEDAL_LABEL: Record<Medal, string> = { none: "No medal", bronze: "Bronze", silver: "Silver", gold: "Gold" };
