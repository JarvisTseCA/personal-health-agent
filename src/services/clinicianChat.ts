/**
 * The Chat turns that take in feedback from the user's clinician.
 *
 *  - "Add feedback from my clinician" (a starter chip, the Summary tab's
 *    button, or typed): the agent asks what the clinician said, and the next
 *    message is saved as a note.
 *  - "My doctor said to keep it moderate and add strength": saved directly.
 *  - "Add strength training": after the agent offers it.
 *
 * Everything else goes to the normal (scripted) agent. Pure: takes the state
 * and the text, returns the new state with the user's message and the reply
 * appended, so the reducer and the tests share it.
 */
import { getFamily } from "../lib/activities";
import { guidanceOf, isAddFeedbackRequest, isClinicianReport, quote, type ClinicianNote } from "../lib/clinicianNotes";
import { fmtGoal } from "../lib/met";
import type { AppState, ChatMessage } from "../state/types";

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const ASK_PROMPT =
  "Sure. What did your clinician say? Type it in your own words, for example: \"Keep to moderate exercise for now and add two strength days a week.\" " +
  "I'll save it and use it when I suggest workouts.";

const CANCEL = /^\s*(never ?mind|cancel|nothing|no|nope|not now|skip|forget it)\b/i;
const ADD_STRENGTH = /\b(add|yes)\b.*\bstrength\b|^\s*yes,? add (it|strength)/i;

export type ClinicianTurnKind = "ask" | "save" | "cancel" | "add-strength";

/** Which clinician turn this message is, if any. */
export function clinicianTurnKind(state: AppState, text: string): ClinicianTurnKind | null {
  const lastAgent = [...state.chat].reverse().find((m) => m.role === "agent");
  if (lastAgent?.kind === "ask-clinician") return CANCEL.test(text) ? "cancel" : "save";
  if (lastAgent?.kind === "offer-strength" && ADD_STRENGTH.test(text) && !state.profile.enjoyed.includes("strength")) return "add-strength";
  if (isAddFeedbackRequest(text)) return "ask";
  if (isClinicianReport(text)) return "save";
  return null;
}

/** The note as it's saved: "My doctor said to keep it moderate" keeps the whole sentence. */
function noteText(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** What the agent says after saving a note: what it will do with it, only what it actually does. */
export function savedReply(state: AppState, note: ClinicianNote): { text: string; suggestions: string[]; kind?: ChatMessage["kind"] } {
  const g = guidanceOf([note]);
  const lines = [`Thanks, I've saved this from your clinician: "${quote(note.text)}"`];
  let kind: ChatMessage["kind"];
  const suggestions = ["What should I do today?"];
  if (g.moderateOnly) lines.push("I'll keep my suggestions to moderate activity (nothing at 6 MET or more) while this note is saved.");
  if (g.strength) {
    if (state.profile.enjoyed.includes("strength")) {
      lines.push("I'll suggest strength training more often.");
    } else {
      lines.push(`Strength training isn't on your list of activities yet. Want me to add it?`);
      suggestions.unshift("Add strength training");
      kind = "offer-strength";
    }
  }
  if (g.gradual) lines.push("I'll keep that in mind and help you build up gradually.");
  if (g.warningSigns) lines.push("If you notice any of those warning signs, stop and contact your clinician right away.");
  if (g.goal) {
    const min = Math.round((state.goal / 3) * 60);
    lines.push(`Your weekly goal is still ${fmtGoal(state.goal)} MET-hours (about ${min} minutes of brisk activity). If you and your clinician agreed on a different goal, you can change it on Progress.`);
  }
  if (lines.length === 1) lines.push("I'll keep it in mind when I suggest workouts and answer your questions.");
  lines.push("You can see or remove saved notes on the Summary tab.");
  return { text: lines.join("\n\n"), suggestions, kind };
}

/** Apply a clinician turn: append the user's message and the agent's reply, and save the note if there is one. */
export function applyClinicianTurn(state: AppState, text: string, now = new Date()): AppState {
  const kind = clinicianTurnKind(state, text);
  if (!kind) return state;
  const user: ChatMessage = { id: id("u"), role: "user", text: text.trim(), at: now.getTime() };
  const reply = (t: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: id("a"), role: "agent", text: t, ...extra });

  switch (kind) {
    case "ask":
      return { ...state, chat: [...state.chat, user, reply(ASK_PROMPT, { kind: "ask-clinician" })] };
    case "cancel":
      return { ...state, chat: [...state.chat, user, reply("No problem. You can add your clinician's feedback any time from here or the Summary tab.", { suggestions: ["What should I do today?"] })] };
    case "add-strength": {
      const profile = { ...state.profile, enjoyed: [...state.profile.enjoyed, "strength"], access: { ...state.profile.access, strength: state.profile.access.strength ?? "have" } };
      const msg = `Done. I've added ${getFamily("strength").noun} to your activities, and I'll suggest it more often while your clinician's note is saved. You can reorder or remove it in Preferences.`;
      return { ...state, profile, chat: [...state.chat, user, reply(msg, { suggestions: ["What should I do today?"] })] };
    }
    case "save": {
      const note: ClinicianNote = { id: id("cn"), text: noteText(text), at: now.toISOString() };
      const next = { ...state, clinician: { entries: [...state.clinician.entries, note] } };
      const r = savedReply(next, note);
      return { ...next, chat: [...next.chat, user, reply(r.text, { suggestions: r.suggestions, kind: r.kind })] };
    }
  }
}
