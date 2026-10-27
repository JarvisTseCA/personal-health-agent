/**
 * Past weeks rolled up into months for the month view on Progress. A week
 * belongs to the month its Thursday falls in, so a week is never split and
 * each month gets the weeks that are mostly in it.
 */
import type { Medal } from "./medals";

export interface WeekIn {
  start: Date;
  label: string;
  done: number;
  goal: number;
  medals: Medal[];
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
  goldWeeks: number;
  medals: Record<Exclude<Medal, "none">, number>;
  activeDays: number;
  /** The period isn't over yet (it includes the current week) */
  partial: boolean;
}

const EPS = 1e-9;

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
      p = { key, year, month, label, weeks: [], done: 0, goal: 0, goldWeeks: 0, medals: { bronze: 0, silver: 0, gold: 0 }, activeDays: 0, partial: false };
      out.set(key, p);
    }
    p.weeks.push(w);
    p.done += w.done;
    p.goal += w.goal;
    if (w.done + EPS >= w.goal) p.goldWeeks++;
    for (const m of w.medals) if (m !== "none") { p.medals[m]++; p.activeDays++; }
  }
  const now = keyOf(currentWeek).key;
  const periods = [...out.values()];
  for (const p of periods) p.partial = p.key === now;
  return periods.sort((a, b) => b.weeks[0].start.getTime() - a.weeks[0].start.getTime());
}
