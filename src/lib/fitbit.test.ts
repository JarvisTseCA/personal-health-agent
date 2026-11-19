import { describe, expect, it } from "vitest";
import { getVariant } from "./activities";
import { bandOf, clockTime, EXERCISE_VARIANTS, importFitbit, monthlyVo2, sessionOf, syncSince, type FitbitWorkout } from "./fitbit";
import { initialState, personaProfile } from "../state/store";
import * as T from "../state/today";
import type { AppState } from "../state/types";

// Wednesday, Nov 18, 2026 at noon: Monday of this week is Nov 16.
const NOW = new Date(2026, 10, 18, 12, 0);
// The same weekday one week later.
const NEXT_WEEK = new Date(2026, 10, 25, 12, 0);

function workout(n: number, start: string, type = "RUNNING", zones: Partial<FitbitWorkout["zone_min"]> = {}): FitbitWorkout {
  return {
    id: `users/111/dataTypes/exercise/dataPoints/${n}`, exercise_type: type, name: type === "TENNIS" ? "Tennis" : null,
    start, duration_min: 30, avg_heart_rate: 140, zone_min: { light: 0, moderate: 0, vigorous: 0, peak: 0, ...zones },
  };
}

function onboarded(): AppState {
  const s = initialState("alex");
  return T.startDay({ ...s, onboarded: true, profile: { ...personaProfile(s), fitbitLive: true } });
}

describe("Fitbit workouts", () => {
  it("maps every listed exercise type to a variant in the activity list", () => {
    const ids = Object.values(EXERCISE_VARIANTS).flatMap((v) => [v.fairly, v.very]);
    const missing = ids.filter((id) => { try { getVariant(id); return false; } catch { return true; } });
    expect(ids).toContain("running-6mph");
    expect(missing).toEqual([]);
  });

  it("a run mostly in the vigorous zone is a very active 6 mph run", () => {
    expect(sessionOf(workout(1, "2026-11-16T18:10:00", "RUNNING", { moderate: 10, vigorous: 20 }), 0, true)).toEqual({
      id: "users/111/dataTypes/exercise/dataPoints/1", variantId: "running-6mph", durationMin: 30, dayIndex: 0,
      source: "fitbit", confirmed: true, band: "very", startTime: "6:10 pm", avgHeartRate: 140,
    });
  });

  it("a type the app has no activity for keeps Fitbit's name and counts as other", () => {
    const s = sessionOf({ ...workout(2, "2026-11-16T07:05:00", "TENNIS"), avg_heart_rate: null }, 0, false);
    expect(s).toEqual({
      id: "users/111/dataTypes/exercise/dataPoints/2", variantId: "other-fairly", durationMin: 30, dayIndex: 0,
      source: "fitbit", confirmed: false, band: "fairly", startTime: "7:05 am", customName: "Tennis",
    });
  });

  it.each([
    ["no heart rate zones", "fairly", {}],
    ["mostly light and moderate", "fairly", { light: 12, moderate: 10, vigorous: 8 }],
    ["mostly vigorous and peak", "very", { moderate: 10, vigorous: 8, peak: 4 }],
  ])("%s is %s active", (_, band, zones) => {
    expect(bandOf(workout(1, "2026-11-16T18:10:00", "RUNNING", zones))).toBe(band);
  });

  it.each([
    ["2026-11-16T00:05:00", "12:05 am"],
    ["2026-11-16T12:30:00", "12:30 pm"],
    ["2026-11-16T18:10:00", "6:10 pm"],
  ])("%s reads as %s", (start, time) => {
    expect(clockTime(start)).toBe(time);
  });
});

describe("Fitbit import", () => {
  it("puts this week's workouts on their days and earlier ones in history from the first active week", () => {
    const imp = importFitbit({
      workouts: [
        workout(1, "2026-11-18T07:00:00"), // today, Wednesday
        workout(2, "2026-11-16T18:10:00", "WALKING"), // Monday
        workout(3, "2026-11-15T09:00:00", "BIKING"), // last Sunday
        workout(4, "2026-10-28T09:00:00", "YOGA"), // Wednesday 3 weeks ago
      ],
      vo2: [],
    }, NOW);
    expect(imp.todayIndex).toBe(2);
    expect(imp.thisWeek.map((s) => [s.variantId, s.dayIndex, s.confirmed])).toEqual([["walking-moderate", 0, true], ["running-jog", 2, false]]);
    expect(imp.history.map((w) => w.map((s) => [s.variantId, s.dayIndex]))).toEqual([[["yoga-hatha", 2]], [], [["cycling-easy", 6]]]);
  });

  it("no workouts gives no history and an empty week", () => {
    expect(importFitbit({ workouts: [], vo2: [] }, NOW)).toEqual({ todayIndex: 2, week: "2026-11-16", thisWeek: [], history: [], vo2: [] });
  });

  it.each([
    ["Wednesday noon", NOW, "2026-11-16"],
    ["just after Monday midnight", new Date(2026, 10, 16, 0, 5), "2026-11-16"],
    ["just before Sunday midnight", new Date(2026, 10, 22, 23, 55), "2026-11-16"],
    ["the next Monday", new Date(2026, 10, 23, 0, 5), "2026-11-23"],
  ])("%s is in the week of %s", (_, now, week) => {
    expect(importFitbit({ workouts: [], vo2: [] }, now).week).toBe(week);
  });

  it("asks for 26 weeks back from this Monday, which is earlier than 6 months of VO2 max", () => {
    expect(syncSince(NOW)).toBe("2026-05-18");
  });

  it("VO2 max is each month's latest reading, carried into months without one", () => {
    const readings = [
      { date: "2026-08-25", vo2_max: 41.2, method: "FITBIT_RUN" },
      { date: "2026-08-10", vo2_max: 40.4, method: "FITBIT_RUN" },
      { date: "2026-10-02", vo2_max: 42.6, method: "FITBIT_RUN" },
    ];
    expect(monthlyVo2(readings, NOW)).toEqual([41, 41, 43, 43]);
  });

  it("no VO2 max readings gives no series", () => {
    expect(monthlyVo2([], NOW)).toEqual([]);
  });
});

describe("Fitbit sync in the Today flow", () => {
  const LEAD_TYPE: Record<string, string> = { cycling: "BIKING", dancing: "DANCING", walking: "WALKING" };

  function accepted(): AppState {
    let s = onboarded();
    s = T.answerTime(s, "30 min", 30);
    s = T.answerPlace(s, "Home", "home");
    s = T.answerEnergy(s, "Normal", "normal");
    return T.accept(s, s.today.current!.lead);
  }

  it("today's workout that matches the plan is logged and credited", () => {
    const s0 = accepted();
    const lead = s0.today.accepted!;
    const s = T.syncFitbit(s0, importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", LEAD_TYPE[lead.familyId])], vo2: [] }, NOW));
    expect(s.sessions.find((x) => x.id.endsWith("/1"))).toMatchObject({ variantId: lead.variantId, confirmed: true, dayIndex: 2 });
    expect(s.today.entries.some((e) => e.text === "Fitbit synced: 30 min at 7:00 am, matching your plan, so I logged it.")).toBe(true);
  });

  it("today's workout that isn't the plan is asked about", () => {
    const s = T.syncFitbit(accepted(), importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] }, NOW));
    expect(s.today.step).toBe("confirm");
    expect(s.today.entries.at(-1)!.text).toBe("Looks like 30 min of Tennis at 7:00 am. Right?");
  });

  it("syncing again keeps the user's confirmation and adds nothing twice", () => {
    const imp = importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] }, NOW);
    let s = T.syncFitbit(onboarded(), imp);
    s = T.confirm(s, { familyId: "walking" });
    s = T.syncFitbit(s, imp);
    expect(s.sessions.filter((x) => x.source === "fitbit").map((x) => [x.variantId, x.confirmed])).toEqual([["walking-stroller", true]]);
  });

  it("replaces the simulated weeks and VO2 max but keeps workouts logged by hand", () => {
    const manual = { id: "m-1", variantId: "yoga-power", durationMin: 20, dayIndex: 1, source: "manual" as const, confirmed: true };
    const s0 = { ...onboarded(), sessions: [...onboarded().sessions, manual] };
    const s = T.syncFitbit(s0, importFitbit({ workouts: [], vo2: [{ date: "2026-11-02", vo2_max: 44.4, method: "FITBIT_RUN" }] }, NOW));
    expect(s.sessions).toEqual([{ ...manual, week: "2026-11-16" }]);
    expect(s.vo2).toEqual([44]);
    expect(s.history).toEqual([]);
    expect(s.today.entries.at(-1)!.text).toBe("Fitbit synced. Nothing new today yet.");
  });

  it("a workout the user said wasn't exercise stays removed after syncing again", () => {
    const imp = importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] }, NOW);
    let s = T.syncFitbit(onboarded(), imp);
    s = T.confirm(s, "not-exercise");
    s = T.syncFitbit(s, imp);
    expect(s.sessions.filter((x) => x.source === "fitbit")).toEqual([]);
    expect(s.today.entries.at(-1)!.text).toBe("Fitbit synced. Nothing new today yet.");
  });

  it("a removed workout stays out of history once its week is over", () => {
    const data = { workouts: [workout(1, "2026-11-16T07:00:00", "TENNIS")], vo2: [] };
    let s = T.syncFitbit(onboarded(), importFitbit(data, new Date(2026, 10, 16, 12, 0)));
    s = T.confirm(s, "not-exercise");
    s = T.syncFitbit(s, importFitbit(data, NEXT_WEEK));
    expect(s.history).toEqual([]);
  });

  it("a week later, last week's workout logged by hand moves into history", () => {
    const manual = { id: "m-1", variantId: "running-jog", durationMin: 40, dayIndex: 2, source: "manual" as const, confirmed: true };
    let s = T.syncFitbit(onboarded(), importFitbit({ workouts: [], vo2: [] }, NOW));
    s = T.syncFitbit({ ...s, sessions: [...s.sessions, manual] }, importFitbit({ workouts: [], vo2: [] }, NEXT_WEEK));
    expect(s.sessions).toEqual([]);
    expect(s.history.map((w) => w.sessions)).toEqual([[{ ...manual, week: "2026-11-16" }]]);
  });

  it("a week later, the day starts over even though it's the same weekday", () => {
    const imp = importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] }, NOW);
    const s0 = T.syncFitbit(onboarded(), imp);
    const s = T.syncFitbit(s0, importFitbit({ workouts: [], vo2: [] }, NEXT_WEEK));
    expect(s0.today.step).toBe("confirm");
    expect(s.today.pendingSessionId).toBeUndefined();
    expect(s.today.step).not.toBe("confirm");
    expect(s.signIns).toEqual([false, false, true, false, false, false, false]);
  });

  it("the user's correction to a workout survives once its week becomes history", () => {
    const data = { workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] };
    let s = T.syncFitbit(onboarded(), importFitbit(data, NOW));
    s = T.confirm(s, { familyId: "walking" });
    s = T.syncFitbit(s, importFitbit(data, NEXT_WEEK));
    expect(s.history.map((w) => w.sessions.map((x) => [x.variantId, x.confirmed]))).toEqual([[["walking-stroller", true]]]);
  });

  it("before onboarding is done it imports quietly and confirms everything", () => {
    const s0 = initialState("alex");
    const s = T.syncFitbit(s0, importFitbit({ workouts: [workout(1, "2026-11-18T07:00:00", "TENNIS")], vo2: [] }, NOW));
    expect(s.today.entries).toEqual(s0.today.entries);
    expect(s.sessions.map((x) => x.confirmed)).toEqual([true]);
  });
});
