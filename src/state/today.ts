/**
 * The daily loop from the workflow doc, as pure state transitions:
 *
 *   1 Check in (time, place, energy, mood)
 *   2 Suggest one pick + 2 backups → accept, or "not today" + a reason → new pick
 *   3 Questions at any point (answered from answers.ts)
 *   4 Workout → Fitbit sync → confirm if unsure → credit, medals, "keep going"
 *
 * Every function takes the whole AppState and returns a new one, so the
 * reducer stays a thin switch and this file can be unit-tested.
 */
import { UNPLANNED_BOUTS } from "../data/mockFitbit";
import { getFamily, getVariant, PICKABLE } from "../lib/activities";
import type { Medal } from "../lib/medals";
import { countsTowardGoal, fmt, fmtGoal, minutesFor, UNCONFIRMED_MET, withCredit, type Session } from "../lib/met";
import { WEEKLY_UPPER_LIMIT } from "../lib/goal";
import { afterDecline, DECLINE_LABEL, suggest, type DeclineReason, type Energy, type Place, type Suggestion } from "../lib/suggest";
import { matchActivity, parseEnergy, parseMinutes, parsePlace, parseReason, parseYesNo } from "../lib/freeText";
import { answer, QUESTIONS, type QuestionId } from "../services/answers";
import { SCRIPTED_REPLIES } from "../services/mockResponses";
import { buildAgentContext, buildSuggestInput } from "../services/context";
import type { AppState, TodayEntry, TodayState } from "./types";

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const agent = (text: string): TodayEntry => ({ id: newId("a"), role: "agent", text });
const user = (text: string): TodayEntry => ({ id: newId("u"), role: "user", text });

function push(state: AppState, ...entries: TodayEntry[]): AppState {
  return { ...state, today: { ...state.today, entries: [...state.today.entries, ...entries] } };
}
function setToday(state: AppState, patch: Partial<TodayState>): AppState {
  return { ...state, today: { ...state.today, ...patch } };
}

export const dayKeyOf = (s: Pick<AppState, "personaId" | "todayIndex">) => `${s.personaId}:${s.todayIndex}`;

/** A fresh check-in for the current demo day. */
export function startDay(state: AppState): AppState {
  const ctx = buildAgentContext(state);
  const off = state.plan[state.todayIndex] === "off";
  let opener: string;
  if (ctx.week.done + 1e-9 >= ctx.goal) {
    opener = `You've reached this week's goal, so every medal is gold. Anything today is a bonus. How much time do you have?`;
  } else if (off) {
    opener = `Today is marked off, so there's no target. Got a few minutes anyway? Any activity keeps your ${ctx.streak.current}-day streak going.`;
  } else {
    opener = `You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours this week. Today's target is ${fmt(ctx.todayTarget)}. How much time do you have today?`;
  }
  return {
    ...state,
    today: { dayKey: dayKeyOf(state), step: "time", checkIn: {}, entries: [agent(opener)], exclude: [], boost: false, nudged: false },
  };
}

export const TIME_OPTIONS: Array<[string, number]> = [["0 min", 0], ["10 min", 10], ["20 min", 20], ["30 min", 30], ["45+ min", 45]];
export const PLACE_OPTIONS: Array<[string, Place]> = [["Home", "home"], ["Office", "office"], ["Outside", "outside"], ["Traveling", "traveling"]];
export const ENERGY_OPTIONS: Array<[string, Energy]> = [["Up for a challenge", "challenge"], ["Normal", "normal"], ["Low energy", "low"]];

export function answerTime(state: AppState, label: string, minutes: number): AppState {
  let s = push(state, user(label));
  s = setToday(s, { checkIn: { ...s.today.checkIn, minutes } });
  if (minutes === 0) {
    // No time: skip the rest of the check-in and go straight to desk moves.
    s = setToday(s, { checkIn: { ...s.today.checkIn, place: "office", energy: "normal", mood: "surprise" } });
    return offer(push(s, agent("No free time today? Here's something you can do at your desk. It still earns today's bronze.")));
  }
  return setToday(push(s, agent("Where are you?")), { step: "place" });
}

export function answerPlace(state: AppState, label: string, place: Place): AppState {
  const s = push(state, user(label));
  return setToday(push(s, agent("How do you feel?")), { step: "energy", checkIn: { ...s.today.checkIn, place } });
}

export function answerEnergy(state: AppState, label: string, energy: Energy): AppState {
  const s = push(state, user(label));
  return setToday(push(s, agent("Anything you're in the mood for?")), { step: "mood", checkIn: { ...s.today.checkIn, energy } });
}

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
    s = push(s, agent("Nothing on your list fits right now. Here's something small that still earns today's bronze."));
  } else if (intro) {
    s = push(s, agent(intro));
  }
  return setToday(s, { step: "suggested", current: { lead: r.lead!, backups: r.backups, desk: r.desk, showBackups: false } });
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
  const s = push(state, user(typed ?? (state.today.current?.lead === which ? "Let's do it" : `I'll do ${describe(which)}`)));
  return setToday(push(s, agent(`Nice. ${describe(which).replace(/^./, (c) => c.toUpperCase())}. I'll watch for it on your Fitbit and count it when it syncs.`)), {
    step: "accepted", accepted: which,
  });
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
      .map((x) => (x.variantId === "desk-stretch" ? { ...x, durationMin: 10, pattern: "A 10-minute gentle stretch", reasons: ["Gentle", "Earns today's bronze"] } : x));
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

function todayMedal(state: AppState): Medal {
  return buildAgentContext(state).medals[state.todayIndex];
}

/** After a session is counted: medal moment, credit line, then "keep going" or wrap up. */
function afterCredit(before: AppState, after: AppState, s: Session): AppState {
  const m0 = todayMedal(before);
  const ctx = buildAgentContext(after);
  const m1 = ctx.medals[after.todayIndex];
  const { family, variant } = getVariant(s.variantId);
  const credit = withCredit(s).credit;
  let st = after;

  if (m1 !== m0) {
    const text = m1 === "gold" ? "Gold! You reached this week's goal, so every medal this week is now gold."
      : m1 === "silver" ? "Silver: today's target is done."
      : `Bronze for today. That's a ${ctx.streak.current}-day streak.`;
    st = push(st, { id: newId("m"), role: "medal", text, medal: m1 });
  }
  st = push(st, agent(credit > 0
    ? `+${fmt(credit)} MET-hours from ${s.customName ?? family.noun}. You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} this week.`
    : `${variant.label} is light activity, so it earns the medal but not goal credit for now.`));

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

const DECLINE_WORDS = /\b(not today|no thanks|no thank|something else|don't want|dont want|can't|cannot|skip|pass|nah|no)\b/;

/**
 * The "Other" text box under every set of bubbles. Reads the typed answer for
 * the current step; anything it can't place becomes a note or a coach reply.
 */
export function freeText(state: AppState, text: string): AppState {
  const t = state.today;
  switch (t.step) {
    case "time": {
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
      const yn = parseYesNo(text);
      if (yn === true && t.current) return accept(state, t.current.lead, text);
      if (DECLINE_WORDS.test(text.toLowerCase())) {
        const reason = parseReason(text);
        if (reason === "other") return setToday(push(state, user(text), agent("No problem. What's getting in the way?")), { step: "reason", accepted: undefined });
        return chooseReason(state, reason, text);
      }
      return coachReply(state, text);
    }
    case "reason":
      return chooseReason(state, parseReason(text), text);
    case "accepted":
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
