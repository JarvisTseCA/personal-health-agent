/**
 * Rewards. The app only ever adds rewards; it never takes one away or
 * points out a miss.
 *
 *  Streak (the flame): days in a row the user opened the app. Missing a day
 *         quietly starts a new run. The app doesn't mention the old one,
 *         ask why, or show a "streak lost" message; Progress shows the best
 *         run so it still counts for something.
 *  Trophy: one for each week the weekly goal is reached. Trophies are kept
 *          for good, and the count only goes up.
 *
 * Bronze, silver and gold daily medals are gone (team decision, Oct 28).
 */

const EPS = 1e-9;

export interface Streak {
  /** Days in a row, ending today (today counts as soon as the app is open) */
  current: number;
  /** Longest run so far */
  best: number;
}

/** `days` = whether the user opened the app each day, oldest first, ending today. */
export function streakOf(days: boolean[]): Streak {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/** Runs of consecutive signed-in days within a week: [start, length] pairs, for the calendar. */
export function runsOf(days: boolean[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  days.forEach((d, i) => {
    if (d && start < 0) start = i;
    if ((!d || i === days.length - 1) && start >= 0) {
      out.push([start, (d ? i + 1 : i) - start]);
      start = -1;
    }
  });
  return out;
}

export function trophyEarned(done: number, goal: number): boolean {
  return goal > 0 && done + EPS >= goal;
}
