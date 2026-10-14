import type { Session } from "../lib/guideline";
import type { PlanKind } from "../lib/planner";

/** Everything we know about the user. Later this lives in the database. */
export interface UserProfile {
  name: string;
  /** Minutes the user said they have free this week */
  weeklyTimeMin: number;
  /** Activity family ids, in the order the user picked them (first = favorite) */
  enjoyedFamilyIds: string[];
  /** User reported a health condition → suggest checking with a clinician before vigorous activity */
  hasHealthCondition: boolean;
  fitbitConnected: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Optional suggested replies shown under an agent message */
  suggestions?: string[];
}

export type Screen = "onboarding" | "week" | "plan" | "coach" | "showcase";

export interface AppState {
  onboarded: boolean;
  profile: UserProfile;
  sessions: Session[];
  /** Today, as an index into the demo week (0 = Monday) */
  todayIndex: number;
  chosenPlan: PlanKind | null;
  chat: ChatMessage[];
  personaId: string;
  syncCount: number;
}
