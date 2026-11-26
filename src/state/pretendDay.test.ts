/** "Pretend today is …" in the demo controls: the week as it stood when that day began. */
import { describe, expect, it } from "vitest";
import { buildAgentContext, reachedToday } from "../services/context";
import { initialState, personaProfile, reducer } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

function alex(): AppState {
  const s = initialState("alex");
  return T.startDay({ ...s, onboarded: true, profile: personaProfile(s) });
}

describe("pretend today is another day", () => {
  it("Monday: Monday's workout hasn't happened yet, so Today isn't done", () => {
    const s = reducer(alex(), { type: "setToday", index: 0 });
    expect(s.sessions).toEqual([]);
    const ctx = buildAgentContext(s);
    expect(ctx.week.done).toBe(0);
    expect(reachedToday(ctx)).toBe(false);
  });

  it("back to Wednesday, Monday's and Tuesday's workouts are counted again", () => {
    const wed = alex();
    const s = reducer(reducer(wed, { type: "setToday", index: 0 }), { type: "setToday", index: 2 });
    expect(s.sessions.map((x) => x.dayIndex)).toEqual(wed.sessions.map((x) => x.dayIndex));
    expect(buildAgentContext(s).week.done).toBeCloseTo(buildAgentContext(wed).week.done);
  });

  it("a workout the user logged stays on its day, and isn't counted before that day", () => {
    let s = reducer(alex(), { type: "setToday", index: 1 });
    s = { ...s, sessions: [...s.sessions, { id: "m-1", variantId: "walking-stroller", durationMin: 20, dayIndex: 1, source: "manual", confirmed: true }] };
    expect(reducer(s, { type: "setToday", index: 3 }).sessions.some((x) => x.id === "m-1")).toBe(true);
    expect(reducer(s, { type: "setToday", index: 0 }).sessions.some((x) => x.id === "m-1")).toBe(false);
  });
});

describe("first log-in (demo controls)", () => {
  it("a new user's Today starts with the week's goal and plan, then the day's check-in", () => {
    let s = reducer(alex(), { type: "firstLogin" });
    expect(s.personaId).toBe("fresh");
    expect(s.history).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.weekSetup).toBe(true);
    expect(s.today.step).toBe("setup-goal");
    s = reducer(s, { type: "setupGoal", label: "Keep 7.5", to: 7.5 });
    expect(s.today.step).toBe("setup-plan");
    s = reducer(s, { type: "setupPlanDone", label: T.SETUP_PLAN_DONE });
    expect(s.weekSetup).toBeUndefined();
    expect(["time-confirm", "time"]).toContain(s.today.step);
  });
});

describe("No time", () => {
  function picked(minutes: number): AppState {
    let s = T.answerTime(alex(), `${minutes} min`, minutes);
    s = T.answerPlace(s, "Indoors, private", "indoors_private");
    return T.answerEnergy(s, "Normal", "normal");
  }

  it("shortens today's time by one step: 30 → 10, 10 → 5, 5 → 0, 0 stays 0", async () => {
    const { shorterMinutes } = await import("../lib/suggest");
    expect([45, 30, 20, 10, 5, 0].map(shorterMinutes)).toEqual([30, 10, 10, 5, 0, 0]);
    let s = T.chooseReason(picked(10), "no-time");
    expect(s.today.checkIn.minutes).toBe(5);
    expect(s.today.entries.some((e) => e.text === "Then let's go shorter: 5 min.")).toBe(true);
    s = T.chooseReason(s, "no-time");
    expect(s.today.checkIn.minutes).toBe(0);
    expect(s.today.entries.some((e) => e.text === "Then no workout today; here's something you can do at your desk.")).toBe(true);
    expect(T.chooseReason(s, "no-time").today.checkIn.minutes).toBe(0);
  });

  it("30 min goes to 10, not straight to the shortest", () => {
    expect(T.chooseReason(picked(30), "no-time").today.checkIn.minutes).toBe(10);
  });
});
