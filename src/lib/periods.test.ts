import { describe, expect, it } from "vitest";
import { weekStart } from "../services/context";
import { buildAgentContext } from "../services/context";
import { initialState, personaProfile } from "../state/store";
import { groupWeeks, weekMonth, type WeekIn } from "./periods";

const sun = (y: number, m: number, d: number) => new Date(y, m, d);
const wk = (start: Date, done: number, active = 3): WeekIn => ({
  start, label: start.toDateString(), done, goal: 7.5,
  active: Array.from({ length: 7 }, (_, i) => i < active),
  // Opened the app every day but Saturday
  signIns: Array.from({ length: 7 }, (_, i) => i < 6),
});

describe("past weeks by month", () => {
  it("puts a week in the month its Wednesday falls in", () => {
    // Sun Sep 27 2026: its Wednesday is Sep 30, so it's a September week.
    const p = groupWeeks([wk(sun(2026, 8, 20), 5), wk(sun(2026, 8, 27), 8), wk(sun(2026, 9, 4), 6)], sun(2026, 9, 25));
    expect(p.map((x) => [x.key, x.weeks.length])).toEqual([["2026-9", 1], ["2026-8", 2]]);
  });

  it("a week's calendar month is the month of its Wednesday", () => {
    expect(weekMonth(sun(2026, 7, 30))).toEqual({ year: 2026, month: 8 }); // Aug 30 → September (Wed Sep 2)
    expect(weekMonth(sun(2026, 8, 27))).toEqual({ year: 2026, month: 8 }); // Sep 27 → September (Wed Sep 30)
    expect(weekMonth(sun(2026, 9, 25))).toEqual({ year: 2026, month: 9 }); // Oct 25 → October
  });

  it("adds up MET-hours, goals, trophies, active days and streaks, newest first", () => {
    const weeks = [wk(sun(2026, 9, 4), 8, 4), wk(sun(2026, 9, 11), 5, 2), wk(sun(2026, 9, 18), 9, 5)];
    const [oct] = groupWeeks(weeks, sun(2026, 9, 25));
    expect(oct.done).toBe(22);
    expect(oct.goal).toBe(22.5);
    expect(oct.trophies).toBe(2);
    expect(oct.activeDays).toBe(11);
    expect(oct.signInDays).toBe(18);
    expect(oct.bestStreak).toBe(6);
    expect(oct.partial).toBe(true);
  });

  it("knows each month's year and month for the dropdowns", () => {
    const p = groupWeeks([wk(sun(2025, 11, 21), 5), wk(sun(2025, 11, 28), 5), wk(sun(2026, 0, 4), 5)], sun(2026, 9, 25));
    // Dec 28 2025 has its Wednesday on Dec 31, so it counts in December.
    expect(p.map((x) => [x.year, x.month, x.weeks.length])).toEqual([[2026, 0, 1], [2025, 11, 2]]);
  });

  it("the demo has about six months of weeks to group", () => {
    let s = initialState("alex");
    s = { ...s, onboarded: true, profile: personaProfile(s) };
    const ctx = buildAgentContext(s);
    expect(ctx.past.length).toBe(26);
    const months = groupWeeks(ctx.past.map((w) => ({ start: w.start, label: w.label, done: w.totals.done, goal: w.goal, active: w.totals.activeByDay, signIns: w.signIns })), weekStart(0));
    expect(months.length).toBeGreaterThanOrEqual(6);
    expect(months.reduce((a, m) => a + m.weeks.length, 0)).toBe(26);
  });
});
