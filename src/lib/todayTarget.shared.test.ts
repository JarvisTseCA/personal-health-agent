/**
 * Today's target in MET-hours (the 2.1 in "0.0/2.1" on Today), against the shared examples.
 *
 * The app and the backend each have their own copy of this calculation: here it is
 * src/lib/met.ts and src/lib/plan.ts, in the backend backend/app/calculator.py. Both are
 * held to the same examples, shared_examples/today_target.json: this test works them out
 * with the app's copy, backend/tests/test_today_target_shared.py with the backend's.
 *
 * If an example fails after a change to the calculation, the app no longer agrees with
 * the backend. Change the backend's copy the same way, then the answers in the examples.
 */
import { describe, expect, it } from "vitest";
import raw from "../../shared_examples/today_target.json?raw";
import { buildAgentContext } from "../services/context";
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

interface Example {
  name: string;
  weekly_goal: number;
  plan: WeekPlan;
  today: number;
  workouts: Workout[];
  how: string;
  today_target: number;
}

const { examples } = JSON.parse(raw) as { examples: Example[] };

/**
 * The example's workouts as the app holds them. The app looks a workout's MET up from its
 * activity, so each workout gets an activity of its own with the example's MET, registered
 * the way rows of the activity table are.
 */
function sessionsOf(e: Example, n: number): Session[] {
  return e.workouts.map((w, i) => {
    const code = `shared-${n}-${i}`;
    registerTable([{ code, heading: "Shared example", description: "Shared example", label: "Shared example", met: w.met, places: ["home"] }]);
    return {
      id: code, variantId: tableId(code), durationMin: w.minutes, dayIndex: w.day,
      source: w.band ? "fitbit" : "manual", confirmed: w.confirmed ?? true, band: w.band,
    };
  });
}

/** Today's target as the Today page gets it: from the app's state, through buildAgentContext. */
function todayTarget(e: Example, n: number): number {
  const state = { ...initialState(), goal: e.weekly_goal, plan: e.plan, todayIndex: e.today, sessions: sessionsOf(e, n) };
  return buildAgentContext(state).todayTarget;
}

describe("today's target: the examples shared with the backend", () => {
  it("has examples to check", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  examples.forEach((e, n) => {
    it(e.name, () => {
      expect(todayTarget(e, n), `shared_examples/today_target.json says ${e.today_target}. ${e.how}`).toBeCloseTo(e.today_target, 3);
    });
  });
});
