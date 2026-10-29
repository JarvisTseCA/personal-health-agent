/**
 * Past weeks rolled up into months for the month view on Progress. A week
 * belongs to the month its Thursday falls in, so a week is never split and
 * each month gets the weeks that are mostly in it.
 */
import { streakOf, trophyEarned } from "./rewards";

export interface WeekIn {
  start: Date;
  label: string;
  done: number;
  goal: number;
  /** Days with any activity, Monday to Sunday */
  active: boolean[];
  /** Days the user opened the app, Monday to Sunday */
  signIns: boolean[];
  /** Planned days off ("off"), for the calendar */
  plan?: readonly string[];
}

/** The month (0–11) a week counts in: the month its Thursday falls in. */
export function weekMonth(start: Date): { year: number; month: number } {
  const th = thursday(start);
  return { year: th.getFullYear(), month: th.getMonth() };
}

export interface Period {
  key: string;
  year: number;
  /** 0–11 */
  month: number;
  label: string;
  weeks: WeekIn[];
  done: number;
  goal: number;
  /** Weeks that reached their goal */
  trophies: number;
  activeDays: number;
  /** Days the user opened the app */
  signInDays: number;
  /** Longest run of days in a row with the app opened, within this period's weeks */
  bestStreak: number;
  /** The period isn't over yet (it includes the current week) */
  partial: boolean;
}

export function thursday(d: Date): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + 3);
  return t;
}

function keyOf(start: Date): { key: string; year: number; month: number; label: string } {
  const { year, month } = weekMonth(start);
  return { key: `${year}-${month}`, year, month, label: new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
}

/** Newest period first. `currentWeek` is this week's Monday, to mark the period still in progress. */
export function groupWeeks(weeks: WeekIn[], currentWeek: Date): Period[] {
  const out = new Map<string, Period>();
  for (const w of weeks) {
    const { key, year, month, label } = keyOf(w.start);
    let p = out.get(key);
    if (!p) {
      p = { key, year, month, label, weeks: [], done: 0, goal: 0, trophies: 0, activeDays: 0, signInDays: 0, bestStreak: 0, partial: false };
      out.set(key, p);
    }
    p.weeks.push(w);
    p.done += w.done;
    p.goal += w.goal;
    if (trophyEarned(w.done, w.goal)) p.trophies++;
    p.activeDays += w.active.filter(Boolean).length;
    p.signInDays += w.signIns.filter(Boolean).length;
  }
  const now = keyOf(currentWeek).key;
  const periods = [...out.values()];
  for (const p of periods) {
    p.partial = p.key === now;
    const days = [...p.weeks].sort((a, b) => a.start.getTime() - b.start.getTime()).flatMap((w) => w.signIns);
    p.bestStreak = streakOf(days).best;
  }
  return periods.sort((a, b) => b.weeks[0].start.getTime() - a.weeks[0].start.getTime());
}
