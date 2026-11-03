/**
 * Feedback from the user's clinician, as the user tells it to the agent in
 * the Chat tab ("My doctor said to keep it moderate for now").
 *
 * The notes are context for the agent. A few kinds of advice also shape the
 * suggestions directly, always toward caution, and the agent says so when it
 * saves the note:
 *  - moderate only / avoid vigorous → nothing at 6 MET or more
 *  - strength training → strength picks get a boost (if strength is on the list)
 * The weekly goal is never changed by a note: the user changes it on Progress.
 * Removing a note (Summary or Preferences) undoes its effect.
 */

export interface ClinicianNote {
  id: string;
  /** In the user's words, as typed in Chat */
  text: string;
  /** ISO time it was saved */
  at: string;
}

export interface ClinicianGuidance {
  moderateOnly: boolean;
  strength: boolean;
  /** Mentions a goal, minutes or more/less activity */
  goal: boolean;
  /** Mentions warning signs to stop for */
  warningSigns: boolean;
  /** Mentions building up gradually */
  gradual: boolean;
}

const MODERATE = /\b(moderate|no vigorous|avoid vigorous|not vigorous|nothing vigorous|nothing too intense|avoid intense|no intense|not too intense|take it easy|go easy|low intensity|low-intensity|light to moderate|gentle|blood pressure|bp|heart)\b/;
const STRENGTH = /\b(strength|weights?|resistance|lifting|lift|muscle|squats?|push-?ups?)\b/;
const GOAL = /\b(goal|minutes?|mins?|hours?|met|150|more (exercise|activity)|less (exercise|activity)|increase|decrease|cut back)\b/;
const WARNING = /\b(chest pain|dizzy|dizziness|faint|short(ness)? of breath|palpitations?|stop (if|and)|call (me|us|if))\b/;
const GRADUAL = /\b(gradual|gradually|slowly|build up|ease (in|into)|step by step|a little more each)\b/;

export function guidanceOf(notes: ClinicianNote[]): ClinicianGuidance {
  const t = notes.map((n) => n.text.toLowerCase()).join(" \n ");
  return {
    moderateOnly: MODERATE.test(t),
    strength: STRENGTH.test(t),
    goal: GOAL.test(t),
    warningSigns: WARNING.test(t),
    gradual: GRADUAL.test(t),
  };
}

/** The user said what their clinician told them: "my doctor said…", "my PT wants me to…". */
const REPORT = /\b(my|the|our)\s+(doctor|doc|dr\.?|clinician|physician|gp|nurse|np|pa|physical therapist|physio|pt|cardiologist|provider|care team|trainer)\s*(?:[a-z.]+\s+){0,2}?(said|says|told|tells|recommended|recommends|suggested|suggests|wants|advised|advises|thinks|asked|mentioned)\b/;
/** "Doctor's advice: …", "Dr. Lee's note - …", "Note from my clinician: …" */
const REPORT_NOUN = /(\b(doctor|clinician|physician|nurse|therapist|dr\.?)('s)?|\bdr\.?\s+[a-z]+'s)\s+(note|notes|advice|feedback|recommendations?|orders?)\s*[:\-]|\b(note|notes|advice|feedback)\s+from\s+(my|the)\s+(doctor|clinician|physician|nurse|therapist|dr\.?)[^:]*:/;
const ASKING = /^\s*(what|did|does|do|can|could|should|is|are|when|why|how|has|have)\b|\?\s*$/;

/** True when the message reports the clinician's advice, rather than asking about it. */
export function isClinicianReport(text: string): boolean {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  if (ASKING.test(t)) return false;
  return REPORT.test(t) || REPORT_NOUN.test(t);
}

/** "Add feedback from my clinician" and similar, which start the guided flow. */
export function isAddFeedbackRequest(text: string): boolean {
  return /\b(add|share|enter|input|log|save|record|tell you)\b.*\b(feedback|notes?|advice)\b.*\b(clinician|doctor|dr|physician|nurse|visit)\b|\b(clinician|doctor)'?s? feedback\b\s*$/i.test(text.trim());
}

/** Short version for quoting in replies. */
export function quote(text: string, max = 160): string {
  const t = text.trim().replace(/\s*\n\s*/g, " ");
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}…` : t;
}
