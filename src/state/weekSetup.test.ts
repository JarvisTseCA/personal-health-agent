/** Today's first conversation sets the weekly goal and plan; the goal shows who set it, when and why. */
import { describe, expect, it } from "vitest";
import { appDate, goalNote, shortDate } from "../lib/goalNote";
import { initialState, personaProfile, reducer } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

const START = ["10", "10", "10", "10", "10", "10", "10"] as const;

function afterOnboarding(setUpWeek = true): AppState {
  const s = initialState("fresh");
  return reducer(s, { type: "completeOnboarding", profile: personaProfile(s), plan: [...START], setUpWeek });
}

describe("first time in Today: goal, then plan", () => {
  it("asks for the weekly goal before the daily check-in", () => {
    const s = afterOnboarding();
    expect(s.today.step).toBe("setup-goal");
    expect(s.today.entries[0].text).toMatch(/What weekly goal do you want\?/);
  });

  it("the goal is saved as the user's, with today's date, then asks for the plan", () => {
    const s = reducer(afterOnboarding(), { type: "setupGoal", label: "5 to start", to: 5 });
    expect(s.goal).toBe(5);
    expect(s.goalSet).toMatchObject({ by: "user", on: appDate(s.todayIndex) });
    expect(s.today.step).toBe("setup-plan");
    expect(goalNote(s)).toBe(`Set by you on ${shortDate(appDate(s.todayIndex))}.`);
  });

  it("a typed goal and typed plan changes work too", () => {
    let s = reducer(afterOnboarding(), { type: "freeText", text: "let's do 6" });
    expect(s.goal).toBe(6);
    s = reducer(s, { type: "freeText", text: "Thursday off, Saturday 45 min" });
    expect(s.plan[3]).toBe("off");
    expect(s.plan[5]).toBe("45");
    expect(s.today.step).toBe("setup-plan");
  });

  it("then today's usual check-in starts, once", () => {
    let s = reducer(afterOnboarding(), { type: "setupGoal", label: "7.5, the guideline", to: 7.5 });
    s = reducer(s, { type: "setSlot", day: 6, slot: "off" });
    s = reducer(s, { type: "setupPlanDone", label: "Looks good" });
    expect(s.weekSetup).toBeUndefined();
    expect(["time-confirm", "time"]).toContain(s.today.step);
    expect(s.today.entries.some((e) => /Your week is set: 7\.5 MET-hours over 6 days/.test(e.text))).toBe(true);
    expect(reducer(s, { type: "restartDay" }).today.step).not.toBe("setup-goal");
  });

  it("an all-off week can't finish setup", () => {
    let s = reducer(afterOnboarding(), { type: "setupGoal", label: "10", to: 10 });
    for (let d = 0; d < 7; d++) s = reducer(s, { type: "setSlot", day: d, slot: "off" });
    expect(reducer(s, { type: "setupPlanDone", label: "Looks good" }).today.step).toBe("setup-plan");
  });

  it("Skip onboarding (demo) goes straight to the day", () => {
    expect(afterOnboarding(false).today.step).not.toBe("setup-goal");
  });
});

describe("the note beside the goal", () => {
  it("demo: Alex's goal was raised to 10 by the agent on Monday, with the reason", () => {
    const s = initialState("alex");
    expect(s.goal).toBe(10);
    expect(goalNote(s)).toBe(`Raised by the agent from 7.5 on ${shortDate(appDate(0))}, and you accepted. Last week you did 11.4 MET-hours, well above your 7.5 goal.`);
    expect(initialState("roll").goal).toBe(7.5);
  });

  it("default, set by the user, and the agent's accepted offer with its reason", () => {
    let s = afterOnboarding(false);
    expect(goalNote(s)).toMatch(/^The guideline/); // Fresh start: the default
    s = reducer(s, { type: "setGoal", to: 8.3 });
    expect(s.goal).toBe(8.5); // steps of 0.5
    expect(goalNote(s)).toMatch(/^Set by you on /);
    s = reducer(s, { type: "acceptGoal", to: 10, reason: "You reached at least 10 MET-hours in each of the last 2 weeks." });
    expect(goalNote(s)).toBe(`Raised by the agent from 8.5 on ${shortDate(appDate(s.todayIndex))}, and you accepted. You reached at least 10 MET-hours in each of the last 2 weeks.`);
  });
});

describe("the week's first log-in: goal and plan once a week", () => {
  const none = [false, false, false, false, false, false, false];
  function open(todayIndex: number, signIns: boolean[], extra: Partial<AppState> = {}): AppState {
    const s = initialState("alex");
    return reducer({ ...s, onboarded: true, profile: personaProfile(s), todayIndex, signIns, ...extra }, { type: "restartDay" });
  }

  it("asks again at the week's first log-in, on any day, offering to keep the goal", () => {
    const s = open(2, none);
    expect(s.weekSetup).toBe(true);
    expect(s.today.step).toBe("setup-goal");
    expect(s.today.entries[0].text).toMatch(/^A new week\. .*Your weekly goal is 10 MET-hours: keep it, or pick another\?/);
    expect(T.setupGoalOptions(s)[0]).toEqual(["Keep 10", 10]);
  });

  it("keeping the goal leaves who set it as it was; then the plan, then the day", () => {
    let s = open(0, none);
    const before = s.goalSet;
    s = reducer(s, { type: "setupGoal", label: "Keep 10", to: 10 });
    expect(s.goalSet).toEqual(before);
    expect(s.today.entries.at(-1)!.text).toMatch(/^Here's your weekly plan\./);
    s = reducer(s, { type: "setupPlanDone", label: T.SETUP_PLAN_DONE });
    expect(s.weekPlanned).toBe(true);
    expect(["time-confirm", "time"]).toContain(s.today.step);
  });

  it("not on a later log-in that week, nor on a restart of the day once it's set", () => {
    expect(open(2, [true, ...none.slice(1)]).today.step).not.toBe("setup-goal");
    expect(open(0, none, { weekPlanned: true }).today.step).not.toBe("setup-goal");
  });
});
