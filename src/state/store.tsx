import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { PERSONAS, SIMULATED_SYNCS } from "../data/mockFitbit";
import type { Session } from "../lib/guideline";
import type { PlanKind } from "../lib/planner";
import { buildAgentContext, type AgentContext } from "../services/context";
import { repository } from "../services/store";
import type { AppState, ChatMessage, UserProfile } from "./types";

export const DEFAULT_PROFILE: UserProfile = {
  name: "Alex",
  weeklyTimeMin: 120,
  enjoyedFamilyIds: [],
  hasHealthCondition: false,
  fitbitConnected: false,
};

export function initialState(personaId = "alex"): AppState {
  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  return {
    onboarded: false,
    profile: DEFAULT_PROFILE,
    sessions: persona.sessions,
    todayIndex: 2, // Wednesday: a stable "mid-week" for demos
    chosenPlan: null,
    chat: [],
    personaId: persona.id,
    syncCount: 0,
  };
}

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "completeOnboarding"; profile: UserProfile }
  | { type: "updateProfile"; patch: Partial<UserProfile> }
  | { type: "addSession"; session: Omit<Session, "id"> }
  | { type: "removeSession"; id: string }
  | { type: "syncFitbit" }
  | { type: "choosePlan"; kind: PlanKind | null }
  | { type: "setToday"; index: number }
  | { type: "loadPersona"; personaId: string }
  | { type: "addMessage"; message: ChatMessage }
  | { type: "updateMessage"; id: string; text: string; suggestions?: string[] }
  | { type: "reset" };

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "completeOnboarding":
      return { ...state, onboarded: true, profile: action.profile };
    case "updateProfile":
      return { ...state, profile: { ...state.profile, ...action.patch } };
    case "addSession":
      return { ...state, sessions: [...state.sessions, { ...action.session, id: newId("s") }] };
    case "removeSession":
      return { ...state, sessions: state.sessions.filter((s) => s.id !== action.id) };
    case "syncFitbit": {
      const next = SIMULATED_SYNCS[state.syncCount % SIMULATED_SYNCS.length];
      return {
        ...state,
        syncCount: state.syncCount + 1,
        sessions: [...state.sessions, { ...next, id: newId("fb"), dayIndex: state.todayIndex }],
      };
    }
    case "choosePlan":
      return { ...state, chosenPlan: action.kind };
    case "setToday":
      return { ...state, todayIndex: action.index };
    case "loadPersona": {
      const fresh = initialState(action.personaId);
      return { ...state, sessions: fresh.sessions, personaId: fresh.personaId, syncCount: 0, chosenPlan: null };
    }
    case "addMessage":
      return { ...state, chat: [...state.chat, action.message] };
    case "updateMessage":
      return {
        ...state,
        chat: state.chat.map((m) => (m.id === action.id ? { ...m, text: action.text, suggestions: action.suggestions ?? m.suggestions } : m)),
      };
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
      if (saved) dispatch({ type: "hydrate", state: { ...initialState(), ...saved } });
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    if (hydrated.current) repository.save(state);
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
