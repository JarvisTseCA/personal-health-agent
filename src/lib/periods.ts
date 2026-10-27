/**
 * Past weeks rolled up into months or 4-month periods for the Earlier weeks
 * view on Progress. A week belongs to the month its Thursday falls in, so a
 * week is never split and each month gets the weeks that are mostly in it.
 * 4-month periods follow the calendar: Jan–Apr, May–Aug, Sep–Dec.
 */
import type { Medal } from "./medals";

export type PeriodView = "week" | "month" | "quarter";

/** Months in one "quarter" period, as the team asked for (a calendar quarter would be 3). */
export const QUARTER_MONTHS = 4;

export interface WeekIn {
  start: Date;
  label: string;
  done: number;
  goal: number;
  medals: Medal[];
}

export interface Period {
  key: string;
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
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function thursday(d: Date): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + 3);
  return t;
}

function keyOf(start: Date, by: Exclude<PeriodView, "week">): { key: string; label: string } {
  const th = thursday(start);
  const y = th.getFullYear();
  const m = th.getMonth();
  if (by === "month") {
    return { key: `${y}-${m}`, label: th.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  }
  const q = Math.floor(m / QUARTER_MONTHS);
  const first = q * QUARTER_MONTHS;
  const last = Math.min(11, first + QUARTER_MONTHS - 1);
  return { key: `${y}-q${q}`, label: `${MONTHS_SHORT[first]}–${MONTHS_SHORT[last]} ${y}` };
}

/** Newest period first. `currentWeek` is this week's Monday, to mark the period still in progress. */
export function groupWeeks(weeks: WeekIn[], by: Exclude<PeriodView, "week">, currentWeek: Date): Period[] {
  const out = new Map<string, Period>();
  for (const w of weeks) {
    const { key, label } = keyOf(w.start, by);
    let p = out.get(key);
    if (!p) {
      p = { key, label, weeks: [], done: 0, goal: 0, goldWeeks: 0, medals: { bronze: 0, silver: 0, gold: 0 }, activeDays: 0, partial: false };
      out.set(key, p);
    }
    p.weeks.push(w);
    p.done += w.done;
    p.goal += w.goal;
    if (w.done + EPS >= w.goal) p.goldWeeks++;
    for (const m of w.medals) if (m !== "none") { p.medals[m]++; p.activeDays++; }
  }
  const now = keyOf(currentWeek, by).key;
  const periods = [...out.values()];
  for (const p of periods) p.partial = p.key === now;
  return periods.sort((a, b) => b.weeks[0].start.getTime() - a.weeks[0].start.getTime());
}
