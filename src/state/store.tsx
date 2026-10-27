import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { PERSONAS } from "../data/mockFitbit";
import { fmt, withCredit, type Session } from "../lib/met";
import type { DaySlot, WeekPlan } from "../lib/plan";
import type { Access, DeclineReason, Energy, Place, Suggestion } from "../lib/suggest";
import type { QuestionId } from "../services/answers";
import { buildAgentContext, type AgentContext } from "../services/context";
import { backendHealth, fetchSuggestion, type BackendSuggestion } from "../services/backend";
import { repository } from "../services/store";
import * as Today from "./today";
import type { AppState, ChatMessage, ClinicianSettings, Overlay, UserProfile } from "./types";

export { newId } from "./today";

export const DEFAULT_PROFILE: UserProfile = {
  name: "Alex",
  enjoyed: [],
  access: {},
  usualTime: "1to2",
  hasHealthCondition: false,
  fitbitConnected: false,
};

export const DEFAULT_CLINICIAN: ClinicianSettings = {
  goal: null, noVigorous: false, maxSessionMin: null, note: "",
  name: "", role: "", reason: "", review: "", precautions: "",
};

function personaState(personaId: string): Pick<AppState, "personaId" | "sessions" | "history" | "declines" | "notes" | "plan" | "goal"> {
  const p = PERSONAS.find((x) => x.id === personaId) ?? PERSONAS[0];
  return {
    personaId: p.id,
    sessions: p.thisWeek,
    history: p.history,
    declines: p.declines.map((d, i) => ({ id: `pd-${i}`, ...d })),
    notes: [],
    plan: p.plan,
    goal: p.goal,
  };
}

export function initialState(personaId = "alex"): AppState {
  const base: AppState = {
    version: 2,
    onboarded: false,
    profile: DEFAULT_PROFILE,
    clinician: DEFAULT_CLINICIAN,
    goalSource: "default",
    ...personaState(personaId),
    todayIndex: 2, // Wednesday: a stable mid-week for demos
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
  return { ...state.profile, enjoyed: p.enjoyed, access: p.access, fitbitConnected: true };
}

export type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "completeOnboarding"; profile: UserProfile; plan: WeekPlan }
  | { type: "updateProfile"; patch: Partial<UserProfile> }
  | { type: "setAccess"; familyId: string; access: Access }
  | { type: "toggleEnjoyed"; familyId: string }
  | { type: "moveEnjoyed"; familyId: string; dir: -1 | 1 }
  | { type: "forgetDecline"; id: string }
  | { type: "addSessionManual"; session: Session }
  | { type: "setSlot"; day: number; slot: DaySlot }
  | { type: "setToday"; index: number }
  | { type: "loadPersona"; personaId: string }
  | { type: "time"; label: string; minutes: number }
  | { type: "place"; label: string; place: Place }
  | { type: "energy"; label: string; energy: Energy }
  | { type: "mood"; label: string; mood: string }
  | { type: "showBackups" }
  | { type: "accept"; suggestion: Suggestion }
  | { type: "decline" }
  | { type: "editAnswer"; entryId: string }
  | { type: "editChat"; id: string }
  | { type: "another" }
  | { type: "remindLater" }
  | { type: "setReminder"; when: string }
  | { type: "reminderDue" }
  | { type: "reason"; reason: DeclineReason }
  | { type: "freeText"; text: string }
  | { type: "addNote"; text: string; where: string }
  | { type: "forgetNote"; id: string }
  | { type: "wantMore" }
  | { type: "ask"; q: QuestionId }
  | { type: "sync" }
  | { type: "confirm"; answer: Today.ConfirmAnswer }
  | { type: "keepGoing"; yes: boolean }
  | { type: "restartDay" }
  | { type: "acceptGoal"; to: number }
  | { type: "keepGoal" }
  | { type: "clinician"; patch: Partial<ClinicianSettings> }
  | { type: "overlay"; overlay: Overlay }
  | { type: "toast"; text: string | null }
  | { type: "addMessage"; message: ChatMessage }
  | { type: "updateMessage"; id: string; text: string; suggestions?: string[] }
  | { type: "backendSuggestion"; replaces: Suggestion; result: BackendSuggestion }
  | { type: "reset" };

function reducer(state: AppState, action: Action): AppState {
  const next = reduce(state, action);
  // Loading a save (or undoing an edit) restores answers as they were; only new answers get a rewind point.
  return next === state || action.type === "hydrate" ? next : Today.withRewind(state, next);
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "completeOnboarding":
      return Today.startDay({ ...state, onboarded: true, profile: action.profile, plan: action.plan });
    case "updateProfile":
      return { ...state, profile: { ...state.profile, ...action.patch } };
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
      const credit = withCredit(action.session).credit;
      return { ...state, sessions: [...state.sessions, action.session], toast: credit > 0 ? `Added: +${fmt(credit)} MET-hours.` : "Added. Light activity earns a medal, not goal credit." };
    }
    case "forgetDecline":
      return { ...state, declines: state.declines.filter((d) => d.id !== action.id) };
    case "setSlot": {
      const plan = [...state.plan];
      plan[action.day] = action.slot;
      return { ...state, plan };
    }
    case "setToday":
      return Today.startDay({ ...state, todayIndex: action.index });
    case "loadPersona": {
      const next = { ...state, ...personaState(action.personaId), syncCount: 0, painReports: 0, clinician: DEFAULT_CLINICIAN, goalSource: "default" as const, recapHandled: false };
      return Today.startDay(state.onboarded ? { ...next, profile: personaProfile(next) } : next);
    }
    case "time": return Today.answerTime(state, action.label, action.minutes);
    case "place": return Today.answerPlace(state, action.label, action.place);
    case "energy": return Today.answerEnergy(state, action.label, action.energy);
    case "mood": return Today.answerMood(state, action.label, action.mood);
    case "showBackups": return Today.showBackups(state);
    case "accept": return Today.accept(state, action.suggestion);
    case "decline": return Today.decline(state);
    case "editAnswer": return Today.editAnswer(state, action.entryId);
    case "editChat": {
      // Editing a Coach message drops it and everything after; the screen resends the new text.
      const i = state.chat.findIndex((m) => m.id === action.id);
      return i < 0 ? state : { ...state, chat: state.chat.slice(0, i) };
    }
    case "another": return Today.anotherOption(state);
    case "remindLater": return Today.remindLater(state);
    case "setReminder": return Today.setReminder(state, action.when);
    case "reminderDue": return Today.reminderDue(state);
    case "reason": return Today.chooseReason(state, action.reason);
    case "freeText": return Today.freeText(state, action.text);
    case "addNote": return { ...state, notes: [...state.notes, { id: Today.newId("n"), text: action.text, where: action.where, day: state.todayIndex }] };
    case "forgetNote": return { ...state, notes: state.notes.filter((n) => n.id !== action.id) };
    case "wantMore": return Today.wantMore(state);
    case "ask": return Today.ask(state, action.q);
    case "sync": return Today.sync(state);
    case "confirm": return Today.confirm(state, action.answer);
    case "keepGoing": return Today.keepGoing(state, action.yes);
    case "restartDay":
      // Demo control: replay today from the check-in, without today's workouts.
      return Today.startDay({ ...state, sessions: state.sessions.filter((x) => x.dayIndex !== state.todayIndex) });
    case "acceptGoal":
      return { ...state, goal: action.to, goalSource: "recap", recapHandled: true };
    case "keepGoal":
      return { ...state, recapHandled: true };
    case "clinician":
      return { ...state, clinician: { ...state.clinician, ...action.patch } };
    case "overlay":
      return { ...state, overlay: action.overlay };
    case "toast":
      return { ...state, toast: action.text };
    case "addMessage":
      return { ...state, chat: [...state.chat, action.message] };
    case "updateMessage":
      return {
        ...state,
        chat: state.chat.map((m) => (m.id === action.id ? { ...m, text: action.text, suggestions: action.suggestions ?? m.suggestions } : m)),
      };
    case "backendSuggestion":
      return Today.applyBackendSuggestion(state, action.replaces, action.result);
    case "reset":
      return initialState();
  }
}

interface Store {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  ctx: AgentContext;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const hydrated = useRef(false);

  useEffect(() => {
    repository.load().then((saved) => {
      // Older saves (version 1, guideline minutes) don't fit the new model; start fresh.
      if (saved && (saved as AppState).version === 2) dispatch({ type: "hydrate", state: { ...initialState(), ...saved, overlay: null, toast: null } });
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    if (hydrated.current) repository.save(state);
  }, [state]);

  // When the ranker has just shown a suggestion, ask the backend (Jev) for its
  // pick and swap it in. If the backend is down, the ranker's pick stays.
  const asked = useRef(new WeakSet<object>());
  useEffect(() => {
    const c = state.today.current;
    if (state.today.step !== "suggested" || !c || c.source !== "rules" || c.desk || asked.current.has(c.lead)) return;
    const replaces = c.lead;
    asked.current.add(replaces);
    backendHealth().then((h) => {
      if (!h) return;
      fetchSuggestion(state).then((r) => r && dispatch({ type: "backendSuggestion", replaces, result: r }));
    });
  }, [state]);

  const ctx = useMemo(() => buildAgentContext(state), [state]);
  const value = useMemo(() => ({ state, dispatch, ctx }), [state, ctx]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}
