/**
 * The daily loop from the workflow doc, as pure state transitions:
 *
 *   1 Check in (time, place, energy, mood)
 *   2 Suggest one pick + 2 backups → accept, or "not today" + a reason → new pick
 *   3 Questions at any point (answered from answers.ts)
 *   4 Workout → Fitbit sync → confirm if unsure → credit, trophy, "keep going"
 *
 * Every function takes the whole AppState and returns a new one, so the
 * reducer stays a thin switch and this file can be unit-tested.
 */
import { UNPLANNED_BOUTS } from "../data/mockFitbit";
import { getFamily, getVariant, PICKABLE } from "../lib/activities";
import { howTos } from "../lib/moves";
import { countsTowardGoal, fmt, fmtGoal, minutesFor, UNCONFIRMED_MET, withCredit, type Session } from "../lib/met";
import { WEEKLY_UPPER_LIMIT } from "../lib/goal";
import { afterDecline, DECLINE_LABEL, suggest, type DeclineReason, type Energy, type Place, type Suggestion } from "../lib/suggest";
import { matchActivity, parseEnergy, parseMinutes, parsePlace, parseReason, parseYesNo } from "../lib/freeText";
import { answer, QUESTIONS, type QuestionId } from "../services/answers";
import { SCRIPTED_REPLIES } from "../services/mockResponses";
import type { BackendSuggestion } from "../services/backend";
import { buildAgentContext, buildSuggestInput, equipmentAt } from "../services/context";
import type { AppState, TodayEntry, TodayRewind, TodayState } from "./types";

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const agent = (text: string): TodayEntry => ({ id: newId("a"), role: "agent", text });
const user = (text: string): TodayEntry => ({ id: newId("u"), role: "user", text, at: Date.now() });

function push(state: AppState, ...entries: TodayEntry[]): AppState {
  return { ...state, today: { ...state.today, entries: [...state.today.entries, ...entries] } };
}
function setToday(state: AppState, patch: Partial<TodayState>): AppState {
  return { ...state, today: { ...state.today, ...patch } };
}

export const dayKeyOf = (s: Pick<AppState, "personaId" | "todayIndex">) => `${s.personaId}:${s.todayIndex}`;

/**
 * A fresh check-in for the current demo day. Opening the app counts toward
 * the streak, so the coach greets the run when there is one. A new run after
 * a missed day just gets "welcome back": no mention of the old one.
 */
export function startDay(state: AppState): AppState {
  // Opening the app today is a sign-in.
  const signIns = Array.from({ length: 7 }, (_, i) => (i === state.todayIndex ? true : !!state.signIns?.[i]));
  let st: AppState = { ...state, signIns };
  const ctx = buildAgentContext(st);
  const off = st.plan[st.todayIndex] === "off";
  const n = ctx.streak.current;
  const hello = n >= 2 ? `Day ${n} in a row. ` : "Welcome back. ";
  let opener: string;
  if (ctx.trophy) {
    opener = `${hello}You've already earned this week's trophy, so anything today is a bonus. How much time do you have?`;
  } else if (off) {
    opener = `${hello}Today is marked off, so there's no target. Got a few minutes anyway?`;
  } else {
    opener = `${hello}You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours this week. Today's target is ${fmt(ctx.todayTarget)}. How much time do you have today?`;
  }
  const entries = [agent(opener)];
  if (st.clinician.note.trim() && !st.clinician.acknowledged) {
    const who = st.clinician.name?.trim() || "your clinician";
    entries.unshift(agent(`I've read the notes ${who} left at your visit and I'll keep them in mind. Your goals stay yours to set; change them on Progress any time.`));
    st = { ...st, clinician: { ...st.clinician, acknowledged: true } };
  }
  return {
    ...st,
    today: { dayKey: dayKeyOf(st), step: "time", checkIn: {}, entries, exclude: [], boost: false, nudged: false },
  };
}

// Traveling isn't a button: Outside covers it. Typing "hotel" or "airport" in Other still works.
// The screen hides Gym for someone who said they don't use one.
export const PLACE_OPTIONS: Array<[string, Place]> = [["Home", "home"], ["Gym", "gym"], ["Office", "office"], ["Outside", "outside"]];
// Two buttons only. Feeling tired can still be typed in Other (parsed as "low"); we don't offer it as a tap.
export const ENERGY_OPTIONS: Array<[string, Energy]> = [["Up for a challenge", "challenge"], ["Normal", "normal"]];
export const REMIND_OPTIONS = ["In 30 min", "In 1 hour", "This evening"];

export function answerTime(state: AppState, label: string, minutes: number): AppState {
  let s = push(state, user(label));
  s = setToday(s, { checkIn: { ...s.today.checkIn, minutes } });
  if (minutes === 0) {
    // No time: skip the rest of the check-in and go straight to desk moves.
    s = setToday(s, { checkIn: { ...s.today.checkIn, place: "office", energy: "normal", mood: "surprise" } });
    return offer(push(s, agent("No free time today? Here's something you can do at your desk. Every bit of movement counts.")));
  }
  return setToday(push(s, agent("Where will you be exercising?")), { step: "place" });
}

/** "Off" at the time question: today becomes a day off and its target moves to the other days. */
export function takeDayOff(state: AppState, typed?: string): AppState {
  let s = push(state, user(typed ?? "Off"));
  s = { ...s, plan: s.plan.map((x, i) => (i === s.todayIndex ? "off" : x)) };
  const ctx = buildAgentContext(s);
  const text = ctx.unplanned > 0.05
    ? "Got it, today's a day off. Rest up. There's no day left this week to move today's target to; you can add one on Progress."
    : "Got it, today's a day off. Rest up. I've moved today's target to the rest of the week.";
  return setToday(push(s, agent(text)), { step: "wrap", checkIn: { ...s.today.checkIn, minutes: 0 } });
}

export function answerPlace(state: AppState, label: string, place: Place): AppState {
  const s = push(state, user(label));
  return setToday(push(s, agent("How do you feel?")), { step: "energy", checkIn: { ...s.today.checkIn, place } });
}

/**
 * Last check-in question. No "what are you in the mood for?" step: to avoid
 * decision fatigue the coach goes straight to one pick.
 */
export function answerEnergy(state: AppState, label: string, energy: Energy): AppState {
  const s = setToday(push(state, user(label)), { checkIn: { ...state.today.checkIn, energy, mood: state.today.checkIn.mood ?? "surprise" } });
  const intro = energy === "challenge"
    ? "Let's push a little: same time, harder pace."
    : energy === "low"
      ? "Let's keep it easy today. Here's my pick."
      : "Here's my pick for today.";
  return offer(push(s, agent(intro)));
}

/** Only reached from saves made before the mood question was removed. */
export function answerMood(state: AppState, label: string, mood: string): AppState {
  const s = setToday(push(state, user(label)), { checkIn: { ...state.today.checkIn, mood } });
  return offer(push(s, agent(mood === "surprise" ? "Here's my pick for today." : `${getFamily(mood).name} it is. Here's my pick.`)));
}

/** Run the ranker and show the result as the live suggestion card. */
function offer(state: AppState, intro?: string): AppState {
  const input = buildSuggestInput(state);
  let r = suggest(input);
  let s = state;
  if (!r.lead) {
    r = suggest({ ...input, minutes: 0 });
    s = push(s, agent("Nothing on your list fits right now. Here's something small you can do anywhere."));
  } else if (intro) {
    s = push(s, agent(intro));
  }
  return setToday(s, { step: "suggested", reminder: undefined, howShown: 0, current: { lead: r.lead!, backups: r.backups, desk: r.desk, showBackups: false, source: "rules" } });
}

/**
 * Swap the ranker's pick for the backend's (Jev). Only applies while the user
 * is still looking at the pick it `replaces`; if they've moved on, it's dropped.
 */
export function applyBackendSuggestion(state: AppState, replaces: Suggestion, r: BackendSuggestion): AppState {
  const c = state.today.current;
  if (state.today.step !== "suggested" || !c || c.source !== "rules" || c.lead !== replaces) return state;
  return setToday(state, {
    current: {
      ...c, lead: r.lead, backups: r.backups, source: r.source,
      jev: { model: r.model, logId: r.logId, request: r.jevRequest, answers: r.jevAnswers },
    },
  });
}

export function showBackups(state: AppState): AppState {
  const c = state.today.current;
  return c ? setToday(push(state, user("Show other options")), { current: { ...c, showBackups: true } }) : state;
}

function describe(s: Suggestion): string {
  const { family, variant } = getVariant(s.variantId);
  return s.pattern ? `${variant.label}, ${s.pattern.toLowerCase()}` : `${s.durationMin} min of ${family.noun} (${variant.label.toLowerCase()})`;
}

export function accept(state: AppState, which: Suggestion, typed?: string): AppState {
  const s = push(state, user(typed ?? (state.today.current?.lead === which ? "Let's start" : `I'll do ${describe(which)}`)));
  return setToday(push(s, agent(`Nice. ${describe(which).replace(/^./, (c) => c.toUpperCase())}. I'll watch for it on your Fitbit and count it when it syncs.`)), {
    step: "accepted", accepted: which, reminder: undefined,
  });
}

/**
 * "Give me another option": swap in the next-ranked pick, no questions asked.
 * Cycles through the pick and its backups, so the user never hits a dead end.
 */
export function anotherOption(state: AppState, typed?: string): AppState {
  const c = state.today.current;
  if (!c) return state;
  const s = push(state, user(typed ?? "Give me another option"));
  if (c.backups.length === 0) {
    return push(s, agent("This is the only option that fits your time today. Tell me if something's in the way and I'll adjust."));
  }
  const [next, ...rest] = c.backups;
  return setToday(push(s, agent("How about this instead?")), {
    step: "suggested", reminder: undefined, howShown: 0, current: { ...c, lead: next, backups: [...rest, c.lead], showBackups: false },
  });
}

/** "Remind me later": the coach asks when. */
export function remindLater(state: AppState): AppState {
  if (!state.today.current) return state;
  return setToday(push(state, user("Remind me later"), agent("Sure. When should I remind you?")), { step: "remind" });
}

/** "in 1 hour" stays as is; "5:30" or "5pm" becomes "at 5pm". */
function whenPhrase(when: string): string {
  const w = when.trim().replace(/[.!]+$/, "");
  const lower = w.charAt(0).toLowerCase() + w.slice(1);
  return /^(in|at|this|tonight|after|before|around|by|tomorrow|later|on|when|during|once)\b/i.test(w) ? lower : `at ${w}`;
}

export function setReminder(state: AppState, when: string): AppState {
  const c = state.today.current;
  if (!c) return state;
  const s = push(state, user(when), agent(`Got it. I'll remind you ${whenPhrase(when)} about ${describe(c.lead)}.`));
  return setToday(s, { step: "reminded", reminder: whenPhrase(when) });
}

/** Demo: the reminder fires, and the same pick comes back with its three buttons. */
export function reminderDue(state: AppState): AppState {
  const c = state.today.current;
  if (!c) return state;
  return setToday(push(state, agent(`It's time: ${describe(c.lead)}. Ready?`)), { step: "suggested", reminder: undefined });
}

export function decline(state: AppState): AppState {
  const s = push(state, user(state.today.step === "accepted" ? "Change of plans" : "Not today"));
  return setToday(push(s, agent("No problem. What's getting in the way?")), { step: "reason", accepted: undefined });
}

const REASON_REPLY: Record<DeclineReason, (noun: string) => string> = {
  "no-time": () => "Then let's go short.",
  tired: () => "Let's take it easier.",
  "not-mood": (n) => `Fair enough. I'll leave ${n} out for about a week.`,
  recent: () => "Let's mix it up with a different type.",
  "no-access": (n) => `Got it. I'll leave ${n} out until you tell me it's available again.`,
  weather: () => "Let's stay inside today.",
  hurts: () => "Sorry to hear that. Let's keep today gentle, and please check with your clinician before anything vigorous. I've turned off vigorous suggestions for now.",
  other: () => "Thanks, I'll remember that.",
};

/** A decline reason, tapped or typed. Typed text is kept on the decline record. */
export function chooseReason(state: AppState, reason: DeclineReason, typed?: string): AppState {
  const cur = state.today.current?.lead;
  if (!cur) return state;
  const noun = getFamily(cur.familyId).noun;
  let s = push(state, user(typed ?? DECLINE_LABEL[reason]), agent(REASON_REPLY[reason](noun)));
  s = { ...s, declines: [...s.declines, { id: newId("d"), familyId: cur.familyId, reason, day: s.todayIndex, note: typed }] };
  if (reason === "other") {
    s = setToday(s, { exclude: [...s.today.exclude, cur.familyId] });
    return offer(s, "Here's another idea.");
  }

  const { constraint, excludeFamily, minutes } = afterDecline(reason, cur, s.today.constraint);
  const exclude = excludeFamily ? [...s.today.exclude, cur.familyId] : s.today.exclude;
  const checkIn = minutes !== undefined ? { ...s.today.checkIn, minutes: (s.today.checkIn.minutes ?? 30) <= minutes ? 0 : minutes } : s.today.checkIn;
  s = setToday(s, { constraint, exclude, checkIn });
  if (reason === "no-access") s = { ...s, profile: { ...s.profile, access: { ...s.profile.access, [cur.familyId]: "no" } } };
  if (reason === "hurts") {
    s = { ...s, painReports: s.painReports + 1, profile: { ...s.profile, hasHealthCondition: true } };
    // Rest or gentle mobility only.
    const desk = suggest({ ...buildSuggestInput(s), minutes: 0 });
    const gentle = [desk.lead!, ...desk.backups]
      .filter((x) => x.met < 3)
      .sort((a, b) => a.met - b.met)
      .map((x) => (x.variantId === "desk-stretch" ? { ...x, durationMin: 10, pattern: "A 10-minute gentle stretch", reasons: ["Gentle", "Easy on your body"] } : x));
    return setToday(s, { step: "suggested", current: { lead: gentle[0], backups: gentle.slice(1), desk: true, showBackups: false } });
  }
  return offer(s, "How about this instead?");
}

export function wantMore(state: AppState): AppState {
  const s = setToday(push(state, user("I want more today")), {
    boost: true, checkIn: { ...state.today.checkIn, minutes: Math.max(state.today.checkIn.minutes ?? 30, 45) },
  });
  return offer(s, "Love it. Here's a bigger option; I'll lower the rest of the week to match.");
}

export function ask(state: AppState, q: QuestionId): AppState {
  const ctx = buildAgentContext(state);
  const s = state.today.accepted ?? state.today.current?.lead;
  return push(state, user(QUESTIONS[q]), agent(answer(q, ctx, s)));
}

/** After a session is counted: credit line, the trophy when the week's goal is reached, then "keep going" or wrap up. */
function afterCredit(before: AppState, after: AppState, s: Session): AppState {
  const had = buildAgentContext(before).trophy;
  const ctx = buildAgentContext(after);
  const { family, variant } = getVariant(s.variantId);
  const credit = withCredit(s).credit;
  let st = after;

  st = push(st, agent(credit > 0
    ? `+${fmt(credit)} MET-hours from ${s.customName ?? family.noun}. You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} this week.`
    : `${variant.label} is light activity, so it doesn't count toward the goal for now, but it all helps.`));
  if (ctx.trophy && !had) {
    st = push(st, { id: newId("t"), role: "trophy", text: `Trophy earned! You reached this week's goal of ${fmtGoal(ctx.goal)} MET-hours. That's ${ctx.trophies} ${ctx.trophies === 1 ? "trophy" : "trophies"} so far.` });
  }

  const t = ctx.todayTarget;
  const d = ctx.todayDone;
  const limitHit = WEEKLY_UPPER_LIMIT !== null && ctx.week.done >= WEEKLY_UPPER_LIMIT;
  if (!st.today.nudged && t > 0 && d < t && d >= t * 0.5 && !limitHit && countsTowardGoal(variant.met)) {
    const more = minutesFor(variant.met, t - d);
    st = push(st, agent(`You're at ${Math.round((d / t) * 100)}% of today's target. ${more} more minutes of ${s.customName ?? family.noun} finishes it.`));
    return setToday(st, { step: "nudge", nudged: true, accepted: { familyId: family.id, variantId: variant.id, durationMin: more, met: variant.met, credit: (variant.met * more) / 60, rawMetHours: (variant.met * more) / 60, reasons: [], score: 0 } });
  }
  const wrap = d + 1e-9 >= t || t === 0
    ? "That's today done. I've re-planned the rest of your week."
    : "Every bit counts. The rest of the week's targets just adjusted.";
  return setToday(push(st, agent(wrap)), { step: "wrap", accepted: undefined });
}

/** "Sync Fitbit" in the demo: either the planned workout, or a bout the coach has to ask about. */
export function sync(state: AppState): AppState {
  const acc = state.today.step === "accepted" ? state.today.accepted : undefined;
  if (acc) {
    const s: Session = { id: newId("fb"), variantId: acc.variantId, durationMin: acc.durationMin, dayIndex: state.todayIndex, source: "fitbit", confirmed: true, startTime: "6:10 pm" };
    let st = { ...state, syncCount: state.syncCount + 1, sessions: [...state.sessions, s] };
    st = push(st, agent(`Fitbit synced: ${acc.durationMin} min at 6:10 pm, matching your plan, so I logged it.`));
    return afterCredit(state, st, s);
  }
  const bout = UNPLANNED_BOUTS[state.syncCount % UNPLANNED_BOUTS.length];
  const s: Session = {
    id: newId("fb"), variantId: bout.guessVariantId, durationMin: bout.durationMin, dayIndex: state.todayIndex, source: "fitbit",
    confirmed: false, band: bout.band, startTime: bout.startTime, avgHeartRate: bout.avgHeartRate,
  };
  const { family } = getVariant(bout.guessVariantId);
  let st = { ...state, syncCount: state.syncCount + 1, sessions: [...state.sessions, s] };
  st = push(st, agent(`Looks like ${bout.durationMin} min of ${family.noun} at ${bout.startTime}. Right?`));
  return setToday(st, { step: "confirm", pendingSessionId: s.id });
}

/** The variant of a family closest to what Fitbit measured. */
function nearestVariant(familyId: string, met: number): string {
  const f = getFamily(familyId);
  return [...f.variants].sort((a, b) => Math.abs(a.met - met) - Math.abs(b.met - met))[0].id;
}

export type ConfirmAnswer = "yes" | "not-exercise" | "other" | { familyId: string } | { customName: string };

export function confirm(state: AppState, answerId: ConfirmAnswer, typed?: string): AppState {
  const id = state.today.pendingSessionId;
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return state;
  if (answerId === "other") return setToday(push(state, user("Other…"), agent("What was it?")), { step: "confirm-other" });
  if (answerId === "not-exercise") {
    const st = { ...state, sessions: state.sessions.filter((x) => x.id !== id) };
    return setToday(push(st, user(typed ?? "Not exercise"), agent("Thanks, I've removed it.")), { step: "wrap", pendingSessionId: undefined });
  }
  const before = { ...state, sessions: state.sessions.filter((x) => x.id !== id) };
  let fixed: Session;
  let said: string;
  if (answerId === "yes") {
    fixed = { ...s, confirmed: true };
    said = "Yes";
  } else if ("familyId" in answerId) {
    fixed = { ...s, confirmed: true, variantId: nearestVariant(answerId.familyId, UNCONFIRMED_MET[s.band ?? "fairly"] + 1) };
    said = `It was ${getFamily(answerId.familyId).noun}`;
  } else {
    // Not in the activity list: keep their name for it, count at the bottom of the measured band.
    fixed = { ...s, confirmed: true, variantId: s.band === "very" ? "other-very" : "other-fairly", customName: answerId.customName };
    said = answerId.customName;
  }
  let st = { ...state, sessions: state.sessions.map((x) => (x.id === id ? fixed : x)) };
  st = setToday(push(st, user(typed ?? said)), { pendingSessionId: undefined });
  if (typeof answerId === "object" && "customName" in answerId) {
    st = push(st, agent(`${answerId.customName} isn't in my activity list yet, so I counted it at ${fixed.variantId === "other-very" ? "6.0" : "3.0"} MET, the bottom of what your Fitbit measured. I've noted it for the team.`));
    st = { ...st, notes: [...st.notes, { id: newId("n"), text: `Did "${answerId.customName}"`, where: "Today: confirm workout", day: st.todayIndex }] };
  }
  return afterCredit(before, st, fixed);
}

export function keepGoing(state: AppState, yes: boolean, typed?: string): AppState {
  const more = state.today.accepted;
  if (!yes || !more) {
    return setToday(push(state, user(typed ?? "Done for today"), agent("Good work today. I've re-planned the rest of your week.")), { step: "wrap", accepted: undefined });
  }
  const s: Session = { id: newId("fb"), variantId: more.variantId, durationMin: more.durationMin, dayIndex: state.todayIndex, source: "fitbit", confirmed: true, startTime: "6:50 pm" };
  const st = push({ ...state, sessions: [...state.sessions, s] }, user(typed ?? "Keep going"), agent(`Fitbit synced another ${more.durationMin} minutes.`));
  return afterCredit(state, st, s);
}

/**
 * "Show me how": the coach shares a short how-to video for the current pick,
 * one move at a time (goblet squat, then dumbbell row, …), or for the
 * activity itself (setting up a spin bike, the salsa basic step).
 */
export function showHow(state: AppState, typed?: string): AppState {
  const pick = state.today.accepted ?? state.today.current?.lead;
  if (!pick) return state;
  const here = equipmentAt(state, state.today.checkIn.place ?? "home") ?? [];
  const list = howTos(pick.variantId, here);
  const s = push(state, user(typed ?? "Show me how"));
  if (!list.length) {
    return push(s, agent(`${getFamily(pick.familyId).name} doesn't need a how-to. Start easy for the first few minutes and build up to a pace where you can talk but not sing.`));
  }
  const i = (state.today.howShown ?? 0) % list.length;
  const { what, video } = list[i];
  const next = list[(i + 1) % list.length];
  const more = list.length > 1 ? ` Tap "Show me how" again for ${next.what}.` : "";
  const entry: TodayEntry = { id: newId("v"), role: "agent", text: `Here's a short video on ${what} (${video.length}).${more}`, video };
  return setToday(push(s, entry), { howShown: i + 1 });
}

/**
 * Demo control: the example conversation where the agent teaches a move with
 * a video. Replays today's check-in as "30 min, at the gym, normal", keeps
 * the first pick that comes with a how-to video, and asks "Show me how".
 */
export function videoExample(state: AppState): AppState {
  let s = startDay(state);
  s = answerTime(s, "30 min", 30);
  s = answerPlace(s, "Gym", "gym");
  s = answerEnergy(s, "Normal", "normal");
  for (let i = 0; i < 4 && !hasHowTo(s); i++) s = anotherOption(s);
  return hasHowTo(s) ? showHow(s) : s;
}

/** Whether "Show me how" has anything to show for the current pick. */
export function hasHowTo(state: AppState): boolean {
  const pick = state.today.accepted ?? state.today.current?.lead;
  if (!pick) return false;
  return howTos(pick.variantId, equipmentAt(state, state.today.checkIn.place ?? "home") ?? []).length > 0;
}

/** Families offered under "Other…" when confirming a detected bout. */
export const CONFIRM_CHOICES = PICKABLE;

function note(state: AppState, text: string, where: string): AppState {
  return { ...state, notes: [...state.notes, { id: newId("n"), text, where, day: state.todayIndex }] };
}

/** A typed question or comment: answered by the coach (scripted in the demo), step unchanged. */
function coachReply(state: AppState, text: string): AppState {
  const ctx = buildAgentContext(state);
  const t = text.toLowerCase();
  const r = SCRIPTED_REPLIES.find((x) => x.match(t, ctx))!;
  return push(state, user(text), agent(r.reply(t, ctx)));
}

const HOW_WORDS = /\b(how (do|to|should) i|show me|video|demo|technique|form|teach me)\b/i;
const DECLINE_WORDS = /\b(not today|no thanks|no thank|something else|don't want|dont want|can't|cannot|skip|pass|nah|no)\b/;

/**
 * The "Other" text box under every set of bubbles. Reads the typed answer for
 * the current step; anything it can't place becomes a note or a coach reply.
 */
export function freeText(state: AppState, text: string): AppState {
  const t = state.today;
  switch (t.step) {
    case "time": {
      if (/\b(off|day off|sick|rest day|resting|not today)\b/i.test(text)) return takeDayOff(state, text);
      const m = parseMinutes(text);
      if (m === null) return push(state, user(text), agent("I didn't catch a time. Roughly how many minutes, like 15 or 40?"));
      return answerTime(state, text, Math.min(m, 120));
    }
    case "place": {
      const p = parsePlace(text);
      const s = answerPlace(state, text, p ?? "other");
      return p ? s : setToday(s, { placeLabel: text });
    }
    case "energy":
      return answerEnergy(state, text, parseEnergy(text));
    case "mood": {
      const fam = matchActivity(text);
      let s = setToday(push(state, user(text)), { checkIn: { ...t.checkIn, mood: fam ?? "surprise" } });
      if (!fam) {
        s = note(s, `In the mood for "${text}"`, "Today: mood");
        return offer(push(s, agent("I don't have that in my activity list yet, so I've noted it. Here's my pick for now.")));
      }
      if (!s.profile.enjoyed.includes(fam)) {
        s = { ...s, profile: { ...s.profile, enjoyed: [...s.profile.enjoyed, fam], access: { ...s.profile.access, [fam]: "have" } } };
        s = push(s, agent(`I've added ${getFamily(fam).noun} to your list.`));
      }
      return offer(push(s, agent(`${getFamily(fam).name} it is. Here's my pick.`)));
    }
    case "suggested": {
      if (HOW_WORDS.test(text) && hasHowTo(state)) return showHow(state, text);
      const yn = parseYesNo(text);
      if (yn === true && t.current) return accept(state, t.current.lead, text);
      if (/\b(another|something else|different one|other option)\b/i.test(text)) return anotherOption(state, text);
      if (/\b(remind|later)\b/i.test(text)) return remindLater(state);
      if (DECLINE_WORDS.test(text.toLowerCase())) {
        const reason = parseReason(text);
        if (reason === "other") return setToday(push(state, user(text), agent("No problem. What's getting in the way?")), { step: "reason", accepted: undefined });
        return chooseReason(state, reason, text);
      }
      return coachReply(state, text);
    }
    case "reason":
      return chooseReason(state, parseReason(text), text);
    case "remind":
      return setReminder(state, text);
    case "reminded": {
      if (parseYesNo(text) === true && t.current) return accept(state, t.current.lead, text);
      if (/\b(another|something else|different)\b/i.test(text)) return anotherOption(state, text);
      return coachReply(state, text);
    }
    case "accepted":
      if (HOW_WORDS.test(text) && hasHowTo(state)) return showHow(state, text);
      if (DECLINE_WORDS.test(text.toLowerCase())) return setToday(push(state, user(text), agent("No problem. What's getting in the way?")), { step: "reason", accepted: undefined });
      return coachReply(state, text);
    case "confirm":
    case "confirm-other": {
      const low = text.toLowerCase();
      if (/\b(not exercise|wasn't exercise|wasnt exercise|nothing|didn't|didnt|no workout)\b/.test(low)) return confirm(state, "not-exercise", text);
      const fam = matchActivity(text);
      if (fam) return confirm(state, { familyId: fam }, text);
      if (t.step === "confirm" && parseYesNo(text) === true) return confirm(state, "yes", text);
      if (t.step === "confirm" && parseYesNo(text) === false) return setToday(push(state, user(text), agent("What was it? Pick one or type it.")), { step: "confirm-other" });
      return confirm(state, { customName: text.charAt(0).toUpperCase() + text.slice(1) }, text);
    }
    case "nudge": {
      const yn = parseYesNo(text);
      if (yn !== null) return keepGoing(state, yn, text);
      return coachReply(state, text);
    }
    case "wrap":
      return coachReply(state, text);
  }
}

/**
 * Attach a rewind point to any answer this action added, so the pencil can
 * bring the user back to that question. Runs after every action; it only
 * acts when the conversation grew by appending.
 */
export function withRewind(prev: AppState, next: AppState): AppState {
  const before = prev.today.entries;
  const after = next.today.entries;
  const n = before.length;
  if (next.today.dayKey !== prev.today.dayKey || after.length <= n || (n > 0 && after[n - 1] !== before[n - 1])) return next;
  if (!after.slice(n).some((e) => e.role === "user" && !e.rewind)) return next;
  const { entries: _drop, ...today } = prev.today;
  const rewind: TodayRewind = {
    entryCount: n, today, plan: prev.plan, sessions: prev.sessions, declines: prev.declines, profile: prev.profile,
    notes: prev.notes, painReports: prev.painReports, syncCount: prev.syncCount,
  };
  const entries = after.map((e, i) => (i >= n && e.role === "user" && !e.rewind ? { ...e, rewind } : e));
  return { ...next, today: { ...next.today, entries } };
}

/** The pencil on an answer: go back to that question, as things were then. */
export function editAnswer(state: AppState, entryId: string): AppState {
  const e = state.today.entries.find((x) => x.id === entryId);
  const r = e?.rewind;
  if (!r) return state;
  return {
    ...state,
    plan: r.plan ?? state.plan, sessions: r.sessions, declines: r.declines, profile: r.profile, notes: r.notes, painReports: r.painReports, syncCount: r.syncCount,
    today: { ...r.today, entries: state.today.entries.slice(0, r.entryCount) },
  };
}
