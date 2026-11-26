/**
 * toMemory(): the app's state laid out as Memory's seven groups, and memoryChanges(): what to
 * tell the backend between two such layouts. Both are pure, so the tests build states from the
 * demo personas, change one thing, and look at what comes out. This week's Sunday is fixed.
 */
import { describe, expect, it } from "vitest";
import type { WeekRecord } from "../data/mockFitbit";
import { getVariant } from "../lib/activities";
import type { Session } from "../lib/met";
import { registerTable, tableId, type TableActivity } from "../lib/tableActivities";
import { initialState, personaProfile } from "../state/store";
import type { AppState, DeclineRecord } from "../state/types";
import type { Memory, OtherOfApp } from "./memoryTypes";
import { memoryChanges, toMemory, todayOf } from "./toMemory";

const SUNDAY = "2026-11-22";

const ROW: TableActivity = { code: "01216", heading: "Bicycling", description: "Bicycling, stationary, 60 watts", label: "Bicycling, stationary, 60 watts", met: 5, places: ["gym"] };

function onboarded(id = "alex"): AppState {
  const s = initialState(id);
  return { ...s, onboarded: true, profile: personaProfile(s) };
}

const session = (id: string, variantId: string, dayIndex: number, extra: Partial<Session> = {}): Session => (
  { id, variantId, durationMin: 30, dayIndex, source: "manual", confirmed: true, ...extra }
);

const decline = (id: string, day: number, extra: Partial<DeclineRecord> = {}): DeclineRecord => (
  { id, familyId: "walking", reason: "tired", day, ...extra }
);

const withProfile = (s: AppState, patch: Partial<AppState["profile"]>): AppState => ({ ...s, profile: { ...s.profile, ...patch } });

/** What memoryChanges says between two states. */
const changes = (a: AppState, b: AppState) => memoryChanges(toMemory(a, SUNDAY), toMemory(b, SUNDAY), SUNDAY);

const appOf = (m: Memory) => (m.other as OtherOfApp).app!;

describe("toMemory: dates", () => {
  it("puts this week's sessions on the Sunday plus the day index", () => {
    const s = { ...onboarded(), sessions: [session("a", "walking-brisk", 0), session("b", "walking-brisk", 4)] };
    const dates = toMemory(s, SUNDAY).daily.workouts.filter((w) => ["a", "b"].includes(w.id)).map((w) => w.date);
    expect(dates).toEqual(["2026-11-22", "2026-11-26"]);
  });

  it("starts the last history week 7 days before Sunday and the first one 7 days per week before", () => {
    const s = onboarded();
    const n = s.history.length;
    const goals = toMemory(s, SUNDAY).goals;
    expect(goals[n - 1].week_start).toBe("2026-11-15");
    expect(goals[0].week_start).toBe(new Date(Date.UTC(2026, 10, 22) - 7 * n * 86_400_000).toISOString().slice(0, 10));
  });

  it("dates a history session from its own week's Sunday", () => {
    const s = onboarded();
    const history: WeekRecord[] = [...s.history.slice(0, -1), { ...s.history[s.history.length - 1], sessions: [session("last", "walking-brisk", 3)] }];
    const w = toMemory({ ...s, history }, SUNDAY).daily.workouts.find((x) => x.id === "last");
    expect(w?.date).toBe("2026-11-18");
  });

  it("has one goal row per history week plus this week's, which carries goal, source and plan", () => {
    const s = { ...onboarded(), goal: 9, goalSource: "recap" as const };
    const goals = toMemory(s, SUNDAY).goals;
    expect(goals).toHaveLength(s.history.length + 1);
    expect(goals[goals.length - 1]).toEqual({ week_start: SUNDAY, goal_met_hours: 9, goal_set_by: "recap", plan: s.plan });
  });

  it("gives today as Sunday plus todayIndex", () => {
    expect(todayOf({ todayIndex: 2 }, SUNDAY)).toBe("2026-11-24");
  });
});

describe("toMemory: workouts", () => {
  it("names a library workout by its family and takes the variant's MET, with no activity code", () => {
    const s = { ...onboarded(), sessions: [session("w", "walking-stroller", 1)] };
    const w = toMemory(s, SUNDAY).daily.workouts.find((x) => x.id === "w")!;
    expect(w.activity_code).toBeNull();
    expect(w.activity_name).toBe("Walking");
    expect(w.met).toBe(getVariant("walking-stroller").variant.met);
  });

  it("gives a table workout its code", () => {
    registerTable([ROW]);
    const s = { ...onboarded(), sessions: [session("t", tableId(ROW.code), 1)] };
    const w = toMemory(s, SUNDAY).daily.workouts.find((x) => x.id === "t")!;
    expect(w.activity_code).toBe("01216");
    expect(w.met).toBe(5);
  });

  it("keeps the app's own record only for library workouts and typed-in names", () => {
    registerTable([ROW]);
    const s = {
      ...onboarded(),
      sessions: [session("lib", "walking-brisk", 0), session("tab", tableId(ROW.code), 1), session("named", tableId(ROW.code), 2, { customName: "Garden" })],
    };
    const own = appOf(toMemory(s, SUNDAY)).workouts;
    expect(own.lib).toEqual({ variantId: "walking-brisk" });
    expect(own.tab).toBeUndefined();
    expect(own.named).toEqual({ variantId: tableId(ROW.code), customName: "Garden" });
  });
});

describe("toMemory: days the app was opened", () => {
  it("lists a date for every true in history and this week, sorted and without duplicates", () => {
    const s = onboarded();
    const history: WeekRecord[] = [{ ...s.history[s.history.length - 1], signIns: [true, false, true, false, false, false, true] }];
    const opens = toMemory({ ...s, history, signIns: [false, true, false, false, false, false, false] }, SUNDAY).daily.app_opens;
    expect(opens).toEqual(["2026-11-15", "2026-11-17", "2026-11-21", "2026-11-23"]);
  });

  it("counts nothing from a history week without signIns", () => {
    const s = onboarded();
    const history: WeekRecord[] = [{ ...s.history[0], signIns: undefined }];
    const opens = toMemory({ ...s, history, signIns: [true, false, false, false, false, false, false] }, SUNDAY).daily.app_opens;
    expect(opens).toEqual([SUNDAY]);
  });
});

describe("toMemory: declines and picks", () => {
  it("turns a decline into a declined suggestion dated Sunday plus its day, even when the day is negative", () => {
    const s = { ...onboarded(), declines: [decline("d1", -2, { note: "knee", place: "outside" }), decline("d2", 1, { reason: "weather" })] };
    const list = toMemory(s, SUNDAY).daily.suggestions.filter((x) => x.outcome === "declined");
    expect(list).toEqual([
      { id: "d1", date: "2026-11-20", place: "outside", activity_code: null, activity_name: "Walking", outcome: "declined", reason: "tired", note: "knee" },
      { id: "d2", date: "2026-11-23", place: null, activity_code: null, activity_name: "Walking", outcome: "declined", reason: "weather", note: null },
    ]);
  });

  it("turns each picked code into an accepted entry by place, with id picked-<place>-<code>", () => {
    registerTable([ROW]);
    const s = withProfile(onboarded(), { pickedCodes: { outside: ["01216"], indoors_private: ["01216", "17358"] } });
    const accepted = toMemory(s, SUNDAY).daily.suggestions.filter((x) => x.outcome === "accepted");
    expect(accepted.map((a) => a.id).sort()).toEqual(["picked-indoors_private-01216", "picked-indoors_private-17358", "picked-outside-01216"]);
    expect(accepted.find((a) => a.id === "picked-outside-01216")).toMatchObject({ place: "outside", activity_code: "01216", date: "2026-11-25" });
  });
});

describe("toMemory: check-in", () => {
  it("has one entry dated today once minutes, place, energy and mood are all set", () => {
    const s = onboarded();
    const full = { ...s, today: { ...s.today, checkIn: { minutes: 20, place: "outside" as const, energy: "normal" as const, mood: "fine" } } };
    expect(toMemory(full, SUNDAY).daily.check_ins).toEqual([{ date: "2026-11-25", minutes: 20, place: "outside", energy: "normal", mood: "fine" }]);
  });

  it("has none while one of the four is missing", () => {
    const s = onboarded();
    const part = { ...s, today: { ...s.today, checkIn: { minutes: 20, place: "outside" as const, energy: "normal" as const } } };
    expect(toMemory(part, SUNDAY).daily.check_ins).toEqual([]);
  });
});

describe("toMemory: preferences and health", () => {
  it("lists equipment by name", () => {
    const s = withProfile(onboarded(), { equipment: { home: ["yoga-mat", "custom:Foam roller"], gym: ["dumbbells"] } });
    expect(toMemory(s, SUNDAY).preferences.equipment).toEqual({ home: ["Yoga mat", "Foam roller"], gym: ["Dumbbells"] });
  });

  it("gives null for each place when equipment is missing, and keeps a null gym as null", () => {
    expect(toMemory(withProfile(onboarded(), { equipment: undefined }), SUNDAY).preferences.equipment).toEqual({ home: null, gym: null });
    expect(toMemory(withProfile(onboarded(), { equipment: { home: ["yoga-mat"], gym: null } }), SUNDAY).preferences.equipment).toEqual({ home: ["Yoga mat"], gym: null });
  });

  it("puts VO2 readings in the months ending this month", () => {
    const m = toMemory({ ...onboarded(), vo2: [38, 39, 41] }, SUNDAY);
    expect(m.health.vo2_max.map((r) => [r.month, r.ml_kg_min])).toEqual([["2026-09", 38], ["2026-10", 39], ["2026-11", 41]]);
  });

  it("lists a heart rate only for sessions that have one", () => {
    const s = { ...onboarded(), sessions: [session("hr", "walking-brisk", 0, { avgHeartRate: 120 }), session("nohr", "walking-brisk", 1)] };
    expect(toMemory(s, SUNDAY).health.heart_rates).toContainEqual({ workout_id: "hr", avg_bpm: 120 });
    expect(toMemory(s, SUNDAY).health.heart_rates.some((r) => r.workout_id === "nohr")).toBe(false);
  });
});

describe("toMemory: chat", () => {
  const at = Date.UTC(2026, 10, 25, 14, 3, 20);

  it("lays the conversation out one entry a message, in the order it was said", () => {
    const s: AppState = {
      ...onboarded(),
      chat: [
        { id: "u1", role: "user", text: "Is walking enough?", at },
        { id: "a1", role: "agent", text: "Brisk walking counts.", reply: "model" },
      ],
    };
    expect(toMemory(s, SUNDAY).chat).toEqual([
      { id: "u1", role: "user", text: "Is walking enough?", at: "2026-11-25T14:03:20.000Z", reply: null, app: null },
      { id: "a1", role: "agent", text: "Brisk walking counts.", at: null, reply: "model", app: null },
    ]);
  });

  it("keeps the quick replies under a message, and the answer it waits for, in the app's own part of the entry", () => {
    const s: AppState = {
      ...onboarded(),
      chat: [{ id: "a1", role: "agent", text: "Want me to add it?", suggestions: ["Add strength training"], kind: "offer-strength" }],
    };
    expect(toMemory(s, SUNDAY).chat[0].app).toEqual({ suggestions: ["Add strength training"], kind: "offer-strength" });
  });
});

describe("toMemory: other", () => {
  it("has exactly today, notes, clinician and app: the Chat conversation has a group of its own", () => {
    const s: AppState = { ...onboarded(), chat: [{ id: "u1", role: "user", text: "hi" }] };
    expect(Object.keys(toMemory(s, SUNDAY).other).sort()).toEqual(["app", "clinician", "notes", "today"]);
  });

  it("records the week as Sunday in the app's own part", () => {
    expect(appOf(toMemory(onboarded(), SUNDAY)).week).toBe(SUNDAY);
  });
});

describe("memoryChanges", () => {
  const s = onboarded();

  it("sends nothing for the same state twice", () => {
    expect(changes(s, s)).toEqual({ save: null, remove: [] });
  });

  it("saves only the new workout when a session is added this week", () => {
    const next = { ...s, sessions: [...s.sessions, session("new", "walking-brisk", 2)] };
    const { save, remove } = changes(s, next);
    expect(save?.daily?.workouts?.map((w) => w.id)).toEqual(["new"]);
    expect(remove).toEqual([]);
  });

  it("removes a session of this week that is gone", () => {
    const next = { ...s, sessions: s.sessions.slice(1) };
    expect(changes(s, next).remove).toEqual([{ kind: "workouts", key: s.sessions[0].id }]);
  });

  it("leaves a session taken out of a past week in Memory", () => {
    const last = s.history[s.history.length - 1];
    const history = [...s.history.slice(0, -1), { ...last, sessions: last.sessions.slice(1) }];
    expect(changes(s, { ...s, history }).remove).toEqual([]);
  });

  it("saves only this week's goal row when the goal or the plan changes", () => {
    const goalRow = changes(s, { ...s, goal: s.goal + 1 }).save?.goals;
    expect(goalRow).toHaveLength(1);
    expect(goalRow?.[0].week_start).toBe(SUNDAY);
    const plan = [...s.plan];
    plan[0] = plan[0] === "off" ? "30" : "off";
    expect(changes(s, { ...s, plan: plan as AppState["plan"] }).save?.goals?.map((g) => g.week_start)).toEqual([SUNDAY]);
  });

  it("does not send a past week's goal that changed", () => {
    const history = s.history.map((w, i) => (i === 0 ? { ...w, goal: w.goal + 2 } : w));
    expect(changes(s, { ...s, history }).save?.goals).toBeUndefined();
  });

  it("saves a decline that was added and removes one that is gone", () => {
    const added = { ...s, declines: [...s.declines, decline("d-new", 1)] };
    expect(changes(s, added).save?.daily?.suggestions?.map((x) => x.id)).toEqual(["d-new"]);
    const dropped = { ...s, declines: [] };
    expect(changes(s, dropped).remove).toEqual([{ kind: "suggestions", key: s.declines[0].id }]);
  });

  it("saves a newly picked code's accepted entry", () => {
    const next = withProfile(s, { pickedCodes: { outside: ["01216"] } });
    expect(changes(s, next).save?.daily?.suggestions).toEqual([expect.objectContaining({ id: "picked-outside-01216", outcome: "accepted" })]);
  });

  it("does not send an accepted pick again when only the day changed", () => {
    const a = withProfile(s, { pickedCodes: { outside: ["01216"] } });
    const b = { ...a, todayIndex: 4 };
    expect(changes(a, b).save?.daily?.suggestions).toBeUndefined();
  });

  it("saves just the new date when signIns gains a day", () => {
    const a = { ...s, signIns: [true, false, false, false, false, false, false] };
    const b = { ...s, signIns: [true, false, true, false, false, false, false] };
    expect(changes(a, b).save?.daily).toEqual({ app_opens: ["2026-11-24"] });
  });

  it("sends nothing and removes nothing when a day turns false", () => {
    const a = { ...s, signIns: [true, false, true, false, false, false, false] };
    const b = { ...s, signIns: [true, false, false, false, false, false, false] };
    expect(changes(a, b)).toEqual({ save: null, remove: [] });
  });

  it("saves only the new message when a chat message is added", () => {
    const before = { ...s, chat: [{ id: "c1", role: "user" as const, text: "hi" }] };
    const next = { ...before, chat: [...before.chat, { id: "c2", role: "agent" as const, text: "Hello!" }] };
    expect(changes(before, next)).toEqual({
      save: { chat: [{ id: "c2", role: "agent", text: "Hello!", at: null, reply: null, app: null }] },
      remove: [],
    });
  });

  it("saves a reply again when it has changed: the whole reply, once it is finished", () => {
    const before = { ...s, chat: [{ id: "a1", role: "agent" as const, text: "Brisk" }] };
    const next = { ...s, chat: [{ id: "a1", role: "agent" as const, text: "Brisk walking counts.", reply: "model" as const }] };
    expect(changes(before, next).save).toEqual({
      chat: [{ id: "a1", role: "agent", text: "Brisk walking counts.", at: null, reply: "model", app: null }],
    });
  });

  it("takes out the messages that are gone after the user edits an earlier one", () => {
    const chat = [
      { id: "u1", role: "user" as const, text: "Is walking enough?" },
      { id: "a1", role: "agent" as const, text: "Brisk walking counts." },
      { id: "u2", role: "user" as const, text: "And cycling?" },
      { id: "a2", role: "agent" as const, text: "Cycling counts too." },
    ];
    const before = { ...s, chat };
    const next = { ...s, chat: chat.slice(0, 2) }; // "And cycling?" is being edited: it and the reply after it go
    expect(changes(before, next)).toEqual({ save: null, remove: [{ kind: "chat", key: "u2" }, { kind: "chat", key: "a2" }] });
  });

  it("saves who when the name changes and preferences when a category preference changes", () => {
    expect(changes(s, withProfile(s, { name: "Sam" })).save).toEqual({ who: { name: "Sam", fitbit_connected: true } });
    const next = withProfile(s, { categoryPrefs: { Dancing: "like" } });
    expect(Object.keys(changes(s, next).save ?? {})).toEqual(["preferences"]);
  });
});
