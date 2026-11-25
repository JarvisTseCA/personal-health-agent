/**
 * The numbers that reach back past this week, against the shared examples: the streak, the
 * trophies, what each past week added up to, the goal offer, and the Summary page's averages.
 *
 * The app and the backend each have their own copy of these calculations: here it is
 * src/lib/rewards.ts, src/lib/goal.ts, src/services/context.ts and src/services/summary.ts,
 * in the backend backend/app/progress.py. Both are held to the same examples,
 * shared_examples/progress.json: this test works them out with the app's copies,
 * backend/tests/test_progress_shared.py with the backend's.
 *
 * If an example fails after a change to the calculation, the app no longer agrees with
 * the backend. Change the backend's copy the same way, then the answers in the examples.
 */
import { describe, expect, it } from "vitest";
import raw from "../../shared_examples/progress.json?raw";
import { buildAgentContext } from "../services/context";
import { buildSummary } from "../services/summary";
import { initialState } from "../state/store";
import type { FitbitBand, Session } from "./met";
import type { WeekPlan } from "./plan";
import { registerTable, tableId } from "./tableActivities";

interface Workout {
  day: number;
  met: number;
  minutes: number;
  band?: FitbitBand;
  confirmed?: boolean;
}

interface PastWeekExample {
  goal: number;
  opens: number[] | null;
  workouts: Workout[];
}

interface Expect {
  streak?: { current: number; best: number };
  trophy?: boolean;
  trophies?: number;
  week_done?: number;
  past_done?: number[];
  past_opens?: number[][];
  past_active?: number[][];
  offer?: { kind?: string; to?: number };
  summary?: {
    weeks?: number;
    avg_met_hours?: number;
    avg_brisk_min?: number;
    goal_weeks?: number;
    avg_active_days?: number;
    longest_gap?: number;
    intensity?: { light: number; moderate: number; vigorous: number };
  };
}

interface Example {
  name: string;
  weekly_goal: number;
  plan: WeekPlan;
  today: number;
  workouts: Workout[];
  opens: number[];
  past_weeks: PastWeekExample[];
  how: string;
  expect: Expect;
}

const { examples } = JSON.parse(raw) as { examples: Example[] };

/**
 * A week's workouts as the app holds them. The app looks a workout's MET up from its
 * activity, so each workout gets an activity of its own with the example's MET, registered
 * the way rows of the activity table are. `week` is 0 for this week, 1 for the oldest past week, and so on.
 */
function sessionsOf(workouts: Workout[], n: number, week: number): Session[] {
  return workouts.map((w, i) => {
    const code = `progress-${n}-${week}-${i}`;
    registerTable([{ code, heading: "Shared example", description: "Shared example", label: "Shared example", met: w.met, places: ["home"] }]);
    return {
      id: code, variantId: tableId(code), durationMin: w.minutes, dayIndex: w.day,
      source: w.band ? "fitbit" : "manual", confirmed: w.confirmed ?? true, band: w.band,
    };
  });
}

/** Seven flags, true on the day numbers listed. */
function flags(days: number[]): boolean[] {
  return Array.from({ length: 7 }, (_, d) => days.includes(d));
}

/** The day numbers where the flag is true. */
function daysOf(f: boolean[]): number[] {
  return f.flatMap((on, d) => (on ? [d] : []));
}

/** The numbers as the app gets them: from its state, through buildAgentContext and buildSummary. */
function worked(e: Example, n: number) {
  const state = {
    ...initialState(),
    goal: e.weekly_goal,
    plan: e.plan,
    todayIndex: e.today,
    sessions: sessionsOf(e.workouts, n, 0),
    signIns: flags(e.opens),
    history: e.past_weeks.map((w, i) => ({
      goal: w.goal,
      plan: e.plan,
      sessions: sessionsOf(w.workouts, n, i + 1),
      ...(w.opens ? { signIns: flags(w.opens) } : {}),
    })),
  };
  const ctx = buildAgentContext(state);
  return { ctx, sum: buildSummary(ctx) };
}

describe("progress: the examples shared with the backend", () => {
  it("has examples to check", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  examples.forEach((e, n) => {
    it(e.name, () => {
      const { ctx, sum } = worked(e, n);
      const x = e.expect;
      const says = (what: string, value: unknown) => `shared_examples/progress.json says ${what} ${JSON.stringify(value)}. ${e.how}`;

      if (x.streak) {
        expect(ctx.streak.current, says("the streak is", x.streak.current)).toBe(x.streak.current);
        expect(ctx.streak.best, says("the best streak is", x.streak.best)).toBe(x.streak.best);
      }
      if (x.trophy !== undefined) {
        expect(ctx.trophy, says("this week's trophy is", x.trophy)).toBe(x.trophy);
      }
      if (x.trophies !== undefined) {
        expect(ctx.trophies, says("the trophies are", x.trophies)).toBe(x.trophies);
      }
      if (x.week_done !== undefined) {
        expect(ctx.week.done, says("this week's MET-hours done are", x.week_done)).toBeCloseTo(x.week_done, 3);
      }
      if (x.past_done) {
        const done = ctx.past.map((w) => w.totals.done);
        expect(done.length, says("the past weeks done are", x.past_done)).toBe(x.past_done.length);
        x.past_done.forEach((v, i) => expect(done[i], says(`past week ${i} done is`, v)).toBeCloseTo(v, 3));
      }
      if (x.past_opens) {
        expect(ctx.past.map((w) => daysOf(w.signIns)), says("the past weeks' opened days are", x.past_opens)).toEqual(x.past_opens);
      }
      if (x.past_active) {
        expect(ctx.past.map((w) => daysOf(w.totals.activeByDay)), says("the past weeks' active days are", x.past_active)).toEqual(x.past_active);
      }
      if (x.offer) {
        if (x.offer.kind !== undefined) expect(ctx.offer.kind, says("the offer kind is", x.offer.kind)).toBe(x.offer.kind);
        if (x.offer.to !== undefined) expect(ctx.offer.to, says("the offer goal is", x.offer.to)).toBeCloseTo(x.offer.to, 3);
      }
      const s = x.summary;
      if (s) {
        if (s.weeks !== undefined) expect(sum.weeks, says("the summary weeks are", s.weeks)).toBe(s.weeks);
        if (s.avg_met_hours !== undefined) expect(sum.avgMetHours, says("avg_met_hours is", s.avg_met_hours)).toBeCloseTo(s.avg_met_hours, 3);
        if (s.avg_brisk_min !== undefined) expect(sum.avgBriskMin, says("avg_brisk_min is", s.avg_brisk_min)).toBe(s.avg_brisk_min);
        if (s.goal_weeks !== undefined) expect(sum.goalWeeks, says("goal_weeks is", s.goal_weeks)).toBe(s.goal_weeks);
        if (s.avg_active_days !== undefined) expect(sum.avgActiveDays, says("avg_active_days is", s.avg_active_days)).toBeCloseTo(s.avg_active_days, 3);
        if (s.longest_gap !== undefined) expect(sum.longestGap, says("longest_gap is", s.longest_gap)).toBe(s.longest_gap);
        if (s.intensity !== undefined) expect(sum.intensity, says("the intensity is", s.intensity)).toEqual(s.intensity);
      }
    });
  });
});
