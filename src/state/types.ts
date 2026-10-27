import type { WeekRecord } from "../data/mockFitbit";
import type { Session } from "../lib/met";
import type { Medal } from "../lib/medals";
import type { WeekPlan } from "../lib/plan";
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
}

/** Set by a clinician in the Clinician tab, during a visit. Overrides the defaults. */
export interface ClinicianSettings {
  goal: number | null;
  noVigorous: boolean;
  maxSessionMin: number | null;
  /** Shown to the user on Today */
  note: string;
  /** The goal template's other fields. Optional so older saves still load. */
  name?: string;
  role?: string;
  reason?: string;
  review?: string;
  precautions?: string;
  /** ISO time the clinician last saved */
  updated?: string;
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
}

export interface CheckIn {
  minutes: number;
  place: Place;
  energy: Energy;
  mood: string;
}

export type TodayStep =
  | "time" | "place" | "energy" | "mood"
  | "suggested" | "reason" | "remind" | "reminded"
  | "accepted" | "confirm" | "confirm-other" | "nudge" | "wrap";

export interface TodayEntry {
  id: string;
  role: "agent" | "user" | "medal";
  text: string;
  medal?: Medal;
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

export type Screen = "onboarding" | "today" | "progress" | "coach" | "clinician" | "showcase";
export type Overlay = null | "prefs";

export interface AppState {
  version: 2;
  onboarded: boolean;
  profile: UserProfile;
  clinician: ClinicianSettings;
  /** The user's own weekly goal in MET-hours (a clinician goal overrides it) */
  goal: number;
  goalSource: "default" | "recap";
  plan: WeekPlan;
  sessions: Session[];
  history: WeekRecord[];
  declines: DeclineRecord[];
  notes: NoteRecord[];
  /** Today, as an index into the demo week (0 = Monday) */
  todayIndex: number;
  today: TodayState;
  chat: ChatMessage[];
  personaId: string;
  syncCount: number;
  /** "Something hurts" reports, for the clinician's flags */
  painReports: number;
  overlay: Overlay;
  toast: string | null;
  recapHandled: boolean;
}
