import type { EquipmentProfile, WeekRecord } from "../data/mockFitbit";
import type { Session } from "../lib/met";
import type { Video } from "../lib/moves";
import type { ClinicianNote } from "../lib/clinicianNotes";
import type { DaySource, WeekPlan } from "../lib/plan";
import type { Access, Constraint, DeclineReason, Energy, Place, Suggestion } from "../lib/suggest";

export type UsualTime = "under1" | "1to2" | "2to3" | "3plus";

/** Everything we know about the user. Later this lives in the database. */
export interface UserProfile {
  name: string;
  /** Activity family ids the user enjoys, favorite first */
  enjoyed: string[];
  access: Record<string, Access>;
  usualTime: UsualTime;
  /** Set at onboarding or by a "something hurts" decline: no vigorous suggestions */
  hasHealthCondition: boolean;
  fitbitConnected: boolean;
  /** Equipment at home and at the gym. Missing on older saves: then nothing is filtered by equipment. */
  equipment?: EquipmentProfile;
}

/**
 * Feedback from the user's clinician, as the user typed it in Chat. Context
 * for the agent (see lib/clinicianNotes.ts); it never changes the user's goal.
 */
export interface ClinicianNotes {
  entries: ClinicianNote[];
}

/** One "not today" the coach remembers. `day` is relative to this week's Monday. */
export interface DeclineRecord {
  id: string;
  familyId: string;
  reason: DeclineReason;
  day: number;
  note?: string;
}

/** Something the user typed that the app couldn't turn into a choice. The coach keeps it. */
export interface NoteRecord {
  id: string;
  text: string;
  /** Where it was typed, e.g. "Onboarding: health" or "Today: mood" */
  where: string;
  day: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** When it was sent (ms since epoch) */
  at?: number;
  /** Optional suggested replies shown under an agent message */
  suggestions?: string[];
  /** An agent message waiting for a specific answer: the clinician's feedback, or yes to adding strength */
  kind?: "ask-clinician" | "offer-strength";
}

export interface CheckIn {
  minutes: number;
  place: Place;
  energy: Energy;
  mood: string;
}

export type TodayStep =
  | "time-confirm" | "time" | "place" | "energy" | "mood"
  | "suggested" | "reason" | "remind" | "reminded"
  | "accepted" | "confirm" | "confirm-other" | "nudge" | "wrap";

export interface TodayEntry {
  id: string;
  role: "agent" | "user" | "trophy";
  text: string;
  /** An agent message that teaches a move with a video */
  video?: Video;
  /** When it was sent (ms since epoch) */
  at?: number;
  /** On a user answer: the app as it was just before it, so the pencil can go back to that question */
  rewind?: TodayRewind;
}

/** Everything a Today answer can change, as it was before the answer. */
export interface TodayRewind {
  /** How many conversation entries came before the answer */
  entryCount: number;
  today: Omit<TodayState, "entries">;
  /** Missing on rewind points saved before "Off" could change the plan */
  plan?: WeekPlan;
  /** Missing on rewind points saved before calendar blocks */
  planSource?: DaySource[];
  sessions: Session[];
  declines: DeclineRecord[];
  profile: UserProfile;
  notes: NoteRecord[];
  painReports: number;
  syncCount: number;
}

export interface TodayState {
  /** Which demo day this flow belongs to; a new day starts a new check-in */
  dayKey: string;
  /** How-to videos already shown for the current pick, so "Show me how" moves on to the next move */
  howShown?: number;
  step: TodayStep;
  checkIn: Partial<CheckIn>;
  /** What the user typed for place, when it wasn't one of the options */
  placeLabel?: string;
  entries: TodayEntry[];
  exclude: string[];
  constraint?: Constraint;
  boost: boolean;
  current?: {
    lead: Suggestion;
    backups: Suggestion[];
    desk: boolean;
    showBackups: boolean;
    /** Who picked it: the in-app ranker, or Jev via the backend (live or mocked) */
    source?: "rules" | "jev" | "mock";
    /** The prompt sent to Jev and its answers, for the demo panel */
    jev?: { model: string; logId: number; request: unknown; answers: unknown };
  };
  accepted?: Suggestion;
  /** When the user asked to be reminded about the current pick ("in 1 hour") */
  reminder?: string;
  pendingSessionId?: string;
  nudged: boolean;
}

export type Screen = "onboarding" | "today" | "progress" | "chat" | "summary" | "showcase";
export type Overlay = null | "prefs";

export interface AppState {
  version: 2;
  onboarded: boolean;
  profile: UserProfile;
  clinician: ClinicianNotes;
  /** The user's weekly goal in MET-hours. Only the user changes it. */
  goal: number;
  goalSource: "default" | "recap";
  plan: WeekPlan;
  /** Where each day's time came from: the weekly plan, or an exercise block the user edited on their calendar */
  planSource: DaySource[];
  sessions: Session[];
  history: WeekRecord[];
  /** Days this week the user opened the app (today is added when the day starts) */
  signIns: boolean[];
  /** Fitbit's monthly VO2 max estimates, oldest first, ending this month */
  vo2: number[];
  declines: DeclineRecord[];
  notes: NoteRecord[];
  /** Today, as an index into the demo week (0 = Monday) */
  todayIndex: number;
  today: TodayState;
  chat: ChatMessage[];
  personaId: string;
  syncCount: number;
  /** "Something hurts" reports, for the Summary tab's things to mention */
  painReports: number;
  overlay: Overlay;
  toast: string | null;
  recapHandled: boolean;
}
