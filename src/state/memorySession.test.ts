import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fmt, fmtGoal } from "../lib/met";
import { fromMemory } from "../services/fromMemory";
import { addDays, type Memory, type MemoryPart, type Numbers, type OtherOfApp } from "../services/memoryTypes";
import { numbersFor, showNumbers } from "../services/numbers";
import { numbersLike } from "../services/numbers.testkit";
import type { MemoryChanges } from "../services/toMemory";
import { ownContext } from "../services/context";
import { openMemorySession } from "./memorySession";
import { initialState, personaProfile, type Action } from "./store";
import * as Today from "./today";
import type { AppState, ChatMessage } from "./types";

// =================================================================================================
// A fake backend
//
// memorySession.ts talks to the backend only through the functions of memoryClient.ts. They
// are replaced here by a small in-memory Memory that merges what it is sent the way the backend
// does (POST /api/memory upserts by key, DELETE takes one entry out, replace starts over).
//
// The numbers: when a call carries a `date`, the fake answers with "what the backend would work
// out" for the Memory it now holds. It does that in two moves, both with the app's own code:
//   1  put the app's state back together from Memory with fromMemory(), as the second open does.
//      fromMemory needs the weeks the backend sorted Memory into (this week, then each past week
//      with its goal and plan); the fake takes those straight from Memory's goal rows.
//   2  ask the app's own calculator for that state: numbersLike() (numbers.testkit.ts).
// Why this is faithful enough: the shared examples hold the app's calculator and the backend's to
// the same answers for a state laid out by toMemory(), and every state here goes through
// toMemory() -> Memory -> fromMemory(). So the numbers follow whatever the session actually sent,
// including the first seed, with no special case for it. A test can still doctor the answer
// (`backend.doctor`) to prove the screen shows the backend's numbers and not its own.
// =================================================================================================

const MONDAY = "2026-11-23";
const TODAY = "2026-11-25"; // the demo's Wednesday, todayIndex 2

type Call =
  | { name: "readMemory"; date: string }
  | { name: "readNumbers"; date: string }
  | { name: "saveMemory"; part: MemoryPart; date?: string }
  | { name: "sendChanges"; changes: MemoryChanges; date?: string }
  | { name: "replaceMemory"; memory: Memory; date: string };

function emptyMemory(): Memory {
  return {
    who: { name: null, fitbit_connected: null },
    preferences: { categories: {}, equipment: { home: null, gym: null }, no_vigorous: null },
    goals: [],
    daily: { check_ins: [], suggestions: [], workouts: [], app_opens: [] },
    health: { vo2_max: [], heart_rates: [] },
    other: {},
  };
}

/** What goes over the wire: a copy, never the session's own object. */
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function upsert<T>(list: T[], items: T[] | undefined, key: (x: T) => string): T[] {
  if (!items) return list;
  const out = [...list];
  for (const item of items) {
    const i = out.findIndex((x) => key(x) === key(item));
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

const backend = {
  memory: emptyMemory(),
  calls: [] as Call[],
  /** Every set of numbers the fake answered with, in order */
  returned: [] as Numbers[],
  /** Change the numbers before they are sent (identity unless a test says otherwise) */
  doctor: (n: Numbers): Numbers => n,
  /** The next sendChanges call fails, with nothing saved */
  failNextSend: false,
  /** The next sendChanges call stores everything it was sent, then fails, as if the reply was lost */
  loseNextReply: false,
  /** While set, sendChanges waits for it before doing anything */
  hold: null as Promise<void> | null,

  reset() {
    this.memory = emptyMemory();
    this.calls = [];
    this.returned = [];
    this.doctor = (n) => n;
    this.failNextSend = false;
    this.loseNextReply = false;
    this.hold = null;
  },

  save(part: MemoryPart) {
    const m = this.memory;
    if (part.who) m.who = part.who;
    if (part.preferences) m.preferences = part.preferences;
    m.goals = upsert(m.goals, part.goals, (g) => g.week_start).sort((a, b) => a.week_start.localeCompare(b.week_start));
    const d = part.daily;
    if (d) {
      m.daily.workouts = upsert(m.daily.workouts, d.workouts, (w) => w.id);
      m.daily.suggestions = upsert(m.daily.suggestions, d.suggestions, (s) => s.id);
      m.daily.check_ins = upsert(m.daily.check_ins, d.check_ins, (c) => c.date);
      if (d.app_opens) m.daily.app_opens = [...new Set([...m.daily.app_opens, ...d.app_opens])].sort();
    }
    const h = part.health;
    if (h) {
      m.health.vo2_max = upsert(m.health.vo2_max, h.vo2_max, (r) => r.month);
      m.health.heart_rates = upsert(m.health.heart_rates, h.heart_rates, (r) => r.workout_id);
    }
    if (part.other) for (const [name, value] of Object.entries(part.other)) m.other[name] = value;
  },

  remove({ kind, key }: MemoryChanges["remove"][number]) {
    const d = this.memory.daily;
    if (kind === "workouts") d.workouts = d.workouts.filter((w) => w.id !== key);
    if (kind === "suggestions") d.suggestions = d.suggestions.filter((s) => s.id !== key);
    if (kind === "check_ins") d.check_ins = d.check_ins.filter((c) => c.date !== key);
  },

  /** What the backend would work out for the Memory it holds now (see the comment at the top). */
  numbers(date: string): Numbers | null {
    const answer = workedOut(this.memory, date);
    if (!answer) return null;
    const sent = this.doctor(answer);
    this.returned.push(sent);
    return copy(sent);
  },
};

function workedOut(memory: Memory, date: string): Numbers | null {
  const rows = [...memory.goals].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const now = rows.find((r) => r.week_start === MONDAY);
  if (!now || !(memory.other as OtherOfApp).app) return null;
  const template = numbersLike(initialState(), MONDAY);
  const weeks: Numbers = {
    ...template,
    today: date,
    this_week: { ...template.this_week, week_start: MONDAY, goal_met_hours: now.goal_met_hours ?? 0, plan: now.plan ?? [] },
    past_weeks: rows
      .filter((r) => r.week_start < MONDAY)
      .map((r) => ({ ...template.this_week, week_start: r.week_start, goal_met_hours: r.goal_met_hours ?? 0, plan: r.plan ?? [] })),
  };
  const rebuilt = fromMemory(memory, weeks, initialState());
  if (!rebuilt) return null;
  if (addDays(MONDAY, rebuilt.state.todayIndex) !== date) throw new Error(`numbers asked for ${date}, but Memory's today is day ${rebuilt.state.todayIndex}`);
  return numbersLike(rebuilt.state, MONDAY);
}

vi.mock("../services/memoryClient", () => ({
  readMemory: async (date: string): Promise<Memory> => {
    backend.calls.push({ name: "readMemory", date });
    return copy(backend.memory);
  },
  saveMemory: async (part: MemoryPart, date?: string): Promise<Numbers | null> => {
    backend.calls.push({ name: "saveMemory", part: copy(part), date });
    backend.save(copy(part));
    return date ? backend.numbers(date) : null;
  },
  sendChanges: async (changes: MemoryChanges, date?: string): Promise<Numbers | null> => {
    backend.calls.push({ name: "sendChanges", changes: copy(changes), date });
    if (backend.hold) await backend.hold;
    if (backend.failNextSend) {
      backend.failNextSend = false;
      throw new Error("POST /api/memory failed: 503");
    }
    if (changes.save) backend.save(copy(changes.save));
    for (const r of changes.remove) backend.remove(r);
    if (backend.loseNextReply) {
      backend.loseNextReply = false;
      throw new Error("GET /api/numbers failed: 503");
    }
    return date ? backend.numbers(date) : null;
  },
  readNumbers: async (date: string): Promise<Numbers | null> => {
    backend.calls.push({ name: "readNumbers", date });
    return backend.numbers(date);
  },
  replaceMemory: async (memory: Memory, date: string): Promise<Numbers | null> => {
    backend.calls.push({ name: "replaceMemory", memory: copy(memory), date });
    backend.memory = copy(memory);
    return backend.numbers(date);
  },
}));

// =================================================================================================
// The reducer
//
// store.tsx's `reducer` isn't exported. This mirrors it for the actions under test: the same
// Today.* function for each, and the result wrapped in Today.withRewind() exactly as reducer() does.
// =================================================================================================

function reduceOne(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "confirmTime": return Today.confirmTime(state, action.keep);
    case "place": return Today.answerPlace(state, action.label, action.place);
    case "energy": return Today.answerEnergy(state, action.label, action.energy);
    case "accept": return Today.accept(state, action.suggestion);
    case "sync": return Today.sync(state);
    case "addMessage": return { ...state, chat: [...state.chat, action.message] };
    case "updateMessage": return { ...state, chat: state.chat.map((m) => (m.id === action.id ? { ...m, text: action.text, suggestions: action.suggestions ?? m.suggestions } : m)) };
    case "toast": return { ...state, toast: action.text };
    case "overlay": return { ...state, overlay: action.overlay };
    case "moveEnjoyed": {
      const e = [...state.profile.enjoyed];
      const i = e.indexOf(action.familyId);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= e.length) return state;
      [e[i], e[j]] = [e[j], e[i]];
      return { ...state, profile: { ...state.profile, enjoyed: e } };
    }
    default:
      throw new Error(`The test reducer doesn't handle "${action.type}"`);
  }
}

function testReduce(state: AppState, action: Action): AppState {
  const next = reduceOne(state, action);
  return next === state ? next : Today.withRewind(state, next);
}

// =================================================================================================
// Helpers
// =================================================================================================

/** A user who finished onboarding, as "Skip onboarding" leaves them. */
function onboarded(): AppState {
  const s = initialState();
  return Today.startDay({ ...s, onboarded: true, profile: personaProfile(s) });
}

async function open(saved: AppState | null = null) {
  const shown: AppState[] = [];
  const show = vi.fn((s: AppState) => {
    shown.push(s);
  });
  const opened = await openMemorySession({ reduce: testReduce, show, initial: () => initialState(), saved: async () => saved });
  const last = () => shown.at(-1) ?? opened.state;
  const step = async (action: Action) => {
    opened.session.dispatch(action);
    await opened.session.settled();
  };
  return { ...opened, show, shown, last, step };
}

type Opened = Awaited<ReturnType<typeof open>>;

/** Check in (keep today's time, a place, normal energy) and accept the pick. */
async function acceptThePick(o: Opened) {
  await o.step({ type: "confirmTime", keep: true });
  expect(o.last().today.step).toBe("place");
  await o.step({ type: "place", label: "Outside", place: "outside" });
  await o.step({ type: "energy", label: "Normal", energy: "normal" });
  const lead = o.last().today.current?.lead;
  if (!lead) throw new Error("No pick after the check-in");
  await o.step({ type: "accept", suggestion: lead });
  expect(o.last().today.step).toBe("accepted");
  return lead;
}

const creditLine = (s: AppState) => s.today.entries.find((e) => e.role === "agent" && /^\+[\d.]+ MET-hours from /.test(e.text));
const sessionsOf = (s: AppState) => s.sessions.map((x) => x.id);
const memoryChat = () => ((backend.memory.other as OtherOfApp).chat ?? []).map((m) => m.text);
const message = (text: string): ChatMessage => ({ id: `m-${text}`, role: "user", text });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 25, 12)); // a Wednesday; this week's Monday is 2026-11-23
  showNumbers(null, null);
  backend.reset();
});

afterEach(() => {
  vi.useRealTimers();
  showNumbers(null, null);
  backend.reset();
});

// =================================================================================================
// Tests
// =================================================================================================

describe("running the app with the backend (memorySession)", () => {
  it("first open with nothing in Memory and no earlier save puts the demo persona into Memory once", async () => {
    const o = await open(null);

    const replaced = backend.calls.filter((c): c is Extract<Call, { name: "replaceMemory" }> => c.name === "replaceMemory");
    expect(replaced).toHaveLength(1);
    const seeded = replaced[0].memory;
    expect(replaced[0].date).toBe(TODAY);
    expect(seeded.goals).toHaveLength(initialState().history.length + 1);
    expect(seeded.goals.at(-1)?.week_start).toBe(MONDAY);
    expect((seeded.other as OtherOfApp).app?.personaId).toBe("alex");

    expect(o.state.suggestSource).toBe("table");
    expect(numbersFor(o.state)).not.toBeNull();
    // Memory now holds the app's own part, so the next open reads it back.
    expect((backend.memory.other as OtherOfApp).app?.suggestSource).toBe("table");
  });

  it("opening reads Memory with this week's Monday as the date", async () => {
    await open(onboarded());
    const reads = backend.calls.filter((c): c is Extract<Call, { name: "readMemory" }> => c.name === "readMemory");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.map((r) => r.date)).toEqual(reads.map(() => MONDAY));
  });

  it("first open with an earlier save puts that save into Memory, chat included", async () => {
    const saved: AppState = { ...onboarded(), chat: [message("Hello from before Memory")] };
    const o = await open(saved);

    const replaced = backend.calls.find((c): c is Extract<Call, { name: "replaceMemory" }> => c.name === "replaceMemory");
    expect(replaced).toBeDefined();
    const other = replaced!.memory.other as OtherOfApp;
    expect(other.chat?.map((m) => m.text)).toEqual(["Hello from before Memory"]);
    expect(other.app?.onboarded).toBe(true);
    expect(o.state.onboarded).toBe(true);
    expect(o.state.chat.map((m) => m.text)).toEqual(["Hello from before Memory"]);
  });

  it("a second open reads the state back from Memory and only records that the app was opened today", async () => {
    const first = await open(onboarded());
    await acceptThePick(first);
    await first.step({ type: "sync" });
    await first.step({ type: "addMessage", message: message("Still here") });
    const left = first.last();

    showNumbers(null, null);
    backend.calls = [];
    const second = await open(onboarded());

    expect(backend.calls.some((c) => c.name === "replaceMemory")).toBe(false);
    const opens = backend.calls.filter((c): c is Extract<Call, { name: "saveMemory" }> => c.name === "saveMemory" && !!c.part.daily);
    expect(opens).toHaveLength(1);
    expect(opens[0].part).toEqual({ daily: { app_opens: [TODAY] } });
    expect(opens[0].date).toBe(TODAY);

    const back = second.state;
    expect(sessionsOf(back)).toEqual(sessionsOf(left));
    expect(back.goal).toBe(left.goal);
    expect(back.plan).toEqual(left.plan);
    expect(back.today.entries.map((e) => [e.id, e.role, e.text])).toEqual(left.today.entries.map((e) => [e.id, e.role, e.text]));
    expect(back.chat.map((m) => m.text)).toEqual(left.chat.map((m) => m.text));
  });

  it("a sync that adds a workout tells the backend first and says the backend's numbers", async () => {
    const o = await open(onboarded());
    await acceptThePick(o);
    const before = o.last();
    backend.returned = [];

    await o.step({ type: "sync" });

    const after = o.last();
    const added = after.sessions.filter((s) => !sessionsOf(before).includes(s.id));
    expect(added).toHaveLength(1);
    const id = added[0].id;
    expect(backend.memory.daily.workouts.map((w) => w.id)).toContain(id);

    // The numbers were asked for once, for the state after the sync.
    expect(backend.returned).toHaveLength(1);
    const n = backend.returned[0];
    const counted = n.this_week.workouts.find((w) => w.id === id);
    expect(counted).toBeDefined();
    const line = creditLine(after);
    expect(line?.text).toContain(`+${fmt(counted!.met_hours)} MET-hours`);
    expect(line?.text).toContain(`You're at ${fmt(n.this_week.done_met_hours)} of ${fmtGoal(n.this_week.goal_met_hours)} this week.`);
    // What the step said with those numbers is in Memory too.
    expect((backend.memory.other as OtherOfApp).today?.entries.some((e) => e.text === line?.text)).toBe(true);
  });

  it("the sentence after a sync uses the backend's numbers, not the app's own calculator", async () => {
    const o = await open(onboarded());
    await acceptThePick(o);
    backend.returned = [];
    backend.doctor = (n) => ({ ...n, this_week: { ...n.this_week, done_met_hours: n.this_week.done_met_hours + 50 } });

    await o.step({ type: "sync" });

    const after = o.last();
    const sent = backend.returned[0];
    const own = ownContext(after).week.done;
    expect(sent.this_week.done_met_hours).toBeCloseTo(own + 50, 6);
    const line = creditLine(after);
    expect(line?.text).toContain(`You're at ${fmt(own + 50)} of`);
    expect(line?.text).not.toContain(`You're at ${fmt(own)} of`);
  });

  it("a chat message is shown at once and saved right after, with no numbers asked for", async () => {
    const o = await open(onboarded());
    backend.calls = [];
    let release = () => {};
    backend.hold = new Promise<void>((r) => {
      release = r;
    });

    o.session.dispatch({ type: "addMessage", message: message("Hi coach") });
    await vi.waitFor(() => expect(backend.calls.some((c) => c.name === "sendChanges")).toBe(true));
    // The backend hasn't answered yet, and the message is already on screen.
    expect(o.show).toHaveBeenCalledTimes(1);
    expect(o.shown[0].chat.at(-1)?.text).toBe("Hi coach");
    expect(memoryChat()).not.toContain("Hi coach");

    release();
    await o.session.settled();
    const sends = backend.calls.filter((c): c is Extract<Call, { name: "sendChanges" }> => c.name === "sendChanges");
    expect(sends).toHaveLength(1);
    expect(sends[0].date).toBeUndefined();
    expect(Object.keys(sends[0].changes.save?.other ?? {})).toEqual(["chat"]);
    expect(Object.keys(sends[0].changes.save ?? {})).toEqual(["other"]);
    expect(sends[0].changes.remove).toEqual([]);
    expect(backend.calls.some((c) => c.name !== "sendChanges")).toBe(false);
    expect(memoryChat()).toContain("Hi coach");
  });

  it("a step that changes nothing is neither shown nor sent", async () => {
    const o = await open(onboarded());
    backend.calls = [];

    await o.step({ type: "moveEnjoyed", familyId: "not-a-liked-activity", dir: 1 });

    expect(o.show).not.toHaveBeenCalled();
    expect(backend.calls).toEqual([]);
  });

  it("steps are taken one at a time, in the order they were asked for", async () => {
    const o = await open(onboarded());
    const start = o.state.chat.length;

    o.session.dispatch({ type: "addMessage", message: message("one") });
    o.session.dispatch({ type: "addMessage", message: message("two") });
    o.session.dispatch({ type: "addMessage", message: message("three") });
    await o.session.settled();

    expect(memoryChat()).toEqual(["one", "two", "three"]);
    expect(o.show).toHaveBeenCalledTimes(3);
    expect(o.shown.map((s) => s.chat.length)).toEqual([start + 1, start + 2, start + 3]);
    expect(o.last().chat.map((m) => m.text)).toEqual(["one", "two", "three"]);
  });

  it("when the backend fails during a sync, the workout isn't shown, a toast says why, and the next step works", async () => {
    const o = await open(onboarded());
    await acceptThePick(o);
    const before = o.last();
    const inMemoryBefore = backend.memory.daily.workouts.map((w) => w.id);
    backend.failNextSend = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await o.step({ type: "sync" });

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const failed = o.last();
    expect(sessionsOf(failed)).toEqual(sessionsOf(before));
    expect(failed.today.entries.length).toBe(before.today.entries.length);
    expect(failed.toast).toMatch(/backend didn't answer.*didn't go through/i);
    expect(backend.memory.daily.workouts.map((w) => w.id)).toEqual(inMemoryBefore);

    // The same step again, now that the backend answers: the workout is shown and saved.
    await o.step({ type: "sync" });
    const after = o.last();
    const added = after.sessions.filter((s) => !sessionsOf(before).includes(s.id));
    expect(added).toHaveLength(1);
    expect(backend.memory.daily.workouts.map((w) => w.id)).toContain(added[0].id);
    expect(creditLine(after)).toBeDefined();
  });

  it("when the backend stores a sync but its reply is lost, the next sync takes the stray workout back out", async () => {
    const o = await open(onboarded());
    await acceptThePick(o);
    const before = o.last();
    const inMemoryBefore = backend.memory.daily.workouts.map((w) => w.id);
    backend.loseNextReply = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await o.step({ type: "sync" });

    warn.mockRestore();
    const failed = o.last();
    expect(sessionsOf(failed)).toEqual(sessionsOf(before));
    expect(failed.toast).toMatch(/didn't go through/);
    // The backend kept the workout the screen doesn't show.
    const stray = backend.memory.daily.workouts.map((w) => w.id).filter((id) => !inMemoryBefore.includes(id));
    expect(stray).toHaveLength(1);

    backend.returned = [];
    backend.calls = [];
    await o.step({ type: "sync" });

    // Memory was read again before the step sent anything.
    expect(backend.calls.slice(0, 2).map((c) => c.name)).toEqual(["readNumbers", "readMemory"]);
    // ... and it asked for this week's Monday, so the reply is the recent part.
    expect(backend.calls[1]).toEqual({ name: "readMemory", date: MONDAY });
    const after = o.last();
    const added = after.sessions.filter((s) => !sessionsOf(before).includes(s.id));
    expect(added).toHaveLength(1);
    expect(added[0].id).not.toBe(stray[0]);
    const thisWeek = backend.memory.daily.workouts.filter((w) => w.date >= MONDAY).map((w) => w.id);
    expect([...thisWeek].sort()).toEqual([...sessionsOf(after)].sort());
    expect(thisWeek).not.toContain(stray[0]);

    // The numbers count one synced workout: they match what the app's own sessions add up to.
    const n = backend.returned.at(-1)!;
    expect(n.this_week.done_met_hours).toBeCloseTo(ownContext(after).week.done, 6);
    expect(creditLine(after)?.text).toContain(`You're at ${fmt(n.this_week.done_met_hours)} of ${fmtGoal(n.this_week.goal_met_hours)} this week.`);
  });

  it("a chat message whose save fails goes out with the next step", async () => {
    const o = await open(onboarded());
    backend.failNextSend = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await o.step({ type: "addMessage", message: message("lost on the way") });

    warn.mockRestore();
    expect(o.last().chat.map((m) => m.text)).toEqual(["lost on the way"]);
    expect(memoryChat()).toEqual([]);

    await o.step({ type: "addMessage", message: message("this one gets through") });

    expect(memoryChat()).toEqual(["lost on the way", "this one gets through"]);
    expect(o.last().chat.map((m) => m.text)).toEqual(["lost on the way", "this one gets through"]);
  });

  it("a reply that arrives a few words at a time is shown as it grows and saved once, when it is whole", async () => {
    const o = await open(onboarded());
    backend.calls = [];
    const sends = () => backend.calls.filter((c): c is Extract<Call, { name: "sendChanges" }> => c.name === "sendChanges");

    // What the Chat screen does: the user's message, an empty reply, the reply growing, the reply finished.
    await o.step({ type: "addMessage", message: message("Is walking enough?") });
    expect(sends()).toHaveLength(1);
    await o.step({ type: "addMessage", message: { id: "reply", role: "agent", text: "" }, unfinished: true });
    const pieces = ["Walking", "Walking counts", "Walking counts when", "Walking counts when it's", "Walking counts when it's brisk."];
    for (const text of pieces) {
      await o.step({ type: "updateMessage", id: "reply", text, unfinished: true });
      expect(o.last().chat.at(-1)?.text).toBe(text); // on screen as it grows
    }
    expect(sends()).toHaveLength(1); // nothing more was sent while it was being written
    expect(memoryChat()).toEqual(["Is walking enough?"]);

    await o.step({ type: "updateMessage", id: "reply", text: "Walking counts when it's brisk.", suggestions: ["What counts as brisk?"] });

    expect(sends()).toHaveLength(2); // the user's message, then the whole reply
    expect(memoryChat()).toEqual(["Is walking enough?", "Walking counts when it's brisk."]);
    expect(backend.calls.some((c) => c.name !== "sendChanges")).toBe(false);
  });

  it("closing the toast after a step that didn't go through sends nothing, and the toast stays closed", async () => {
    const o = await open(onboarded());
    backend.failNextSend = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await o.step({ type: "addMessage", message: message("lost on the way") });
    expect(o.last().toast).toMatch(/backend didn't answer/i);
    backend.calls = [];
    backend.failNextSend = true; // still down: anything sent now would fail and bring the toast back

    await o.step({ type: "toast", text: null }); // what "Dismiss" and the six-second timer both do

    warn.mockRestore();
    expect(o.last().toast).toBeNull();
    expect(backend.calls).toEqual([]);

    // The backend is back. What wasn't saved goes out with the next step that tells the backend something.
    backend.failNextSend = false;
    await o.step({ type: "addMessage", message: message("this one gets through") });
    expect(memoryChat()).toEqual(["lost on the way", "this one gets through"]);
    expect(o.last().toast).toBeNull();
  });

  it("opening a sheet changes only the screen: it is shown and nothing is sent", async () => {
    const o = await open(onboarded());
    backend.calls = [];

    await o.step({ type: "overlay", overlay: "prefs" });

    expect(o.last().overlay).toBe("prefs");
    expect(backend.calls).toEqual([]);
  });

  it("a sync that reaches the week's goal says 'Trophy earned!' exactly once", async () => {
    const start = onboarded();
    const done = ownContext(start).week.done;
    // The goal just above what this week already has: the next counted workout reaches it.
    const saved: AppState = { ...start, goal: Math.round((done + 0.2) * 100) / 100 };
    const o = await open(saved);
    expect(numbersFor(o.state)?.this_week.trophy).toBe(false);
    const lead = await acceptThePick(o);
    expect(lead.credit).toBeGreaterThan(0.2);

    await o.step({ type: "sync" });

    const after = o.last();
    const trophies = after.today.entries.filter((e) => e.role === "trophy");
    expect(trophies).toHaveLength(1);
    expect(trophies[0].text).toMatch(/^Trophy earned!/);
    expect(backend.returned.at(-1)?.trophy).toBe(true);
    const inMemory = ((backend.memory.other as OtherOfApp).today?.entries ?? []).filter((e) => e.role === "trophy");
    expect(inMemory).toHaveLength(1);
  });
});
