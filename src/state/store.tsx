import { withPref, type CategoryPref } from "../lib/categories";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { PERSONAS } from "../data/mockFitbit";
import { importFitbit, syncSince, type FitbitImport } from "../lib/fitbit";
import { fmt, type Session } from "../lib/met";
import { ALL_FROM_PLAN, applyCalendarEdit, migratePlan, migrateSources, shorterSlot, SLOT_MINUTES, type DaySlot, type WeekPlan } from "../lib/plan";
import { migratePlace, type Access, type DeclineReason, type Energy, type Place, type Suggestion } from "../lib/suggest";
import { buildAgentContext, creditOf, type AgentContext } from "../services/context";
import { backendHealth, fetchMemorySuggestion, fetchSuggestion, fetchTableSuggestion, type BackendSuggestion } from "../services/backend";
import { registerTable } from "../lib/tableActivities";
import { suggestSourceOf, TABLE_WAIT_MS } from "./suggestSource";
import { fetchFitbitData, FitbitDisconnected } from "../services/fitbit";
import { repository } from "../services/store";
import { applyClinicianTurn } from "../services/clinicianChat";
import { showNumbers } from "../services/numbers";
import { openMemorySession, type MemorySession } from "./memorySession";
import { askToday, askTodayFromMemory, chatModelLive, readTyped, weekRecap, whyLine } from "../services/todayWords";
import { buildMemoryChatRequest } from "../services/agent";
import { buildSystemPrompt } from "../services/prompts";
import * as Today from "./today";
import type { EquipmentProfile } from "../data/mockFitbit";
import type { AppState, ChatMessage, ChatReply, ClinicianNotes, Overlay, SuggestSource, UserProfile } from "./types";
import { appDate, clampGoal } from "../lib/goalNote";

export { newId } from "./today";

export const DEFAULT_PROFILE: UserProfile = {
  name: "Alex",
  enjoyed: [],
  access: {},
  usualTime: "1to2",
  hasHealthCondition: false,
  fitbitConnected: false,
};

export const DEFAULT_CLINICIAN: ClinicianNotes = { entries: [] };

/** Saves from the hand-over Clinician tab had one note with a name; keep it as the first entry. */
function migrateClinician(c: unknown): ClinicianNotes {
  const old = (c ?? {}) as { entries?: ClinicianNotes["entries"]; note?: string; name?: string; updated?: string };
  if (Array.isArray(old.entries)) return { entries: old.entries };
  const text = old.note?.trim();
  if (!text) return DEFAULT_CLINICIAN;
  return { entries: [{ id: "cn-migrated", text: old.name?.trim() ? `${old.name.trim()} said: ${text}` : text, at: old.updated ?? new Date().toISOString() }] };
}

function personaState(personaId: string): Pick<AppState, "personaId" | "sessions" | "history" | "declines" | "notes" | "plan" | "planSource" | "goal" | "goalSource" | "goalSet" | "signIns" | "vo2"> {
  const p = PERSONAS.find((x) => x.id === personaId) ?? PERSONAS[0];
  return {
    personaId: p.id,
    sessions: p.thisWeek,
    history: p.history,
    declines: p.declines.map((d, i) => ({ id: `pd-${i}`, ...d })),
    notes: [],
    plan: p.plan,
    planSource: ALL_FROM_PLAN,
    goal: p.goal,
    // Demo: a goal the agent raised on Sunday of this week, with its reason, shown beside the goal.
    goalSource: p.goalRaise ? "recap" : "default",
    goalSet: p.goalRaise ? { by: "agent", on: appDate(0), from: p.goalRaise.from, reason: p.goalRaise.reason } : undefined,
    signIns: p.signInsThisWeek,
    vo2: p.vo2,
  };
}

export function initialState(personaId = "alex"): AppState {
  const base: AppState = {
    version: 2,
    onboarded: false,
    profile: DEFAULT_PROFILE,
    clinician: DEFAULT_CLINICIAN,
    ...personaState(personaId),
    todayIndex: 3, // Wednesday: a stable mid-week for demos
    today: { dayKey: "", step: "time", checkIn: {}, entries: [], exclude: [], boost: false, nudged: false },
    chat: [],
    syncCount: 0,
    painReports: 0,
    overlay: null,
    toast: null,
    recapHandled: false,
  };
  return Today.startDay(base);
}

/** The profile a persona would have after onboarding (used by "Skip onboarding"). */
export function personaProfile(state: AppState): UserProfile {
  const p = PERSONAS.find((x) => x.id === state.personaId) ?? PERSONAS[0];
  return { ...state.profile, enjoyed: p.enjoyed, access: p.access, fitbitConnected: true, equipment: p.equipment, pickedCodes: undefined };
}

export type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "completeOnboarding"; profile: UserProfile; plan: WeekPlan; setUpWeek?: boolean }
  /** Demo: a new user's first log-in. Today starts with the agent setting the week's goal and plan. */
  | { type: "firstLogin" }
  | { type: "setupGoal"; label: string; to: number }
  | { type: "setupPlanDone"; label: string }
  | { type: "updateProfile"; patch: Partial<UserProfile> }
  | { type: "setCategoryPref"; category: string; pref: CategoryPref | undefined }
  | { type: "setAccess"; familyId: string; access: Access }
  | { type: "toggleEnjoyed"; familyId: string }
  | { type: "moveEnjoyed"; familyId: string; dir: -1 | 1 }
  | { type: "forgetDecline"; id: string }
  | { type: "addSessionManual"; session: Session }
  | { type: "setSlot"; day: number; slot: DaySlot }
  | { type: "setToday"; index: number }
  | { type: "loadPersona"; personaId: string }
  | { type: "confirmTime"; keep: boolean }
  | { type: "time"; label: string; minutes: number; slot?: DaySlot }
  | { type: "calendarEdit" }
  | { type: "dayOff" }
  | { type: "place"; label: string; place: Place }
  | { type: "energy"; label: string; energy: Energy }
  | { type: "mood"; label: string; mood: string }
  | { type: "showBackups" }
  | { type: "accept"; suggestion: Suggestion }
  | { type: "decline" }
  | { type: "editAnswer"; entryId: string }
  | { type: "editChat"; id: string }
  | { type: "another" }
  | { type: "own"; answer: Today.OwnAnswer }
  | { type: "skipReason"; reason: DeclineReason }
  | { type: "remindLater" }
  | { type: "setReminder"; when: string }
  | { type: "reminderDue" }
  | { type: "reason"; reason: DeclineReason }
  | { type: "freeText"; text: string }
  // ChatGPT on Today (src/services/todayWords.ts): a typed answer it read, a question it answered,
  // the "Based on" line under the pick, and the recap at the week's first log-in.
  | { type: "typedRead"; text: string; read: Today.TypedRead }
  | { type: "todayReply"; question: string; reply: string }
  | { type: "whyPending"; key: string }
  | { type: "whyLine"; key: string; line: string | null }
  | { type: "weekRecap"; dayKey: string; text: string }
  | { type: "addNote"; text: string; where: string }
  | { type: "forgetNote"; id: string }
  | { type: "wantMore" }
  | { type: "sync" }
  | { type: "fitbitSync"; data: FitbitImport }
  | { type: "confirm"; answer: Today.ConfirmAnswer }
  | { type: "keepGoing"; yes: boolean }
  | { type: "restartDay" }
  | { type: "acceptGoal"; to: number; reason: string }
  | { type: "setGoal"; to: number }
  | { type: "keepGoal" }
  | { type: "clinicianChat"; text: string }
  | { type: "forgetClinicianNote"; id: string }
  | { type: "setEquipment"; equipment: EquipmentProfile }
  | { type: "showHow" }
  | { type: "videoExample" }
  | { type: "overlay"; overlay: Overlay }
  | { type: "toast"; text: string | null }
  // `unfinished`: the agent is still writing this message. It is shown as it grows; with the
  // backend it is saved once, by the update that finishes it (memorySession.ts).
  | { type: "addMessage"; message: ChatMessage; unfinished?: boolean }
  // `reply`: for a reply from the backend, what kind it was (ChatReply); kept with the message.
  | { type: "updateMessage"; id: string; text: string; suggestions?: string[]; reply?: ChatReply; unfinished?: boolean }
  | { type: "backendSuggestion"; replaces: Suggestion; result: BackendSuggestion }
  | { type: "backendFailed"; replaces: Suggestion }
  | { type: "suggestionFailed"; replaces: Suggestion }
  | { type: "retrySuggestion" }
  | { type: "commit"; state: AppState }
  | { type: "setSuggestSource"; source: SuggestSource }
  | { type: "reset" };

export function reducer(state: AppState, action: Action): AppState {
  const next = reduce(state, action);
  // Loading a save (or undoing an edit) restores answers as they were; only new answers get a rewind point.
  // "commit" shows a state a step has already produced (memorySession.ts), rewind points and all.
  return next === state || action.type === "hydrate" || action.type === "commit" ? next : Today.withRewind(state, next);
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      // Activity-table rows saved with the state: known to getVariant again before anything renders.
      registerTable(Object.values(action.state.tableActivities ?? {}));
      return action.state;
    case "commit":
      return action.state;
    case "completeOnboarding":
      // After real onboarding, Today first sets the weekly goal and plan; Skip onboarding (demo) goes straight to the day.
      return Today.startDay({ ...state, onboarded: true, profile: action.profile, plan: action.plan, planSource: ALL_FROM_PLAN, weekSetup: action.setUpWeek || undefined, weekPlanned: !action.setUpWeek || undefined });
    case "setupGoal": return Today.setupGoal(state, action.label, action.to);
    case "setupPlanDone": return Today.setupPlanDone(state, action.label);
    case "updateProfile":
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case "setCategoryPref":
      return { ...state, profile: { ...state.profile, categoryPrefs: withPref(state.profile.categoryPrefs, action.category, action.pref) } };
    case "setAccess":
      return { ...state, profile: { ...state.profile, access: { ...state.profile.access, [action.familyId]: action.access } } };
    case "toggleEnjoyed": {
      const e = state.profile.enjoyed;
      const on = e.includes(action.familyId);
      return {
        ...state,
        profile: {
          ...state.profile,
          enjoyed: on ? e.filter((x) => x !== action.familyId) : [...e, action.familyId],
          access: on ? state.profile.access : { ...state.profile.access, [action.familyId]: state.profile.access[action.familyId] ?? "have" },
        },
      };
    }
    case "moveEnjoyed": {
      const e = [...state.profile.enjoyed];
      const i = e.indexOf(action.familyId);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= e.length) return state;
      [e[i], e[j]] = [e[j], e[i]];
      return { ...state, profile: { ...state.profile, enjoyed: e } };
    }
    case "addSessionManual": {
      const added = { ...state, sessions: [...state.sessions, action.session] };
      const credit = creditOf(added, action.session);
      return { ...added, toast: credit > 0 ? `Added: +${fmt(credit)} MET-hours.` : "Added. Light activity earns a medal, not goal credit." };
    }
    case "forgetDecline":
      return { ...state, declines: state.declines.filter((d) => d.id !== action.id) };
    case "setSlot": {
      // A change on Progress is a new weekly plan for that day; its calendar block follows.
      const plan = [...state.plan];
      plan[action.day] = action.slot;
      const planSource = state.planSource.map((x, i) => (i === action.day ? "plan" : x));
      return { ...state, plan, planSource };
    }
    case "calendarEdit": {
      // Demo control: the user shortens today's exercise block on their calendar.
      const slot = shorterSlot(state.plan[state.todayIndex]);
      if (!slot) return { ...state, toast: "Today has no exercise block to shorten." };
      const edited = applyCalendarEdit(state.plan, state.planSource, state.todayIndex, slot);
      const next = Today.startDay({ ...state, plan: edited.plan, planSource: edited.sources });
      return { ...next, toast: `Calendar: today's exercise block is now ${SLOT_MINUTES[slot]} min.` };
    }
    case "setToday": {
      // "Pretend today is …" (demo controls): the week as it stood when that day began. A workout
      // on that day or later hasn't happened yet, so it isn't counted; the persona's own come back
      // when the day is moved past them again. A real Fitbit week is left as it is.
      if (state.fitbitWeek) return Today.startDay({ ...state, todayIndex: action.index });
      const persona = PERSONAS.find((x) => x.id === state.personaId)?.thisWeek ?? [];
      const fromPersona = new Set(persona.map((x) => x.id));
      const sessions = [
        ...persona.filter((x) => x.dayIndex < action.index),
        ...state.sessions.filter((x) => !fromPersona.has(x.id) && x.dayIndex < action.index),
      ];
      return Today.startDay({ ...state, todayIndex: action.index, sessions });
    }
    case "firstLogin": {
      // A new user (the "Fresh start" persona: no history, nothing this week), past onboarding, whose
      // first Today conversation sets the week's goal and plan before the day's check-in.
      const next = { ...state, ...personaState("fresh"), syncCount: 0, painReports: 0, clinician: DEFAULT_CLINICIAN, recapHandled: false, chat: [] };
      return Today.startDay({ ...next, onboarded: true, profile: personaProfile(next), weekSetup: true, weekPlanned: undefined });
    }
    case "loadPersona": {
      const next = { ...state, ...personaState(action.personaId), syncCount: 0, painReports: 0, clinician: DEFAULT_CLINICIAN, recapHandled: false, weekSetup: undefined, weekPlanned: undefined };
      return Today.startDay(state.onboarded ? { ...next, profile: personaProfile(next) } : next);
    }
    case "confirmTime": return Today.confirmTime(state, action.keep);
    case "time": return Today.answerTime(state, action.label, action.minutes, action.slot);
    case "dayOff": return Today.takeDayOff(state);
    case "place": return Today.answerPlace(state, action.label, action.place);
    case "energy": return Today.answerEnergy(state, action.label, action.energy);
    case "mood": return Today.answerMood(state, action.label, action.mood);
    case "showBackups": return Today.showBackups(state);
    case "accept": return Today.accept(state, action.suggestion);
    case "decline": return Today.decline(state);
    case "editAnswer": return Today.editAnswer(state, action.entryId);
    case "editChat": {
      // Editing a Chat message drops it and everything after; the screen resends the new text.
      const i = state.chat.findIndex((m) => m.id === action.id);
      return i < 0 ? state : { ...state, chat: state.chat.slice(0, i) };
    }
    case "another": return Today.anotherOption(state);
    case "skipReason": return Today.skipReason(state, action.reason);
    case "remindLater": return Today.remindLater(state);
    case "setReminder": return Today.setReminder(state, action.when);
    case "reminderDue": return Today.reminderDue(state);
    case "reason": return Today.chooseReason(state, action.reason);
    case "freeText": return Today.freeText(state, action.text);
    case "typedRead": return Today.applyTyped(state, action.text, action.read);
    case "todayReply": return Today.todayReply(state, action.question, action.reply);
    case "whyPending": return Today.whyPending(state, action.key);
    case "whyLine": return Today.setWhy(state, action.key, action.line);
    case "weekRecap": return Today.addRecap(state, action.dayKey, action.text);
    case "own": return Today.ownAnswer(state, action.answer);
    case "addNote": return { ...state, notes: [...state.notes, { id: Today.newId("n"), text: action.text, where: action.where, day: state.todayIndex }] };
    case "forgetNote": return { ...state, notes: state.notes.filter((n) => n.id !== action.id) };
    case "wantMore": return Today.wantMore(state);
    case "sync": return Today.sync(state);
    case "fitbitSync": return Today.syncFitbit(state, action.data);
    case "confirm": return Today.confirm(state, action.answer);
    case "keepGoing": return Today.keepGoing(state, action.yes);
    case "restartDay":
      // Demo control: replay today from the check-in, without today's workouts.
      return Today.startDay({ ...state, sessions: state.sessions.filter((x) => x.dayIndex !== state.todayIndex) });
    case "acceptGoal":
      // The agent's offer, accepted: who, when and why are shown beside the goal.
      return {
        ...state, goal: action.to, goalSource: "recap", recapHandled: true,
        goalSet: { by: "agent", on: appDate(state.todayIndex), reason: action.reason, from: state.goal },
      };
    case "setGoal": {
      // The user's own number (Settings, onboarding, or typed on Progress). It also answers this week's offer.
      const to = clampGoal(action.to);
      if (to === state.goal && state.goalSource === "user") return state;
      return { ...state, goal: to, goalSource: "user", recapHandled: true, goalSet: { by: "user", on: appDate(state.todayIndex), from: state.goal } };
    }
    case "keepGoal":
      return { ...state, recapHandled: true };
    case "clinicianChat":
      return applyClinicianTurn(state, action.text);
    case "forgetClinicianNote":
      return { ...state, clinician: { entries: state.clinician.entries.filter((n) => n.id !== action.id) } };
    case "setEquipment":
      return { ...state, profile: { ...state.profile, equipment: action.equipment } };
    case "showHow":
      return Today.showHow(state);
    case "videoExample":
      return Today.videoExample(state);
    case "overlay":
      return { ...state, overlay: action.overlay };
    case "toast":
      return { ...state, toast: action.text };
    case "addMessage":
      return { ...state, chat: [...state.chat, action.message] };
    case "updateMessage":
      return {
        ...state,
        chat: state.chat.map((m) => (m.id === action.id
          ? { ...m, text: action.text, suggestions: action.suggestions ?? m.suggestions, ...(action.reply ? { reply: action.reply } : {}) }
          : m)),
      };
    case "backendSuggestion":
      return Today.applyBackendSuggestion(state, action.replaces, action.result);
    case "backendFailed":
      return Today.backendFailed(state, action.replaces);
    case "suggestionFailed":
      return Today.suggestionFailed(state, action.replaces);
    case "retrySuggestion":
      return Today.retrySuggestion(state);
    case "setSuggestSource":
      return { ...state, suggestSource: action.source };
    case "reset":
      // The demo's choice of suggestion source stays; everything else starts over.
      return { ...initialState(), suggestSource: state.suggestSource };
  }
}

interface Store {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  ctx: AgentContext;
  /** Set when the app runs with the backend (the one switch, decided when it opens); null without it */
  session: MemorySession | null;
}

const StoreContext = createContext<Store | null>(null);

/** A save from before Memory was in use, brought up to today's shape. null: there is none, or it is too old to use. */
function migrateSaved(saved: unknown): AppState | null {
  // Older saves (version 1, guideline minutes) don't fit the new model; start fresh.
  if (!saved || (saved as AppState).version !== 2) return null;
  const s = saved as AppState;
  // Plans saved as Short/Medium/Long become 10/30/45 min.
  const plans = { plan: migratePlan(s.plan), history: (s.history ?? []).map((w) => ({ ...w, plan: migratePlan(w.plan) })) };
  // Saves from before VO2 max and clinician notes: fill those in from the persona.
  const persona = personaState(s.personaId ?? "alex");
  const extra = {
    planSource: migrateSources(s.planSource),
    // A save from before streaks has no record of opens: no day of this week counts until today's open, below.
    signIns: s.signIns ?? [],
    vo2: s.vo2 ?? persona.vo2,
    clinician: migrateClinician(s.clinician),
    chat: s.chat ?? [],
  };
  // Saves from before the three places: Home → Indoors, private; Gym and Office → Indoors, with others.
  const checkIn = { ...s.today?.checkIn, place: migratePlace(s.today?.checkIn?.place) };
  const today = { ...s.today, checkIn, entries: (s.today?.entries ?? []).filter((e) => (e.role as string) !== "medal") };
  let loaded: AppState = { ...initialState(), ...s, ...plans, ...extra, today, overlay: null, toast: null };
  // Opening the app puts today on record as opened: the streak counts only the days on record.
  loaded = { ...loaded, signIns: Today.openedToday(loaded) };
  // A save still sitting on the old opener ("How much time do you have today?") on a planned day:
  // restart the check-in so it confirms the planned time instead.
  if (loaded.onboarded && today.step === "time" && today.entries.length === 1 && loaded.plan[loaded.todayIndex] !== "off") {
    loaded = Today.startDay(loaded);
  }
  return loaded;
}

/** Opening from Memory happens once per page load, also when React runs the effect below twice in development. */
let opening: ReturnType<typeof openMemorySession> | null = null;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, apply] = useReducer(reducer, undefined, () => initialState());
  const hydrated = useRef(false);
  /** Set when the app runs with the backend: Memory remembers the user and the backend works out the numbers. */
  const memory = useRef<MemorySession | null>(null);
  /** With the backend a step is told to the backend first (memorySession.ts); without it, it goes straight to the reducer. */
  const dispatch = useCallback((action: Action) => (memory.current ? memory.current.dispatch(action) : apply(action)), []);

  useEffect(() => {
    (async () => {
      // The one switch, decided when the app opens: does the backend answer?
      if (await backendHealth()) {
        try {
          opening ??= openMemorySession({
            reduce: reducer,
            show: (s) => apply({ type: "commit", state: s }),
            initial: () => initialState(),
            saved: async () => migrateSaved(await repository.load()),
          });
          const opened = await opening;
          memory.current = opened.session;
          apply({ type: "hydrate", state: opened.state });
          hydrated.current = true;
          return;
        } catch (e) {
          console.warn("The backend answers, but Memory couldn't be opened. Running without it.", e);
          showNumbers(null, null);
        }
      }
      // Without the backend: the app remembers, works the numbers out and suggests, as it always has.
      const saved = migrateSaved(await repository.load());
      if (saved) apply({ type: "hydrate", state: saved });
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    // With the backend, Memory is the only record: nothing is saved in one piece any more.
    if (hydrated.current && !memory.current) repository.save(state);
  }, [state]);

  // When the ranker has just shown a suggestion, ask the backend (Jev) for its
  // pick and swap it in. If the backend is down, the ranker's pick stays.
  const asked = useRef(new WeakSet<object>());
  useEffect(() => {
    const c = state.today.current;
    if (state.today.step !== "suggested" || !c || c.source !== "rules" || c.desk || c.failed || asked.current.has(c.lead)) return;
    const replaces = c.lead;
    asked.current.add(replaces);
    const session = memory.current;
    if (session) {
      // With the backend: only the check-in is sent, once every step before it has been saved,
      // so the backend suggests from what Memory holds right now.
      session.settled()
        .then(() => fetchMemorySuggestion(state, session.today(state), TABLE_WAIT_MS))
        .then((r) => dispatch(r ? { type: "backendSuggestion", replaces, result: r } : { type: "suggestionFailed", replaces }));
      return;
    }
    const table = suggestSourceOf(state) === "table";
    backendHealth().then((h) => {
      if (!h) {
        if (table) dispatch({ type: "backendFailed", replaces });
        return;
      }
      const ask = table ? fetchTableSuggestion(state, TABLE_WAIT_MS) : fetchSuggestion(state);
      ask.then((r) => dispatch(r ? { type: "backendSuggestion", replaces, result: r } : { type: "backendFailed", replaces }));
    });
  }, [state, dispatch]);

  // ChatGPT's "Based on" line under a pick from the backend, once per pick. Without ChatGPT there's none.
  const whyAsked = useRef(new Set<string>());
  useEffect(() => {
    const key = Today.whyKey(state);
    const want = key && !whyAsked.current.has(key) ? Today.whyFacts(state) : null;
    if (!key || !want) return;
    whyAsked.current.add(key);
    void (async () => {
      if (!(await chatModelLive())) {
        // No ChatGPT (any more): a loading line left from before a reload goes.
        if (state.today.current?.whyPending) dispatch({ type: "whyLine", key, line: null });
        return;
      }
      dispatch({ type: "whyPending", key });
      dispatch({ type: "whyLine", key, line: await whyLine(want.activity, want.facts) });
    })();
  }, [state, dispatch]);

  // The week's first log-in: ChatGPT's two sentences about last week, at the top of the conversation.
  const recapAsked = useRef(new Set<string>());
  useEffect(() => {
    const t = state.today;
    if (t.recap !== "due" || recapAsked.current.has(t.dayKey)) return;
    recapAsked.current.add(t.dayKey);
    const facts = Today.recapFacts(state);
    if (!facts) return;
    chatModelLive()
      .then((live) => (live ? weekRecap(facts) : null))
      .then((text) => text && dispatch({ type: "weekRecap", dayKey: t.dayKey, text }));
  }, [state, dispatch]);

  const ctx = useMemo(() => buildAgentContext(state), [state]);
  // `memory.current` is set just before the state read from Memory is shown, so it is in step with `state`.
  const value = useMemo(() => ({ state, dispatch, ctx, session: memory.current }), [state, dispatch, ctx]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/**
 * Pulls the user's real Fitbit data and hands it to the reducer. When the
 * backend's sign-in has expired, the connection is turned off so the app
 * offers to connect again.
 */
export async function pullFitbit(dispatch: React.Dispatch<Action>): Promise<void> {
  const now = new Date();
  try {
    const data = await fetchFitbitData(syncSince(now));
    dispatch({ type: "fitbitSync", data: importFitbit(data, now) });
  } catch (e) {
    console.warn("Fitbit sync failed.", e);
    // The backend's reply stays in the console; the user gets a plain sentence.
    if (e instanceof FitbitDisconnected) dispatch({ type: "updateProfile", patch: { fitbitConnected: false, fitbitLive: false } });
    dispatch({ type: "toast", text: e instanceof FitbitDisconnected ? e.message : "Fitbit didn't sync. Try again in a minute." });
  }
}

/** What "Sync Fitbit" does: pull the real Fitbit when it's connected, otherwise the demo's simulated sync. */
export function useFitbitSync(): () => void {
  const { state, dispatch } = useStore();
  const live = !!state.profile.fitbitLive;
  return useCallback(() => (live ? void pullFitbit(dispatch) : dispatch({ type: "sync" })), [live, dispatch]);
}

/** Steps whose typed answer ChatGPT reads. The own-exercise steps keep the table search; Fitbit's "Right?" keeps its own. */
const READ_STEPS = new Set(["setup-goal", "setup-plan", "time-confirm", "time", "place", "energy", "suggested", "reason", "reminded", "accepted", "nudge", "wrap"]);

/**
 * The "Other" box on Today. With ChatGPT connected, the typed answer is read by it first
 * (readTyped): its fields fill in the check-in, and a question is answered through /api/chat with
 * today's context. Without ChatGPT, or when it's slow or unsure, the app reads the answer itself,
 * as before. `pending` is the typed text while it waits, shown with the typing dots.
 */
export function useTypedAnswer(): { submit: (text: string) => Promise<void>; pending: string | null } {
  const { state, ctx, dispatch, session } = useStore();
  const [pending, setPending] = useState<string | null>(null);
  const submit = useCallback(async (text: string) => {
    const step = state.today.step;
    if (!READ_STEPS.has(step) || !(await chatModelLive())) {
      dispatch({ type: "freeText", text });
      return;
    }
    setPending(text);
    try {
      const question = [...state.today.entries].reverse().find((e) => e.role === "agent")?.text ?? "";
      const read = await readTyped(step, question, text);
      if (read?.intent === "question") {
        // On Memory (the usual case with the backend): /api/chat/memory, as the Chat tab, so the backend
        // reads the user from Memory and the app sends no prompt of its own. Otherwise /api/chat.
        const reply = session
          ? await session.settled().then(() => askTodayFromMemory(buildMemoryChatRequest(todayHistory(state, text), state, session.today(state))))
          : await askToday(todaySystem(state, ctx), todayHistory(state, text).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })));
        dispatch(reply ? { type: "todayReply", question: text, reply } : { type: "freeText", text });
        return;
      }
      dispatch(read ? { type: "typedRead", text, read } : { type: "freeText", text });
    } finally {
      setPending(null);
    }
  }, [state, ctx, dispatch, session]);
  return { submit, pending };
}

/** What ChatGPT knows when it answers on Today: the Chat tab's prompt, plus where the user is in today's check-in. */
function todaySystem(state: AppState, ctx: AgentContext): string {
  const c = state.today.current;
  const pick = c ? `Today's suggestion on screen: ${c.lead.durationMin} min, ${c.lead.reasons.join("; ")}.` : "No suggestion on screen yet.";
  return `${buildSystemPrompt(ctx)}\n\nThe user is in today's check-in on the Today tab and typed a question there. ${pick} Answer in two or three sentences; they will go back to the check-in after.`;
}

/**
 * The last few turns of today's conversation, what's on the card (the model can't see it), then the
 * question. Shaped as Chat messages, so the Chat tab's request builder can send them.
 */
function todayHistory(state: AppState, text: string): ChatMessage[] {
  const recent = state.today.entries.filter((e) => e.role === "agent" || e.role === "user").slice(-6);
  const c = state.today.current;
  const card = c && ["suggested", "accepted", "reminded"].includes(state.today.step)
    ? [{ id: "today-card", role: "agent" as const, text: `Today's suggestion on the card: ${c.lead.durationMin} min (${c.lead.reasons.join("; ")}).` }]
    : [];
  return [
    ...recent.map((e) => ({ id: e.id, role: e.role === "user" ? ("user" as const) : ("agent" as const), text: e.text })),
    ...card,
    { id: "today-question", role: "user", text },
  ];
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}
