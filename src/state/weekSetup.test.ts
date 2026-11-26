/** Today's first conversation sets the weekly goal and plan; the goal shows who set it, when and why. */
import { describe, expect, it } from "vitest";
import { appDate, goalNote, shortDate } from "../lib/goalNote";
import { initialState, personaProfile, reducer } from "./store";
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
  it("default, set by the user, and the agent's accepted offer with its reason", () => {
    let s = afterOnboarding(false);
    expect(goalNote(s)).toMatch(/^The guideline/);
    s = reducer(s, { type: "setGoal", to: 8.3 });
    expect(s.goal).toBe(8.5); // steps of 0.5
    expect(goalNote(s)).toMatch(/^Set by you on /);
    s = reducer(s, { type: "acceptGoal", to: 10, reason: "You reached at least 10 MET-hours in each of the last 2 weeks." });
    expect(goalNote(s)).toBe(`Suggested by the agent, accepted on ${shortDate(appDate(s.todayIndex))}. You reached at least 10 MET-hours in each of the last 2 weeks.`);
  });
});
