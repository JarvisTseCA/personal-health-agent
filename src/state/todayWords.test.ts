/**
 * ChatGPT on the Today tab: what the app does with its answers. ChatGPT itself is never called
 * here; each test hands the app what the backend would return (src/services/todayWords.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, personaProfile } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

function onboarded(persona = "alex"): AppState {
  const s = initialState(persona);
  return T.startDay({ ...s, onboarded: true, profile: personaProfile(s) });
}

const texts = (s: AppState) => s.today.entries.map((e) => e.text);

describe("a typed answer ChatGPT has read", () => {
  it("one answer fills time, place and energy, with one user bubble and no questions it already answers", () => {
    let s = onboarded();
    const before = s.today.entries.length;
    s = T.applyTyped(s, "maybe 20 min at home, pretty tired", { intent: "answer", minutes: 20, place: "indoors_private", energy: "low" });
    expect(s.today.checkIn).toMatchObject({ minutes: 20, place: "indoors_private", energy: "low" });
    expect(s.today.step).toBe("suggested");
    const added = s.today.entries.slice(before);
    expect(added.filter((e) => e.role === "user").map((e) => e.text)).toEqual(["maybe 20 min at home, pretty tired"]);
    expect(texts(s)).not.toContain("Where will you be exercising?");
    expect(texts(s)).not.toContain("How do you feel?");
  });

  it("a part answer moves on to the next question still open", () => {
    let s = onboarded();
    s = T.applyTyped(s, "40 minutes outside", { minutes: 40, place: "outside" });
    expect(s.today.step).toBe("energy");
    expect(s.today.checkIn).toMatchObject({ minutes: 40, place: "outside" });
    expect(texts(s).at(-1)).toBe("How do you feel?");
  });

  it("'sure' keeps the planned time", () => {
    const s = T.applyTyped(onboarded(), "sure, that works", { keep_time: true });
    expect(s.today.step).toBe("place");
    expect(s.today.checkIn.minutes).toBe(T.plannedMinutes(onboarded()));
  });

  it("a day off at the time question", () => {
    const s = T.applyTyped(onboarded(), "not today, I'm sick", { day_off: true });
    expect(s.plan[s.todayIndex]).toBe("off");
    expect(s.today.step).toBe("wrap");
  });

  it("a reason typed under a pick works as the chip does", () => {
    let s = T.applyTyped(onboarded(), "30 min inside, normal", { minutes: 30, place: "indoors_with_others", energy: "normal" });
    const lead = s.today.current!.lead;
    s = T.applyTyped(s, "it's pouring outside", { reason: "weather" });
    expect(s.declines.at(-1)).toMatchObject({ familyId: lead.familyId, reason: "weather" });
    expect(s.today.constraint?.indoorOnly).toBe(true);
  });

  it("fields that don't answer the question on screen fall back to the app's own reading", () => {
    const s0 = onboarded();
    const s = T.applyTyped(s0, "45", { goal: 45 });
    expect(s.today.checkIn.minutes).toBe(45); // the app's own reading of "45" at the time question
  });

  it("goal and plan in the first-time setup", () => {
    let s = initialState("fresh");
    s = T.startDay({ ...s, onboarded: true, profile: personaProfile(s), weekSetup: true });
    s = T.applyTyped(s, "let's do 9", { goal: 9 });
    expect(s.goal).toBe(9);
    s = T.applyTyped(s, "Thursday off and 45 on Saturday", { plan: { 3: "off", 5: "45" } });
    expect(s.plan[3]).toBe("off");
    expect(s.plan[5]).toBe("45");
    s = T.applyTyped(s, "that's it", { done: true });
    expect(s.weekSetup).toBeUndefined();
  });
});

describe("a question typed on Today", () => {
  it("gets ChatGPT's reply and the step stays where it was", () => {
    const s0 = onboarded();
    const s = T.todayReply(s0, "Does yard work count?", "Yes, if it gets your heart rate up.");
    expect(s.today.step).toBe(s0.today.step);
    expect(texts(s).slice(-2)).toEqual(["Does yard work count?", "Yes, if it gets your heart rate up."]);
  });
});

describe("the 'Based on' line", () => {
  function picked(): AppState {
    const s = T.applyTyped(onboarded(), "30 min inside, normal", { minutes: 30, place: "indoors_with_others", energy: "normal" });
    // As if the backend's pick had come in (whyFacts waits for it).
    return { ...s, today: { ...s.today, current: { ...s.today.current!, source: "jev" } } };
  }

  it("is asked for with the code's facts only, and lands on the pick it was for", () => {
    const s = picked();
    const want = T.whyFacts(s)!;
    expect(want.facts).toEqual(expect.arrayContaining([...s.today.current!.lead.reasons, "Normal energy today"]));
    const key = T.whyKey(s)!;
    const after = T.setWhy(s, key, "Based on your normal energy today.");
    expect(after.today.current!.why).toBe("Based on your normal energy today.");
    expect(T.whyFacts(after)).toBeNull(); // asked once
  });

  it("shows 'Loading reasoning…' while it's written, and the loading goes when it comes or doesn't", () => {
    const s = picked();
    const key = T.whyKey(s)!;
    const waiting = T.whyPending(s, key);
    expect(waiting.today.current!.whyPending).toBe(true);
    const done = T.setWhy(waiting, key, "Based on your normal energy.");
    expect(done.today.current).toMatchObject({ why: "Based on your normal energy.", whyPending: false });
    const none = T.setWhy(waiting, key, null);
    expect(none.today.current!.why).toBeUndefined();
    expect(none.today.current!.whyPending).toBe(false);
  });

  it("is dropped if the user has moved on to another option", () => {
    const s = picked();
    const key = T.whyKey(s)!;
    const moved = T.anotherOption(s);
    expect(T.setWhy(moved, key, "Based on something.").today.current!.why).toBeUndefined();
  });

  it("isn't asked for the in-app pick while the backend's is on its way", () => {
    const s = T.applyTyped(onboarded(), "30 min inside, normal", { minutes: 30, place: "indoors_with_others", energy: "normal" });
    expect(s.today.current!.source).toBe("rules");
    expect(T.whyFacts(s)).toBeNull();
  });
});

describe("the recap at the week's first log-in", () => {
  function opening(todayIndex: number, signIns: boolean[]): AppState {
    const s = initialState("alex");
    return T.startDay({ ...s, onboarded: true, profile: personaProfile(s), todayIndex, signIns });
  }
  const none = [false, false, false, false, false, false, false];

  it("is due at the week's first log-in, and goes at the top of the conversation once", () => {
    const s = opening(0, none);
    expect(s.today.recap).toBe("due");
    const facts = T.recapFacts(s)!;
    expect(Object.keys(facts)).toEqual(expect.arrayContaining(["goal_met_hours", "done_met_hours", "active_days", "reached_goal"]));
    const after = T.addRecap(s, s.today.dayKey, "Last week you did a lot. Keep going.");
    expect(after.today.entries[0].text).toBe("Last week you did a lot. Keep going.");
    expect(after.today.recap).toBe("done");
    expect(T.addRecap(after, s.today.dayKey, "Again.").today.entries.length).toBe(after.today.entries.length);
  });

  it("comes on whichever day the week's first log-in is, since the user may skip days", () => {
    expect(opening(3, none).today.recap).toBe("due"); // Monday to Wednesday skipped
    expect(opening(1, [true, ...none.slice(1)]).today.recap).toBeUndefined(); // opened Monday already
  });

  it("stays at the top, asked for once, after the week's plan is set", () => {
    let s = T.addRecap(opening(0, none), "alex:0", "Last week, well done.");
    s = T.setupGoal(s, "Keep 10", 10);
    s = T.setupPlanDone(s, T.SETUP_PLAN_DONE);
    expect(s.today.entries[0].text).toBe("Last week, well done.");
    expect(s.today.recap).toBe("done");
  });
});

describe("the client for the backend's routes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives back null when the backend refuses, so the app keeps its own words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("refused", { status: 422 })));
    const { whyLine, readTyped } = await import("../services/todayWords");
    expect(await whyLine("Yoga", ["Likes yoga"])).toBeNull();
    expect(await readTyped("time", "How much time?", "20 min")).toBeNull();
  });
});
