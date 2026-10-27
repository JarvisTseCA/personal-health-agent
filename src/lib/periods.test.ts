import { describe, expect, it } from "vitest";
import { weekStart } from "../services/context";
import { buildAgentContext } from "../services/context";
import { initialState, personaProfile } from "../state/store";
import { groupWeeks, weekMonth, type WeekIn } from "./periods";
import type { Medal } from "./medals";

const mon = (y: number, m: number, d: number) => new Date(y, m, d);
const wk = (start: Date, done: number, active = 3): WeekIn => ({
  start, label: start.toDateString(), done, goal: 7.5,
  medals: Array.from({ length: 7 }, (_, i) => (i < active ? (done >= 7.5 ? "gold" : "bronze") : "none")) as Medal[],
});

describe("earlier weeks by month and 4-month period", () => {
  it("puts a week in the month its Thursday falls in", () => {
    // Mon Sep 28 2026: its Thursday is Oct 1, so it's an October week.
    const p = groupWeeks([wk(mon(2026, 8, 21), 5), wk(mon(2026, 8, 28), 8)], "month", mon(2026, 9, 26));
    expect(p.map((x) => [x.key, x.weeks.length])).toEqual([["2026-9", 1], ["2026-8", 1]]);
  });

  it("a week's calendar month is the month of its Thursday", () => {
    expect(weekMonth(mon(2026, 7, 31))).toEqual({ year: 2026, month: 8 }); // Aug 31 → September
    expect(weekMonth(mon(2026, 8, 28))).toEqual({ year: 2026, month: 9 }); // Sep 28 → October
    expect(weekMonth(mon(2026, 9, 26))).toEqual({ year: 2026, month: 9 }); // Oct 26 → October
  });

  it("adds up MET-hours, goals, gold weeks and medals, newest first", () => {
    const weeks = [wk(mon(2026, 9, 5), 8, 4), wk(mon(2026, 9, 12), 5, 2), wk(mon(2026, 9, 19), 9, 5)];
    const [oct] = groupWeeks(weeks, "month", mon(2026, 9, 26));
    expect(oct.done).toBe(22);
    expect(oct.goal).toBe(22.5);
    expect(oct.goldWeeks).toBe(2);
    expect(oct.medals).toEqual({ gold: 9, silver: 0, bronze: 2 });
    expect(oct.activeDays).toBe(11);
    expect(oct.partial).toBe(true);
  });

  it("uses 4-month periods: Jan–Apr, May–Aug, Sep–Dec", () => {
    const weeks = [wk(mon(2026, 3, 27), 5), wk(mon(2026, 4, 4), 5), wk(mon(2026, 7, 24), 5), wk(mon(2026, 8, 7), 5)];
    const p = groupWeeks(weeks, "quarter", mon(2026, 9, 26));
    expect(p.map((x) => [x.label, x.weeks.length, x.partial])).toEqual([
      ["Sep–Dec 2026", 1, true], ["May–Aug 2026", 2, false], ["Jan–Apr 2026", 1, false],
    ]);
  });

  it("the demo has about six months of weeks to group", () => {
    let s = initialState("alex");
    s = { ...s, onboarded: true, profile: personaProfile(s) };
    const ctx = buildAgentContext(s);
    expect(ctx.past.length).toBe(26);
    const months = groupWeeks(ctx.past.map((w) => ({ start: w.start, label: w.label, done: w.totals.done, goal: w.goal, medals: w.medals })), "month", weekStart(0));
    expect(months.length).toBeGreaterThanOrEqual(6);
    expect(months.reduce((a, m) => a + m.weeks.length, 0)).toBe(26);
  });
});
