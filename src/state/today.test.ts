import { describe, expect, it } from "vitest";
import { buildAgentContext } from "../services/context";
import { initialState, personaProfile } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

function onboarded(persona = "alex"): AppState {
  let s = initialState(persona);
  s = { ...s, onboarded: true, profile: personaProfile(s) };
  return T.startDay(s);
}

function checkIn(s: AppState, minutes = 30): AppState {
  s = T.answerTime(s, `${minutes} min`, minutes);
  if (minutes === 0) return s;
  s = T.answerPlace(s, "Home", "home");
  s = T.answerEnergy(s, "Normal", "normal");
  return T.answerMood(s, "Surprise me", "surprise");
}

describe("today flow", () => {
  it("check-in leads to one pick from the enjoyed list", () => {
    const s = checkIn(onboarded());
    expect(s.today.step).toBe("suggested");
    expect(["cycling", "dancing", "walking"]).toContain(s.today.current!.lead.familyId);
  });

  it("0 minutes skips straight to desk moves", () => {
    const s = checkIn(onboarded(), 0);
    expect(s.today.current!.desk).toBe(true);
  });

  it("accept → sync logs the planned workout and awards a medal", () => {
    let s = checkIn(onboarded());
    s = T.accept(s, s.today.current!.lead);
    s = T.sync(s);
    const ctx = buildAgentContext(s);
    expect(ctx.week.activeByDay[s.todayIndex]).toBe(true);
    expect(ctx.medals[s.todayIndex]).not.toBe("none");
    expect(s.today.entries.some((e) => e.role === "medal")).toBe(true);
  });

  it("an unplanned sync asks to confirm, and counts conservatively until then", () => {
    let s = checkIn(onboarded());
    s = T.sync(s);
    expect(s.today.step).toBe("confirm");
    const pending = s.sessions.find((x) => x.id === s.today.pendingSessionId)!;
    expect(pending.confirmed).toBe(false);
    s = T.confirm(s, "not-exercise");
    expect(s.sessions.some((x) => x.id === pending.id)).toBe(false);
  });

  it("'not in the mood' rules the activity out today and is remembered", () => {
    let s = checkIn(onboarded());
    const first = s.today.current!.lead.familyId;
    s = T.decline(s);
    s = T.chooseReason(s, "not-mood");
    expect(s.today.current!.lead.familyId).not.toBe(first);
    expect(s.declines.at(-1)).toMatchObject({ familyId: first, reason: "not-mood" });
  });

  it("'can't access it' marks the activity unavailable", () => {
    let s = checkIn(onboarded());
    const first = s.today.current!.lead.familyId;
    s = T.chooseReason(T.decline(s), "no-access");
    expect(s.profile.access[first]).toBe("no");
  });

  it("'something hurts' sets the health flag and offers only gentle options", () => {
    let s = checkIn(onboarded());
    s = T.chooseReason(T.decline(s), "hurts");
    expect(s.profile.hasHealthCondition).toBe(true);
    expect(s.painReports).toBe(1);
    expect(s.today.current!.lead.met).toBeLessThan(3);
  });

  it("nudges to keep going when a workout gets partway to the target", () => {
    let s = checkIn(onboarded("tough"), 20);
    s = T.accept(s, s.today.current!.lead);
    s = T.sync(s);
    const ctx = buildAgentContext(s);
    if (ctx.todayDone < ctx.todayTarget && ctx.todayDone >= ctx.todayTarget / 2) {
      expect(s.today.step).toBe("nudge");
      s = T.keepGoing(s, true);
      expect(buildAgentContext(s).todayDone + 1e-9).toBeGreaterThanOrEqual(ctx.todayTarget);
    } else {
      expect(s.today.step).toBe("wrap");
    }
  });

  it("accepts typed answers at every check-in step", () => {
    let s = onboarded();
    s = T.freeText(s, "about 25 minutes");
    expect(s.today.checkIn.minutes).toBe(25);
    s = T.freeText(s, "at the gym");
    expect(s.today.checkIn.place).toBe("other");
    s = T.freeText(s, "kind of tired");
    expect(s.today.checkIn.energy).toBe("low");
    s = T.freeText(s, "pickleball");
    expect(s.today.step).toBe("suggested");
    expect(s.notes.at(-1)?.text).toContain("pickleball");
  });

  it("a typed mood that names a known activity adds it to the list", () => {
    let s = onboarded();
    s = T.freeText(T.freeText(T.freeText(s, "30"), "home"), "ok");
    s = T.freeText(s, "swimming");
    expect(s.profile.enjoyed).toContain("swimming");
  });

  it("a typed decline reason that mentions pain takes the safety path", () => {
    let s = checkIn(onboarded());
    s = T.decline(s);
    s = T.freeText(s, "my back is killing me");
    expect(s.profile.hasHealthCondition).toBe(true);
    expect(s.declines.at(-1)).toMatchObject({ reason: "hurts", note: "my back is killing me" });
  });

  it("a typed question on the suggestion card gets an answer and keeps the card", () => {
    let s = checkIn(onboarded());
    s = T.freeText(s, "what's a MET?");
    expect(s.today.step).toBe("suggested");
    expect(s.today.entries.at(-1)?.text).toMatch(/MET measures/);
  });

  it("a typed activity that isn't in the list is kept by name and counted conservatively", () => {
    let s = checkIn(onboarded());
    s = T.sync(s);
    const pending = s.today.pendingSessionId!;
    s = T.freeText(s, "pickleball");
    const sess = s.sessions.find((x) => x.id === pending)!;
    expect(sess.customName).toBe("Pickleball");
    expect(sess.confirmed).toBe(true);
    expect(["other-fairly", "other-very"]).toContain(sess.variantId);
  });
});
