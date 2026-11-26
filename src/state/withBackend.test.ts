/**
 * The app with the backend, on the Today side: the request for a suggestion from Memory (it
 * carries the check-in and the date, nothing else), replaying a step with the ids it first
 * made, and the card that says no pick came back and offers to try again.
 */
import { describe, expect, it } from "vitest";
import { ACTIVITIES } from "../lib/activities";
import type { Place } from "../lib/suggest";
import { buildMemoryRequest } from "../services/backend";
import { initialState, personaProfile } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

const DATE = "2026-11-25";

function onboarded(): AppState {
  let s = initialState("alex");
  s = { ...s, onboarded: true, profile: personaProfile(s), suggestSource: "table" };
  return T.startDay(s);
}

const LABEL: Record<Place, string> = { indoors_private: "Indoors, private", indoors_with_others: "Indoors, with others", outside: "Outside" };

/** Today driven to the "suggested" step, the card waiting for the backend's pick. */
function waiting(): AppState {
  let s = onboarded();
  s = T.answerTime(s, "30 min", 30);
  s = T.answerPlace(s, LABEL.indoors_with_others, "indoors_with_others");
  return T.answerEnergy(s, "Normal", "normal");
}

describe("the request for a suggestion from Memory", () => {
  it("has exactly the user, the date, the check-in and whether they want more", () => {
    expect(Object.keys(buildMemoryRequest(onboarded(), DATE)).sort()).toEqual(["check_in", "date", "user_id", "want_more"]);
    expect(buildMemoryRequest(onboarded(), DATE).date).toBe(DATE);
  });

  it("carries today's check-in as the user gave it", () => {
    const s = waiting();
    const mood = ACTIVITIES[0].id;
    const state: AppState = { ...s, today: { ...s.today, checkIn: { ...s.today.checkIn, minutes: 20, place: "outside", energy: "low", mood } } };
    expect(buildMemoryRequest(state, DATE).check_in).toEqual({ minutes: 20, place: "outside", energy: "low", mood, mood_name: ACTIVITIES[0].name });
  });

  it("fills what the check-in has not answered with the defaults, and a surprise has no mood name", () => {
    const s = onboarded();
    expect(s.today.checkIn).toEqual({});
    expect(buildMemoryRequest(s, DATE).check_in).toEqual({ minutes: 30, place: "indoors_private", energy: "normal", mood: "surprise", mood_name: null });
  });

  it("carries none of the app's own numbers or the user's data", () => {
    const req = buildMemoryRequest(waiting(), DATE);
    const keys = [...Object.keys(req), ...Object.keys(req.check_in)];
    for (const k of ["weekly_goal_met_hours", "needed_met_hours", "target_met_hours", "recent", "declines", "liked_categories", "enjoyed", "access", "profile", "sessions", "goal"]) {
      expect(keys).not.toContain(k);
    }
    expect(Object.keys(req.check_in).sort()).toEqual(["energy", "minutes", "mood", "mood_name", "place"]);
  });

  it("asks for more when the user did", () => {
    const s = onboarded();
    expect(buildMemoryRequest(s, DATE).want_more).toBe(false);
    expect(buildMemoryRequest({ ...s, today: { ...s.today, boost: true } }, DATE).want_more).toBe(true);
  });
});

describe("replaying a step with its ids", () => {
  it("makes the same ids each time from one mark", () => {
    const make = () => [T.newId("a"), T.newId("u"), T.newId("a")];
    const mark = T.idsMark();
    const first = T.withIds(mark, make);
    const second = T.withIds(mark, make);
    expect(second).toEqual(first);
  });

  it("goes back to new ids after the replay", () => {
    const mark = T.idsMark();
    T.withIds(mark, () => T.newId("a"));
    const a = T.newId("a");
    const b = T.newId("a");
    expect(a).not.toBe(b);
  });

  it("goes back to new ids after a replay that throws", () => {
    const mark = T.idsMark();
    expect(() => T.withIds(mark, () => { throw new Error("step failed"); })).toThrow("step failed");
    expect(T.newId("a")).not.toBe(T.newId("a"));
  });
});

describe("a pick that did not come back", () => {
  it("waits for the backend's pick first", () => {
    const c = waiting().today.current!;
    expect(c.pending).toBe(true);
    expect(c.failed).toBeUndefined();
  });

  it("marks the card failed, keeping its lead", () => {
    const s = waiting();
    const lead = s.today.current!.lead;
    const after = T.suggestionFailed(s, lead);
    expect(after.today.current!.pending).toBe(false);
    expect(after.today.current!.failed).toBe(true);
    expect(after.today.current!.lead).toBe(lead);
  });

  it("changes nothing for an answer about a pick the user has moved on from", () => {
    const s = waiting();
    const other = { ...s.today.current!.lead };
    expect(T.suggestionFailed(s, other)).toBe(s);
  });

  it("changes nothing when the card is no longer waiting", () => {
    const w = waiting();
    const s = T.suggestionFailed(w, w.today.current!.lead);
    expect(T.suggestionFailed(s, s.today.current!.lead)).toBe(s);
  });

  it("tries again with a new copy of the same placeholder", () => {
    const s = waiting();
    const lead = s.today.current!.lead;
    const failed = T.suggestionFailed(s, lead);
    const retry = T.retrySuggestion(failed);
    const c = retry.today.current!;
    expect(c.pending).toBe(true);
    expect(c.failed).toBe(false);
    expect(c.lead).not.toBe(lead);
    expect(c.lead).toEqual(lead);
  });

  it("does not try again on a card that has not failed", () => {
    const s = waiting();
    expect(T.retrySuggestion(s)).toBe(s);
  });

  it("answers a second failure after a retry, because the retry has a new lead", () => {
    const s = waiting();
    const failed = T.suggestionFailed(s, s.today.current!.lead);
    const retry = T.retrySuggestion(failed);
    // A late answer for the first try changes nothing.
    expect(T.suggestionFailed(retry, s.today.current!.lead)).toBe(retry);
    expect(T.suggestionFailed(retry, retry.today.current!.lead).today.current!.failed).toBe(true);
  });

  it("shows the ranker's pick, not a failed card, on the path without the backend", () => {
    const s = waiting();
    const after = T.backendFailed(s, s.today.current!.lead);
    expect(after.today.current!.pending).toBe(false);
    expect(after.today.current!.failed).toBeUndefined();
  });
});
