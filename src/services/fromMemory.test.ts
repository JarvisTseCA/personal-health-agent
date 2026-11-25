/**
 * fromMemory(): the app's state put back together from Memory and the numbers. The main check
 * is the round trip: a state laid out by toMemory(), read back by fromMemory(), lays out as the
 * same Memory again. The rest covers a new week, workouts the app has no record of, and how
 * equipment and accepted picks come back.
 */
import { describe, expect, it } from "vitest";
import { PERSONAS, type WeekRecord } from "../data/mockFitbit";
import { tableId } from "../lib/tableActivities";
import { initialState, personaProfile } from "../state/store";
import type { AppState } from "../state/types";
import { fromMemory } from "./fromMemory";
import type { Memory, MemoryWorkout, OtherOfApp } from "./memoryTypes";
import { numbersLike } from "./numbers.testkit";
import { toMemory } from "./toMemory";

const MONDAY = "2026-11-23";

function onboarded(id: string): AppState {
  const s = initialState(id);
  return { ...s, onboarded: true, profile: personaProfile(s) };
}

/** Memory and the numbers for a state, and the state read back from them. */
function through(s: AppState, edit: (m: Memory) => void = () => undefined, base: AppState = initialState()) {
  const m = toMemory(s, MONDAY);
  edit(m);
  const back = fromMemory(m, numbersLike(s, MONDAY), base)!;
  return { m, back };
}

/** Memory with its lists in a fixed order, so two layouts of the same state compare equal. */
function ordered(m: Memory): Memory {
  const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...m,
    goals: [...m.goals].sort((a, b) => a.week_start.localeCompare(b.week_start)),
    daily: { ...m.daily, workouts: byId(m.daily.workouts), suggestions: byId(m.daily.suggestions) },
    health: { ...m.health, heart_rates: [...m.health.heart_rates].sort((a, b) => a.workout_id.localeCompare(b.workout_id)) },
  };
}

const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).sort();
const blankWorkout = (patch: Partial<MemoryWorkout>): MemoryWorkout => (
  { id: "x1", date: "2026-11-24", activity_code: null, activity_name: "Gardening", met: 3, duration_min: 30, source: "manual", confirmed: true, band: null, start_time: null, ...patch }
);

describe("fromMemory: a new user", () => {
  it("gives null when Memory holds nothing under other.app", () => {
    const m = toMemory(onboarded("alex"), MONDAY);
    delete (m.other as OtherOfApp).app;
    expect(fromMemory(m, numbersLike(onboarded("alex"), MONDAY), initialState())).toBeNull();
  });
});

describe("fromMemory: the round trip", () => {
  for (const persona of PERSONAS) {
    it(`lays out the same Memory again for ${persona.id}, in the same week`, () => {
      const s = onboarded(persona.id);
      const { m, back } = through(s);
      expect(back.newWeek).toBe(false);
      expect(ordered(toMemory(back.state, MONDAY))).toEqual(ordered(m));
    });
  }

  it("brings back alex's own state", () => {
    const s = onboarded("alex");
    const { state } = through(s).back;
    expect(state.goal).toBe(s.goal);
    expect(state.plan).toEqual(s.plan);
    expect(state.todayIndex).toBe(s.todayIndex);
    expect(state.history).toHaveLength(s.history.length);
    state.history.forEach((w, i) => {
      expect(w.goal).toBe(s.history[i].goal);
      expect(w.plan).toEqual(s.history[i].plan);
      expect(w.signIns).toEqual(s.history[i].signIns);
      expect(ids(w.sessions)).toEqual(ids(s.history[i].sessions));
    });
    expect(ids(state.sessions)).toEqual(ids(s.sessions));
    expect(state.signIns).toEqual(s.signIns);
    expect(state.vo2).toEqual(s.vo2);
    expect(state.profile.name).toBe(s.profile.name);
    expect(state.profile.enjoyed).toEqual(s.profile.enjoyed);
    expect(state.profile.access).toEqual(s.profile.access);
    expect(state.profile.equipment).toEqual(s.profile.equipment);
    expect(state.declines.map((d) => [d.id, d.familyId, d.reason, d.day])).toEqual(s.declines.map((d) => [d.id, d.familyId, d.reason, d.day]));
  });

  it("leaves signIns off a history week with no opens in Memory", () => {
    const s = onboarded("alex");
    const history: WeekRecord[] = s.history.map((w, i) => (i === s.history.length - 1 ? { ...w, signIns: undefined } : w));
    const { state } = through({ ...s, history }).back;
    const last = state.history[state.history.length - 1];
    expect("signIns" in last).toBe(false);
    expect(state.history[0].signIns).toEqual(s.history[0].signIns);
  });
});

describe("fromMemory: a new week", () => {
  const s = onboarded("alex");
  const saved: AppState = { ...s, recapHandled: true, today: { ...s.today, step: "wrap" } };

  it("starts today fresh and asks the recap again when Memory was saved the Monday before", () => {
    const base = initialState();
    const { back } = through(saved, (m) => { (m.other as OtherOfApp).app!.week = "2026-11-16"; }, base);
    expect(back.newWeek).toBe(true);
    expect(back.state.today).toBe(base.today);
    expect(back.state.today.step).not.toBe("wrap");
    expect(back.state.recapHandled).toBe(false);
  });

  it("keeps the saved conversation and recap answer in the same week", () => {
    const { back } = through(saved);
    expect(back.state.today.step).toBe("wrap");
    expect(back.state.recapHandled).toBe(true);
  });
});

describe("fromMemory: workouts the app has no record for", () => {
  const unknown = (patch: Partial<MemoryWorkout>) => (m: Memory) => { m.daily.workouts.push(blankWorkout(patch)); };
  const sessionX = (edit: (m: Memory) => void) => through(onboarded("alex"), edit).back.state.sessions.find((x) => x.id === "x1")!;

  it("makes a table activity of one that has a code, with its name and MET", () => {
    const edit = unknown({ activity_code: "99999", activity_name: "Gardening, vigorous", met: 5.5 });
    const { state } = through(onboarded("alex"), edit).back;
    expect(sessionX(edit).variantId).toBe(tableId("99999"));
    expect(state.tableActivities?.["99999"]).toMatchObject({ code: "99999", label: "Gardening, vigorous", met: 5.5 });
  });

  it("counts one without a code as a moderate typed-in activity below 6 MET, under its name", () => {
    const x = sessionX(unknown({ met: 3.5 }));
    expect(x.variantId).toBe("other-fairly");
    expect(x.customName).toBe("Gardening");
  });

  it("counts one without a code as a vigorous typed-in activity from 6 MET", () => {
    const x = sessionX(unknown({ met: 6 }));
    expect(x.variantId).toBe("other-very");
    expect(x.customName).toBe("Gardening");
  });
});

describe("fromMemory: preferences and picks", () => {
  it("maps equipment names back to ids and keeps an unknown name as custom", () => {
    const { state } = through(onboarded("alex"), (m) => { m.preferences.equipment = { home: ["Yoga mat", "Foam roller"], gym: null }; }).back;
    expect(state.profile.equipment).toEqual({ home: ["yoga-mat", "custom:Foam roller"], gym: null });
  });

  it("rebuilds pickedCodes by place from the accepted suggestions, each code once", () => {
    const entry = (id: string, place: string, code: string) => (
      { id, date: "2026-11-25", place, activity_code: code, activity_name: code, outcome: "accepted" as const, reason: null, note: null }
    );
    const { state } = through(onboarded("alex"), (m) => {
      m.daily.suggestions.push(entry("a1", "outside", "01216"), entry("a2", "outside", "01216"), entry("a3", "outside", "17358"), entry("a4", "indoors_private", "01216"));
    }).back;
    expect(state.profile.pickedCodes).toEqual({ outside: ["01216", "17358"], indoors_private: ["01216"] });
  });
});
