import type { CategoryPrefs } from "../lib/categories";
import type { EquipmentProfile, WeekRecord } from "../data/mockFitbit";
import type { Session } from "../lib/met";
import type { Video } from "../lib/moves";
import type { ClinicianNote } from "../lib/clinicianNotes";
import type { DaySource, WeekPlan } from "../lib/plan";
import type { Access, Constraint, DeclineReason, Energy, Place, Suggestion } from "../lib/suggest";
import type { TableActivity } from "../lib/tableActivities";

/** Who last changed the weekly goal, on which day of the app ("YYYY-MM-DD"), and the agent's reason. */
export interface GoalSet {
  by: "user" | "agent";
  on: string;
  /** For the agent's offers: the rule that triggered it, e.g. "You were under half your goal 3 weeks in a row." */
  reason?: string;
  from: number;
}

/** The app's built-in list of 15 activities, or the activity table through the backend. */
export type SuggestSource = "library" | "table";

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
  /** Connected to the user's real Fitbit through the backend (Google Health API). Missing or false: simulated. */
  fitbitLive?: boolean;
  /** Equipment at home and at the gym. Missing on older saves: then nothing is filtered by equipment. */
  equipment?: EquipmentProfile;
  /**
   * The user's 👍 / 👎 on the activity table's categories ("Bicycling", "Dancing", …), set in
   * onboarding or on the Settings tab. A category not listed has no preference. Missing on older saves.
   */
  categoryPrefs?: CategoryPrefs;
  /**
   * Activity-table rows the user accepted, by check-in place, as Compendium codes, first accepted
   * first. Sent as picked_codes when Today's suggestions come from the table, for that place only,
   * so each place learns from its own feedback. Missing on older saves.
   */
  pickedCodes?: Partial<Record<Place, string[]>>;
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
  /** Where the user was checking in from. Missing on declines saved before places were recorded. */
  place?: Place;
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
  // The first time Today opens after onboarding: the weekly goal, then the weekly plan.
  | "setup-goal" | "setup-plan"
  | "time-confirm" | "time" | "place" | "energy" | "mood"
  | "suggested" | "reason" | "remind" | "reminded"
  | "accepted" | "confirm" | "confirm-other" | "nudge" | "wrap"
  // The user's own exercise, after five options or when nothing fits: what, how long, did or plan.
  | "own" | "own-minutes" | "own-confirm";

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
  /** Missing on rewind points saved before the goal could be set in Today */
  goal?: number;
  goalSource?: AppState["goalSource"];
  goalSet?: GoalSet;
  weekSetup?: boolean;
}

export interface TodayState {
  /** Which demo day this flow belongs to; a new day starts a new check-in */
  dayKey: string;
  /** How-to videos already shown for the current pick, so "Show me how" moves on to the next move */
  howShown?: number;
  step: TodayStep;
  checkIn: Partial<CheckIn>;
  entries: TodayEntry[];
  exclude: string[];
  constraint?: Constraint;
  boost: boolean;
  /** How many options "Give me another option" has passed over since the last reason (capped by MAX_PASSES) */
  passed?: number;
  /** The exercise the user named themselves: what they typed, its table matches (best first) and minutes */
  own?: { text: string; codes: string[]; minutes?: number };
  current?: {
    lead: Suggestion;
    backups: Suggestion[];
    desk: boolean;
    showBackups: boolean;
    /** How many times "Give me another option" has moved through this set (the lead and its backups) */
    seen?: number;
    /** The option just passed over with "Give me another option": the user may say why (optional) */
    skipped?: Suggestion;
    /** Who picked it: the in-app ranker, or Jev via the backend (live or mocked) */
    source?: "rules" | "jev" | "mock";
    /**
     * Waiting for the backend's pick from the activity table: the card says "Finding one for
     * you…" until it arrives, or shows the ranker's pick if the backend fails or is too slow.
     */
    pending?: boolean;
    /** With the backend: no pick came back. The card offers to try again instead of showing the ranker's pick. */
    failed?: boolean;
    /** The prompt sent to Jev and its answers, for the demo panel */
    jev?: { model: string; logId: number; request: unknown; answers: unknown };
  };
  accepted?: Suggestion;
  /** When the user asked to be reminded about the current pick ("in 1 hour") */
  reminder?: string;
  pendingSessionId?: string;
  nudged: boolean;
}

export type Screen = "onboarding" | "today" | "progress" | "chat" | "summary" | "showcase" | "settings";
export type Overlay = null | "prefs";

export interface AppState {
  version: 2;
  onboarded: boolean;
  profile: UserProfile;
  clinician: ClinicianNotes;
  /** The user's weekly goal in MET-hours. Only the user changes it (typing it, or accepting the agent's offer). */
  goal: number;
  /** default: the 7.5 guideline · recap: the agent's offer, accepted · user: typed or stepped by the user */
  goalSource: "default" | "recap" | "user";
  /** When and why the goal last changed, shown beside it. Missing: the default, or an older save. */
  goalSet?: GoalSet;
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
  /** Monday of the real week, "2026-11-16", once a real Fitbit has synced */
  fitbitWeek?: string;
  /** Fitbit workouts the user said weren't exercise, so a later sync doesn't bring them back */
  removedFitbitIds?: string[];
  /** Where Today's suggestions come from; missing means the build setting (VITE_SUGGEST_SOURCE) */
  suggestSource?: SuggestSource;
  /** Activity-table rows the backend has suggested, by code, so a reload still knows them */
  tableActivities?: Record<string, TableActivity>;
  /** "Something hurts" reports, for the Summary tab's things to mention */
  painReports: number;
  overlay: Overlay;
  toast: string | null;
  recapHandled: boolean;
  /**
   * True from the end of onboarding until the user has set the weekly goal and plan in Today's
   * first conversation. Missing (older saves, demo personas): already set up.
   */
  weekSetup?: boolean;
}
