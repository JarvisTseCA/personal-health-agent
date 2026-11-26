/**
 * The daily loop from the workflow doc, as pure state transitions:
 *
 *   1 Check in: confirm today's time (from the weekly plan or the calendar), then place and energy
 *   2 Suggest one pick + 2 backups → accept, or "not today" + a reason → new pick
 *   3 Questions at any point (answered from answers.ts)
 *   4 Workout → Fitbit sync → confirm if unsure → credit, trophy, "keep going"
 *
 * Every function takes the whole AppState and returns a new one, so the
 * reducer stays a thin switch and this file can be unit-tested.
 */
import { UNPLANNED_BOUTS } from "../data/mockFitbit";
import { getFamily, getVariant, PICKABLE } from "../lib/activities";
import { HISTORY_WEEKS, weekBefore, type FitbitImport } from "../lib/fitbit";
import { howTos } from "../lib/moves";
import { countsTowardGoal, DAY_NAMES_LONG, fmt, fmtGoal, minutesFor, UNCONFIRMED_MET, type Session } from "../lib/met";
import { WEEKLY_UPPER_LIMIT } from "../lib/goal";
import { ALL_FROM_PLAN, SLOT_LABEL, SLOT_MINUTES, type DaySlot } from "../lib/plan";
import { afterDecline, DECLINE_LABEL, shorterMinutes, suggest, type DeclineReason, type Energy, type Place, type Suggestion } from "../lib/suggest";
import { matchActivity, parseEnergy, parseMinutes, parsePlace, parsePlanChanges, parseReason, parseYesNo } from "../lib/freeText";
import { appDate, clampGoal } from "../lib/goalNote";
import { SCRIPTED_REPLIES } from "../services/mockResponses";
import type { BackendSuggestion } from "../services/backend";
import { buildAgentContext, buildSuggestInput, creditOf, equipmentAt, ownContext } from "../services/context";
import type { AppState, TodayEntry, TodayRewind, TodayState } from "./types";
import { codeOfTableId, isTableId, registerTable, tableId } from "../lib/tableActivities";
import { matchTable } from "../lib/tableMatch";
import { suggestSourceOf } from "./suggestSource";

let seq = 0;
/** Set while a step is run again from a mark, so it makes the ids it made the first time. */
let replayed: number | null = null;
export const newId = (prefix: string) => `${prefix}-${(replayed ?? Date.now()).toString(36)}-${(seq++).toString(36)}`;

/**
 * With the backend, a step runs twice: once to see what it changes (that is what the backend
 * is told), and once more when the backend's new numbers are in. Both runs start from the
 * same mark, so the workout the backend was told about and the one the app keeps have one id.
 */
export interface IdsMark {
  seq: number;
  stamp: number;
}
export const idsMark = (): IdsMark => ({ seq, stamp: Date.now() });
export function withIds<T>(mark: IdsMark, run: () => T): T {
  seq = mark.seq;
  replayed = mark.stamp;
  try {
    return run();
  } finally {
    replayed = null;
  }
}

const agent = (text: string): TodayEntry => ({ id: newId("a"), role: "agent", text });
const user = (text: string): TodayEntry => ({ id: newId("u"), role: "user", text, at: Date.now() });

function push(state: AppState, ...entries: TodayEntry[]): AppState {
  return { ...state, today: { ...state.today, entries: [...state.today.entries, ...entries] } };
}
function setToday(state: AppState, patch: Partial<TodayState>): AppState {
  return { ...state, today: { ...state.today, ...patch } };
}

/** No earlier day of this week is on record as opened: today is the week's first log-in. */
export function firstOpenOfWeek(state: Pick<AppState, "todayIndex" | "signIns">): boolean {
  return !(state.signIns ?? []).slice(0, state.todayIndex).some(Boolean);
}

export const dayKeyOf = (s: Pick<AppState, "personaId" | "todayIndex">) => `${s.personaId}:${s.todayIndex}`;

/** This week's sign-ins with today on record as opened. The streak counts only the days on record. */
export function openedToday(state: Pick<AppState, "todayIndex" | "signIns">): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (i === state.todayIndex ? true : !!state.signIns?.[i]));
}

/**
 * A fresh check-in for the current demo day. Opening the app counts toward
 * the streak, so the coach greets the run when there is one. A new run after
 * a missed day just gets "welcome back": no mention of the old one.
 */
export function startDay(state: AppState): AppState {
  const first = firstOpenOfWeek(state);
  // Opening the app today is a sign-in.
  const st: AppState = { ...state, signIns: openedToday(state) };
  // The week's first log-in, whatever day it is (the user may skip days): last week's recap comes
  // first, once ChatGPT has written it (weekRecap), then the week's goal and plan unless they're set.
  const recap = first && st.history.length > 0 ? { recap: "due" as const } : {};
  const ctx = buildAgentContext(st);
  // Only while nothing has counted toward this week's goal yet: once there are MET-hours, the week is under way.
  // Read from the workouts themselves, not ctx: with the backend, ctx still holds the numbers of the
  // day on screen until the backend answers, so after "Pretend today is Sunday" it would count
  // Wednesday's week.
  const unstarted = ownContext(st).week.done === 0;
  if (unstarted && (st.weekSetup || (st.onboarded && first && !st.weekPlanned))) return startSetup({ ...st, weekSetup: true }, recap);
  if (st.weekSetup) return startDay({ ...state, weekSetup: undefined });
  const off = st.plan[st.todayIndex] === "off";
  const n = ctx.streak.current;
  const hello = n >= 2 ? `Day ${n} in a row. ` : "Welcome back. ";
  let opener: string;
  if (off) {
    opener = ctx.trophy
      ? `${hello}You've already earned this week's trophy, and today is marked off. Got a few minutes anyway?`
      : `${hello}Today is marked off, so there's no target. Got a few minutes anyway?`;
  } else {
    const status = ctx.trophy
      ? "You've already earned this week's trophy, so anything today is a bonus."
      : `You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours this week. Today's target is ${fmt(ctx.todayTarget)}.`;
    opener = `${hello}${status} ${timeConfirmQuestion(st)}`;
  }
  const entries = [agent(opener)];
  return {
    ...st,
    // A planned day starts by confirming its time; an off day asks if there's any time at all.
    today: {
      dayKey: dayKeyOf(st), step: off ? "time" : "time-confirm", checkIn: {}, entries, exclude: [], boost: false, nudged: false,
      ...recap,
    },
  };
}

// --- The week's first log-in: set the weekly goal, then the weekly plan ----------------------------

/** Quick answers for the goal question: the guideline first. */
export const SETUP_GOAL_OPTIONS: Array<[string, number]> = [["7.5, the guideline", 7.5], ["5 to start", 5], ["10", 10]];
export const SETUP_PLAN_DONE = "Looks good";

const SETUP_GOAL_Q =
  "Welcome! Before your first check-in, let's set up your week. The guideline is 7.5 MET-hours a week: " +
  "about 150 minutes of moderate activity or 75 of vigorous. What weekly goal do you want? You can change it any time in Settings.";
const SETUP_PLAN_Q =
  "How much time do you have each day? Every day starts at 10 min. Change the days that are different, " +
  "and mark days you can't exercise at all as Off. Days with more time get more of the goal.";

const NEW_WEEK_PLAN_Q =
  "Here's your weekly plan. Change the days that are different this week, and mark days you can't exercise at all as Off. " +
  "Days with more time get more of the goal.";

/** A user with a past week on record is setting up a new week, not their first. */
const returning = (st: AppState) => st.history.length > 0;

function newWeekGoalQ(st: AppState): string {
  return `A new week. Let's set it up before today's check-in. Your weekly goal is ${fmtGoal(st.goal)} MET-hours: keep it, or pick another? The guideline is 7.5.`;
}

/** Quick answers for the goal question. A new week offers to keep the current goal first. */
export function setupGoalOptions(state: AppState): Array<[string, number]> {
  if (!returning(state)) return SETUP_GOAL_OPTIONS;
  return [[`Keep ${fmtGoal(state.goal)}`, state.goal], ...SETUP_GOAL_OPTIONS.filter(([, to]) => to !== state.goal)];
}

function startSetup(st: AppState, recap: Partial<TodayState> = {}): AppState {
  const q = returning(st) ? newWeekGoalQ(st) : SETUP_GOAL_Q;
  return { ...st, today: { dayKey: dayKeyOf(st), step: "setup-goal", checkIn: {}, entries: [agent(q)], exclude: [], boost: false, nudged: false, ...recap } };
}

/** The goal the user picked or typed: saved as theirs, with today's date. */
export function setupGoal(state: AppState, label: string, to: number): AppState {
  const goal = clampGoal(to);
  // Keeping the goal leaves who set it, and when, as it was.
  const kept = returning(state) && goal === state.goal;
  const s: AppState = kept ? state : { ...state, goal, goalSource: "user", goalSet: { by: "user", on: appDate(state.todayIndex), from: state.goal } };
  const said = kept ? "" : goal < 7.5 ? ` A good start; you can work up to 7.5.` : goal > 7.5 ? " Ambitious; I'll keep an eye on how it feels." : "";
  const planQ = returning(state) ? NEW_WEEK_PLAN_Q : SETUP_PLAN_Q;
  return setToday(push(s, user(label), agent(`${fmtGoal(goal)} MET-hours a week it is.${said}`), agent(planQ)), { step: "setup-plan" });
}

/** The plan is set (the grid changes it as the user taps): on to today's usual check-in. */
export function setupPlanDone(state: AppState, label: string): AppState {
  if (state.plan.every((d) => d === "off")) return push(state, user(label), agent("Pick at least one day with time, so the goal has somewhere to go."));
  const days = state.plan.filter((d) => d !== "off").length;
  const done = push(state, user(label), agent(`Your week is set: ${fmtGoal(state.goal)} MET-hours over ${days} ${days === 1 ? "day" : "days"}. Now, today.`));
  const day = startDay({ ...done, weekSetup: undefined, weekPlanned: true });
  // The recap stays where it is: asked for once, at the top.
  const { recap: _again, ...fresh } = day.today;
  return { ...day, today: { ...fresh, ...(done.today.recap ? { recap: done.today.recap } : {}), entries: [...done.today.entries, ...day.today.entries] } };
}

/** Today's planned minutes: from the weekly plan, or from the calendar block if the user edited it. */
export function plannedMinutes(state: AppState): number {
  return SLOT_MINUTES[state.plan[state.todayIndex]];
}

/**
 * The check-in doesn't ask "how much time do you have?". It confirms the time
 * the user already gave, says where it came from, and invites more:
 *   "Your weekly plan has 30 min for today. Keep it, or do you want to exercise more or less?"
 * The two buttons say what they do: "Keep 30 min" and "Pick a different time".
 */
export function timeConfirmQuestion(state: AppState): string {
  const m = plannedMinutes(state);
  const fromCalendar = state.planSource?.[state.todayIndex] === "calendar";
  if (m === 0) return "Your weekly plan has no exercise time today, just desk moves. Keep it, or do you want to exercise more?";
  const has = fromCalendar
    ? `You changed today's exercise block on your calendar to ${m} min.`
    : `Your weekly plan has ${m} min for today.`;
  return `${has} Keep it, or do you want to exercise more or less?`;
}

/** The button that keeps today's planned time: "Keep 30 min", or "Keep desk moves" on a 0-min day. */
export function keepTimeLabel(state: AppState): string {
  const m = plannedMinutes(state);
  return m > 0 ? `Keep ${m} min` : "Keep desk moves";
}
export const CHANGE_TIME_LABEL = "Pick a different time";

/** Keep today's planned time, or pick another from the time list. */
export function confirmTime(state: AppState, keep: boolean, typed?: string): AppState {
  if (keep) return answerTime(state, typed ?? keepTimeLabel(state), plannedMinutes(state));
  return setToday(push(state, user(typed ?? CHANGE_TIME_LABEL), agent("How much time do you have today?")), { step: "time" });
}

/**
 * The three places. Indoors, private: home, a hotel room. Indoors, with others: a gym, an office.
 * Outside: a park, a trail.
 */
export const PLACE_OPTIONS: Array<[string, Place]> = [
  ["Indoors, private", "indoors_private"],
  ["Indoors, with others", "indoors_with_others"],
  ["Outside", "outside"],
];
/** Asked again when a typed answer matches none of the three. */
export const PLACE_AGAIN = "Where will you be: indoors and private, indoors with others, or outside?";
// Two buttons only. Feeling tired can still be typed in Other (parsed as "low"); we don't offer it as a tap.
export const ENERGY_OPTIONS: Array<[string, Energy]> = [["Up for a challenge", "challenge"], ["Normal", "normal"]];
export const REMIND_OPTIONS = ["In 30 min", "In 1 hour", "This evening"];

/**
 * The time for today. `slot` is set when it was picked from the time list: on
 * a planned day, a different pick replaces the day's time and its calendar
 * block, and the rest of the week is re-split. Typed minutes ("25 min") count
 * for today's suggestion only.
 */
export function answerTime(state: AppState, label: string, minutes: number, slot?: DaySlot, quiet = false): AppState {
  // quiet: the user's words are already on screen (one typed answer that answers several questions).
  let s = quiet ? state : push(state, user(label));
  const i = s.todayIndex;
  if (slot && s.plan[i] !== "off" && slot !== "off" && slot !== s.plan[i]) {
    s = {
      ...s,
      plan: s.plan.map((x, d) => (d === i ? slot : x)),
      planSource: (s.planSource ?? ALL_FROM_PLAN).map((x, d) => (d === i ? "plan" : x)),
    };
    const ctx = buildAgentContext(s);
    s = push(s, agent(SLOT_MINUTES[slot] === 0
      ? "Got it. I've cleared today's exercise block from your calendar."
      : `Got it. I've changed today's exercise block on your calendar to ${SLOT_MINUTES[slot]} min, so today's target is now ${fmt(ctx.todayTarget)} MET-hours.`));
  }
  s = setToday(s, { checkIn: { ...s.today.checkIn, minutes } });
  if (minutes === 0) {
    // No time: skip the rest of the check-in and go straight to desk moves.
    s = setToday(s, { checkIn: { ...s.today.checkIn, place: "indoors_with_others", energy: "normal", mood: "surprise" } });
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

export function answerPlace(state: AppState, label: string, place: Place, quiet = false): AppState {
  const s = quiet ? state : push(state, user(label));
  return setToday(push(s, agent("How do you feel?")), { step: "energy", checkIn: { ...s.today.checkIn, place } });
}

/**
 * Last check-in question. No "what are you in the mood for?" step: to avoid
 * decision fatigue the coach goes straight to one pick.
 */
export function answerEnergy(state: AppState, label: string, energy: Energy, quiet = false): AppState {
  const s = setToday(quiet ? state : push(state, user(label)), { checkIn: { ...state.today.checkIn, energy, mood: state.today.checkIn.mood ?? "surprise" } });
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
  const r = suggest(input);
  let s = state;
  if (!r.lead) {
    // Nothing fits: ask what they'd do, rather than offer the same small desk moves again and again.
    return askOwn(s, "Nothing on my list fits right now.");
  }
  if (intro) {
    s = push(s, agent(intro));
  }
  // From the activity table: the card waits for the backend's pick ("Finding one for you…");
  // the ranker's pick is the fallback if the backend fails or is too slow.
  const pending = suggestSourceOf(s) === "table" && !r.desk;
  return setToday(s, { step: "suggested", reminder: undefined, howShown: 0, current: { lead: r.lead!, backups: r.backups, desk: r.desk, showBackups: false, source: "rules", pending } });
}

/**
 * Swap the ranker's pick for the backend's (Jev). Only applies while the user
 * is still looking at the pick it `replaces`; if they've moved on, it's dropped.
 */
export function applyBackendSuggestion(state: AppState, replaces: Suggestion, r: BackendSuggestion): AppState {
  const c = state.today.current;
  if (state.today.step !== "suggested" || !c || c.source !== "rules" || c.lead !== replaces) return state;
  let s = state;
  if (r.rows?.length) {
    // Rows from the activity table: known to getVariant from now on, and saved for a reload.
    registerTable(r.rows);
    s = { ...s, tableActivities: { ...s.tableActivities, ...Object.fromEntries(r.rows.map((row) => [row.code, row])) } };
  }
  return setToday(s, {
    current: {
      ...c, lead: r.lead, backups: r.backups, source: r.source, pending: false,
      jev: { model: r.model, logId: r.logId, request: r.jevRequest, answers: r.jevAnswers },
    },
  });
}

/** The backend didn't answer in time, or couldn't: stop waiting and show the ranker's pick. */
export function backendFailed(state: AppState, replaces: Suggestion): AppState {
  const c = state.today.current;
  if (!c?.pending || c.lead !== replaces) return state;
  return setToday(state, { current: { ...c, pending: false } });
}

/**
 * With the backend, and no pick came back: the card says so and offers to try again. The
 * in-app ranker's pick is not shown in its place, so the app's own choice never stands in
 * for the backend's.
 */
export function suggestionFailed(state: AppState, replaces: Suggestion): AppState {
  const c = state.today.current;
  if (!c?.pending || c.lead !== replaces) return state;
  return setToday(state, { current: { ...c, pending: false, failed: true } });
}

/** "Try again" on that card: wait for the backend once more. */
export function retrySuggestion(state: AppState): AppState {
  const c = state.today.current;
  if (!c?.failed) return state;
  // A fresh copy of the placeholder, so the store sees a pick it hasn't asked about yet.
  return setToday(state, { current: { ...c, lead: { ...c.lead }, pending: true, failed: false } });
}

export function showBackups(state: AppState): AppState {
  const c = state.today.current;
  return c ? setToday(push(state, user("Show other options")), { current: { ...c, showBackups: true } }) : state;
}

function describe(s: Suggestion): string {
  const { family, variant } = getVariant(s.variantId);
  if (isTableId(s.variantId)) return `${s.durationMin} min of ${family.noun}`;
  return s.pattern ? `${variant.label}, ${s.pattern.toLowerCase()}` : `${s.durationMin} min of ${family.noun} (${variant.label.toLowerCase()})`;
}

export function accept(state: AppState, which: Suggestion, typed?: string): AppState {
  const learned = isTableId(which.familyId) ? learnPicked(state, which.familyId) : learnLike(state, which.familyId);
  const s = push(learned, user(typed ?? (state.today.current?.lead === which ? "Let's start" : `I'll do ${describe(which)}`)));
  return setToday(push(s, agent(`Nice. ${describe(which).replace(/^./, (c) => c.toUpperCase())}. I'll watch for it on your Fitbit and count it when it syncs.`)), {
    step: "accepted", accepted: which, reminder: undefined,
  });
}

/**
 * An accepted activity-table row joins the codes picked before at today's place only, so each
 * place's suggestions learn from what was accepted there (picked_codes in the table request).
 */
function learnPicked(state: AppState, familyId: string): AppState {
  const place = state.today.checkIn.place;
  if (!place) return state;
  const code = codeOfTableId(familyId);
  const picked = state.profile.pickedCodes ?? {};
  const here = picked[place] ?? [];
  if (here.includes(code)) return state;
  return { ...state, profile: { ...state.profile, pickedCodes: { ...picked, [place]: [...here, code] } } };
}

/** Feedback, not a form: an accepted activity joins the user's likes (at the end, so earlier likes stay ahead). */
function learnLike(state: AppState, familyId: string): AppState {
  const p = state.profile;
  if (getFamily(familyId).fallbackOnly || p.enjoyed.includes(familyId)) return state;
  return { ...state, profile: { ...p, enjoyed: [...p.enjoyed, familyId], access: { ...p.access, [familyId]: p.access[familyId] ?? "have" } } };
}

/** Options the user can pass over with "Give me another option" before the agent asks for their own (five seen). */
export const MAX_PASSES = 4;

/**
 * "Give me another option": no question asked. The next option of the set shows (the backups, in
 * turn); once all three have been seen, a fresh set comes, leaving those three out for today.
 * Under the new option the user may say why they passed the last one (skipReason), optionally.
 * After five options the button reads "None of these work", and pressing it asks for the user's own
 * exercise, found in the activity table (askOwn). A reason given on the way starts the count again.
 */
export function anotherOption(state: AppState, typed?: string): AppState {
  const c = state.today.current;
  if (!c) return state;
  const passed = state.today.passed ?? 0;
  if (passed >= MAX_PASSES) {
    return askOwn(push(state, user(typed ?? "None of these work")), `That's ${MAX_PASSES + 1} options.`);
  }
  const s = push(state, user(typed ?? "Give me another option"));
  const seen = c.seen ?? 0;
  if (c.backups.length > 0 && seen < c.backups.length) {
    const [next, ...rest] = c.backups;
    return setToday(push(s, agent("How about this instead?")), {
      step: "suggested", reminder: undefined, howShown: 0, passed: passed + 1,
      current: { ...c, lead: next, backups: [...rest, c.lead], showBackups: false, seen: seen + 1, skipped: c.lead },
    });
  }
  // All three seen: leave them out for today and ask for a new set (the backend too, from the table).
  const shown = [c.lead, ...c.backups].map((x) => x.familyId);
  const fresh = offer(setToday(s, { exclude: [...new Set([...s.today.exclude, ...shown])] }), "Here are some different ones.");
  const nc = fresh.today.current;
  if (!nc || nc.desk || shown.includes(nc.lead.familyId)) {
    return askOwn(s, "Those are all the options that fit your time and place today.");
  }
  return setToday(fresh, { current: { ...nc, skipped: c.lead }, passed: passed + 1 });
}

/** The optional "why not that one?" after "Give me another option": the same as a decline reason for it. */
export function skipReason(state: AppState, reason: DeclineReason): AppState {
  const c = state.today.current;
  if (!c?.skipped) return state;
  return chooseReason(setToday(state, { current: { ...c, lead: c.skipped, skipped: undefined } }), reason);
}

/** What the user is asked for their own exercise; the examples show the minutes can come along. */
export const OWN_QUESTION = "What would you like to do instead? Tell me, like \"40 min badminton\", and I'll find it in the activity table.";

/**
 * The user names their own exercise: after five options, or when nothing on the list fits.
 * What they type is matched to the activity table (ownText), so it counts at the table's MET.
 */
export function askOwn(state: AppState, lead: string): AppState {
  return setToday(push(state, agent(`${lead} ${OWN_QUESTION}`)), {
    step: "own", passed: 0, reminder: undefined, own: undefined, current: undefined, accepted: undefined,
  });
}

const tableRow = (state: AppState, code: string) => state.tableActivities?.[code];

/** "40 min of badminton, social singles and doubles (5.5 MET), 3.7 MET-hours." */
function ownLine(state: AppState): string {
  const own = state.today.own!;
  const row = tableRow(state, own.codes[0])!;
  const mh = (row.met * (own.minutes ?? 0)) / 60;
  return `${own.minutes} min of ${row.label.charAt(0).toLowerCase()}${row.label.slice(1)} (${fmt(row.met)} MET), ${fmt(mh)} MET-hours`;
}

/** What the user typed at "What would you like to do instead?", matched to the activity table. */
export function ownText(state: AppState, text: string): AppState {
  let s = push(state, user(text));
  const matches = matchTable(text);
  if (matches.length === 0) {
    s = note(s, `Wanted to do "${text}", not found in the activity table`, "Today: own exercise");
    return setToday(push(s, agent("I couldn't find that in the activity table. Try another name for it, like \"cycling\" or \"weights\".")), { step: "own" });
  }
  const rows = matches.map((m) => m.row);
  registerTable(rows);
  s = { ...s, tableActivities: { ...s.tableActivities, ...Object.fromEntries(rows.map((r) => [r.code, r])) } };
  const minutes = parseMinutes(text) ?? undefined;
  s = setToday(s, { own: { text, codes: rows.map((r) => r.code), minutes: minutes && minutes > 0 ? Math.min(minutes, 240) : undefined } });
  return ownNext(s);
}

/** Ask for the minutes if they're missing, else confirm the match and ask: done, or the plan? */
function ownNext(state: AppState): AppState {
  const own = state.today.own!;
  const row = tableRow(state, own.codes[0])!;
  if (!own.minutes) {
    return setToday(push(state, agent(`In the activity table that's "${row.label}" (${fmt(row.met)} MET). How many minutes?`)), { step: "own-minutes" });
  }
  return setToday(push(state, agent(`That's ${ownLine(state)}. Have you done it already, or is it your plan for today?`)), { step: "own-confirm" });
}

export type OwnAnswer = "did" | "plan" | { code: string } | { minutes: number };

/** A tap (or typed answer) at the own-exercise steps. */
export function ownAnswer(state: AppState, answer: OwnAnswer, typed?: string): AppState {
  const own = state.today.own;
  if (!own) return state;
  if (typeof answer === "object" && "minutes" in answer) {
    if (answer.minutes <= 0) return push(state, user(typed ?? String(answer.minutes)), agent("Roughly how many minutes, like 20 or 45?"));
    return ownNext(setToday(push(state, user(typed ?? `${answer.minutes} min`)), { own: { ...own, minutes: Math.min(answer.minutes, 240) } }));
  }
  if (typeof answer === "object") {
    // Another of the matches: it goes first, and the confirmation is asked again.
    const row = tableRow(state, answer.code);
    if (!row) return state;
    const codes = [answer.code, ...own.codes.filter((c) => c !== answer.code)];
    return ownNext(setToday(push(state, user(typed ?? `It's ${row.label}`)), { own: { ...own, codes } }));
  }
  const row = tableRow(state, own.codes[0])!;
  const id = tableId(row.code);
  const pick: Suggestion = {
    familyId: id, variantId: id, durationMin: own.minutes ?? 30, met: row.met,
    credit: (row.met * (own.minutes ?? 30)) / 60, rawMetHours: (row.met * (own.minutes ?? 30)) / 60, reasons: ["Your own choice"], score: 0,
  };
  // Choosing it is feedback: at this place, it counts as picked before (as "Let's start" does).
  const learned = setToday(learnPicked(state, id), { own: undefined });
  if (answer === "plan") return setToday(accept(learned, pick, typed ?? "It's my plan"), { current: { lead: pick, backups: [], desk: false, showBackups: false, source: "rules" } });
  const session: Session = { id: newId("m"), variantId: id, durationMin: pick.durationMin, dayIndex: state.todayIndex, source: "manual", confirmed: true };
  const st = push({ ...learned, sessions: [...learned.sessions, session] }, user(typed ?? "I did it"), agent(`Logged: ${ownLine(state)}.`));
  return afterCredit(learned, st, session);
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
  // A reason is new information, so "Give me another option" may be used again.
  let s = push(setToday(state, { passed: 0 }), user(typed ?? DECLINE_LABEL[reason]), agent(REASON_REPLY[reason](noun)));
  s = { ...s, declines: [...s.declines, { id: newId("d"), familyId: cur.familyId, reason, day: s.todayIndex, note: typed, place: s.today.checkIn.place }] };
  if (reason === "other") {
    s = setToday(s, { exclude: [...s.today.exclude, cur.familyId] });
    return offer(s, "Here's another idea.");
  }

  const { constraint, excludeFamily, shorter } = afterDecline(reason, cur, s.today.constraint);
  const exclude = excludeFamily ? [...s.today.exclude, cur.familyId] : s.today.exclude;
  const checkIn = shorter ? { ...s.today.checkIn, minutes: shorterMinutes(s.today.checkIn.minutes ?? 30) } : s.today.checkIn;
  if (shorter) {
    // Say the new time in place of the general "Then let's go short."
    const m = checkIn.minutes ?? 0;
    s = { ...s, today: { ...s.today, entries: [...s.today.entries.slice(0, -1), agent(m > 0 ? `Then let's go shorter: ${m} min.` : "Then no workout today; here's something you can do at your desk.")] } };
  }
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

/** After a session is counted: credit line, the trophy when the week's goal is reached, then "keep going" or wrap up. */
function afterCredit(before: AppState, after: AppState, s: Session): AppState {
  const had = buildAgentContext(before).trophy;
  const ctx = buildAgentContext(after);
  const { family, variant } = getVariant(s.variantId);
  const credit = creditOf(after, s);
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

/**
 * "Sync Fitbit" with a real Fitbit: the user's own weeks and VO2 max replace
 * the simulated ones, workouts already synced keep what the user confirmed,
 * and today's newest workout gets the same reply as the demo sync: logged
 * when it matches the plan, otherwise "Right?". Other new workouts are
 * counted as Fitbit labelled them. Before onboarding is done nobody asks.
 */
export function syncFitbit(state: AppState, imp: FitbitImport): AppState {
  const removed = new Set(state.removedFitbitIds ?? []);
  const notRemoved = (s: Session) => !removed.has(s.id);
  // A workout the app already has keeps the user's answers: confirmed, a different activity, their name for it.
  const seen = new Map([...state.history.flatMap((w) => w.sessions), ...state.sessions].map((s) => [s.id, s]));
  const asSeen = (s: Session) => seen.get(s.id) ?? s;
  // Hand-logged workouts aren't in Fitbit, so each keeps the week it was logged in.
  // Ones logged before the first real sync belong to that sync's week.
  const manual = [
    ...state.history.flatMap((w) => w.sessions).filter((s) => s.source === "manual" && s.week),
    ...state.sessions.filter((s) => s.source === "manual").map((s) => ({ ...s, week: s.week ?? state.fitbitWeek ?? imp.week })),
  ];

  const thisWeek = imp.thisWeek.filter(notRemoved);
  const fresh = thisWeek.filter((s) => !seen.has(s.id));
  const newToday = fresh.filter((s) => s.dayIndex === imp.todayIndex);
  const newest = state.onboarded ? newToday.at(-1) : undefined;
  const sessions = [
    ...manual.filter((s) => s.week === imp.week),
    ...thisWeek.filter((s) => seen.has(s.id)).map(asSeen),
    ...fresh.filter((s) => s !== newest).map((s) => ({ ...s, confirmed: true })),
  ];

  // Earlier weeks: Fitbit's workouts with the user's answers, plus the ones logged by hand.
  const byWeek = new Map(imp.history.map((w, i) => [
    weekBefore(imp.week, imp.history.length - i),
    w.filter(notRemoved).map((s) => ({ ...asSeen(s), confirmed: true })),
  ]));
  for (const s of manual) if (s.week! < imp.week) byWeek.set(s.week!, [...(byWeek.get(s.week!) ?? []), s]);
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => byWeek.get(weekBefore(imp.week, HISTORY_WEEKS - i)) ?? []);
  const first = weeks.findIndex((w) => w.length > 0);

  const imported = new Set([...imp.thisWeek, ...imp.history.flat()].map((s) => s.id));
  let base: AppState = {
    ...state, sessions, vo2: imp.vo2, syncCount: state.syncCount + 1, fitbitWeek: imp.week,
    // Past goals and plans aren't in Fitbit; the current ones stand in for them.
    history: (first < 0 ? [] : weeks.slice(first)).map((week) => ({ goal: state.goal, plan: state.plan, sessions: week })),
    // Once a workout is older than the sync window it can't come back.
    removedFitbitIds: [...removed].filter((id) => imported.has(id)),
  };
  // With a real Fitbit the app's day is the real day, and a new week starts with no sign-ins.
  if (state.fitbitWeek && state.fitbitWeek !== imp.week) base = startDay({ ...base, todayIndex: imp.todayIndex, signIns: [], weekPlanned: undefined });
  else if (base.todayIndex !== imp.todayIndex) base = startDay({ ...base, todayIndex: imp.todayIndex });
  if (!state.onboarded) return base;
  if (!newest) {
    const earlier = fresh.length === 1 ? "1 earlier workout" : `${fresh.length} earlier workouts`;
    return push(base, agent(fresh.length ? `Fitbit synced ${earlier}. Nothing new today yet.` : "Fitbit synced. Nothing new today yet."));
  }
  const { family } = getVariant(newest.variantId);
  const acc = base.today.step === "accepted" ? base.today.accepted : undefined;
  if (acc && acc.familyId === family.id) {
    const s: Session = { ...newest, variantId: acc.variantId, confirmed: true };
    const st = push({ ...base, sessions: [...base.sessions, s] }, agent(`Fitbit synced: ${s.durationMin} min at ${s.startTime}, matching your plan, so I logged it.`));
    return afterCredit(base, st, s);
  }
  const st = push({ ...base, sessions: [...base.sessions, newest] }, agent(`Looks like ${newest.durationMin} min of ${newest.customName ?? family.noun} at ${newest.startTime}. Right?`));
  return setToday(st, { step: "confirm", pendingSessionId: newest.id });
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
    // Remember a removed Fitbit workout, or the next sync brings it back.
    const removed = s.source === "fitbit" ? [...(state.removedFitbitIds ?? []), s.id] : state.removedFitbitIds;
    const st = { ...state, sessions: state.sessions.filter((x) => x.id !== id), removedFitbitIds: removed };
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
  const here = equipmentAt(state, state.today.checkIn.place ?? "indoors_private") ?? [];
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
 * a video. Replays today's check-in as "30 min, indoors with others, normal", keeps
 * the first pick that comes with a how-to video, and asks "Show me how".
 */
export function videoExample(state: AppState): AppState {
  let s = startDay(state);
  s = answerTime(s, "30 min", 30);
  s = answerPlace(s, "Indoors, with others", "indoors_with_others");
  s = answerEnergy(s, "Normal", "normal");
  for (let i = 0; i < 4 && !hasHowTo(s); i++) s = anotherOption(s);
  return hasHowTo(s) ? showHow(s) : s;
}

/** Whether "Show me how" has anything to show for the current pick. */
export function hasHowTo(state: AppState): boolean {
  const pick = state.today.accepted ?? state.today.current?.lead;
  if (!pick) return false;
  return howTos(pick.variantId, equipmentAt(state, state.today.checkIn.place ?? "indoors_private") ?? []).length > 0;
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

/** Days of the week's plan changed during the first-time setup ("Thursday off, Saturday 45 min"). */
function changePlan(state: AppState, text: string, changes: Partial<Record<number, DaySlot>>): AppState {
  const days = Object.keys(changes).map(Number);
  const plan = state.plan.map((x, i) => changes[i] ?? x);
  return push({ ...state, plan }, user(text), agent(`Updated ${days.map((d) => `${DAY_NAMES_LONG[d]} to ${SLOT_LABEL[changes[d]!]}`).join(", ")}. Anything else? Tap "${SETUP_PLAN_DONE}" when it's right.`));
}

// --- ChatGPT on the Today tab (src/services/todayWords.ts, backend/app/today_words.py) ------------

/** What ChatGPT read from a typed answer (POST /api/today/read). Only allowed values; any may be missing. */
export interface TypedRead {
  intent?: "answer" | "question";
  minutes?: number;
  day_off?: boolean;
  keep_time?: boolean;
  place?: Place;
  energy?: Energy;
  reason?: DeclineReason;
  goal?: number;
  plan?: Partial<Record<number, DaySlot>>;
  done?: boolean;
}

/** Drop the question the agent just asked: the same typed answer already answers it. */
function answered(s: AppState): AppState {
  return s.today.entries.at(-1)?.role === "agent" ? { ...s, today: { ...s.today, entries: s.today.entries.slice(0, -1) } } : s;
}

/**
 * The check-in answers in one typed message, from the question on screen onward: "20 min at home,
 * pretty tired" answers time, place and energy at once. One user bubble; the questions it already
 * answers aren't asked. null when it doesn't answer the question on screen.
 */
function checkInFrom(state: AppState, text: string, r: TypedRead, from: "time" | "place" | "energy"): AppState | null {
  let s = state;
  let quiet = false;
  if (from === "time") {
    if (r.day_off) return takeDayOff(state, text);
    const minutes = r.minutes ?? (r.keep_time && state.today.step === "time-confirm" ? plannedMinutes(state) : undefined);
    if (minutes === undefined) return null;
    s = answerTime(s, text, Math.min(minutes, 120));
    quiet = true;
    if (s.today.step !== "place") return s;
  }
  if (from !== "energy") {
    if (!r.place) return quiet ? s : null;
    s = answerPlace(quiet ? answered(s) : s, text, r.place, quiet);
    quiet = true;
  }
  if (!r.energy) return quiet ? s : null;
  return answerEnergy(quiet ? answered(s) : s, text, r.energy, quiet);
}

/**
 * A typed answer that ChatGPT has read: its fields are used where they answer the question on
 * screen; anything else goes to the app's own reading (freeText), as without ChatGPT.
 */
export function applyTyped(state: AppState, text: string, r: TypedRead): AppState {
  const step = state.today.step;
  switch (step) {
    case "setup-goal":
      if (r.goal) return setupGoal(state, text, r.goal);
      break;
    case "setup-plan":
      if (r.plan && Object.keys(r.plan).length) return changePlan(state, text, r.plan);
      if (r.done) return setupPlanDone(state, text);
      break;
    case "time-confirm":
    case "time":
    case "place":
    case "energy": {
      const s = checkInFrom(state, text, r, step === "time-confirm" ? "time" : step);
      if (s) return s;
      break;
    }
    case "reason":
      if (r.reason) return chooseReason(state, r.reason, text);
      break;
    case "suggested":
    case "reminded":
    case "accepted":
      if (r.reason === "other") return setToday(push(state, user(text), agent("No problem. What's getting in the way?")), { step: "reason", accepted: undefined });
      if (r.reason && state.today.current) return chooseReason(state, r.reason, text);
      break;
  }
  return freeText(state, text);
}

/** A question typed on Today, answered by /api/chat (its checks, then ChatGPT). The step stays where it was. */
export function todayReply(state: AppState, question: string, reply: string): AppState {
  return push(state, user(question), agent(reply));
}

/** Which pick a "Based on" line belongs to: it is dropped if the user has moved on. */
export function whyKey(state: AppState): string | null {
  const c = state.today.current;
  return c && state.today.step === "suggested" ? `${state.today.dayKey}:${c.lead.variantId}:${c.lead.durationMin}` : null;
}

/** The facts the code already has about today's pick, for ChatGPT's "Based on" line. No numbers it would have to invent. */
export function whyFacts(state: AppState): { activity: string; facts: string[] } | null {
  const c = state.today.current;
  if (!c || c.desk || c.pending || c.failed || c.source === "rules" || c.why) return null;
  const { family, variant } = getVariant(c.lead.variantId);
  const ci = state.today.checkIn;
  const facts = [...c.lead.reasons];
  if (ci.energy) facts.push(ci.energy === "challenge" ? "Up for a challenge today" : ci.energy === "low" ? "Low energy today" : "Normal energy today");
  if (ci.place) facts.push(`Exercising ${PLACE_OPTIONS.find(([, p]) => p === ci.place)?.[0].toLowerCase() ?? "here"}`);
  const liked = Object.entries(state.profile.categoryPrefs ?? {}).filter(([, v]) => v === "like").map(([k]) => k);
  if (liked.length) facts.push(`Likes ${liked.slice(0, 3).join(", ")}`);
  return { activity: isTableId(c.lead.variantId) ? family.name : variant.label, facts };
}

/** ChatGPT's line for the pick it was asked about; null when none came (the loading line goes). */
export function setWhy(state: AppState, key: string, line: string | null): AppState {
  const c = state.today.current;
  return c && whyKey(state) === key ? setToday(state, { current: { ...c, why: line ?? undefined, whyPending: false } }) : state;
}

/** The "Based on" line has been asked for: "Loading reasoning…" shows under the pick meanwhile. */
export function whyPending(state: AppState, key: string): AppState {
  const c = state.today.current;
  return c && whyKey(state) === key && !c.why ? setToday(state, { current: { ...c, whyPending: true } }) : state;
}

/** Last week's numbers for the recap at the week's first log-in. Only these numbers may appear in ChatGPT's two sentences. */
export function recapFacts(state: AppState): Record<string, number | string | boolean> | null {
  const ctx = buildAgentContext(state);
  const last = ctx.past.at(-1);
  if (!last) return null;
  const byFamily = new Map<string, number>();
  for (const s of last.totals.sessions) byFamily.set(s.familyId, (byFamily.get(s.familyId) ?? 0) + s.credit);
  const top = [...byFamily.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    goal_met_hours: Number(fmt(last.goal)),
    done_met_hours: Number(fmt(last.totals.done)),
    active_days: last.totals.activeByDay.filter(Boolean).length,
    workouts: last.totals.sessions.length,
    reached_goal: last.trophy,
    ...(top ? { top_activity: getFamily(top[0]).name } : {}),
    ...(ctx.streak.current >= 2 ? { days_in_a_row_now: ctx.streak.current } : {}),
  };
}

/** ChatGPT's recap, at the top of the week's first conversation, once. */
export function addRecap(state: AppState, dayKey: string, text: string): AppState {
  const t = state.today;
  if (t.dayKey !== dayKey || t.recap !== "due") return state;
  return setToday(state, { recap: "done", entries: [agent(text), ...t.entries] });
}

/**
 * The "Other" text box under every set of bubbles. Reads the typed answer for
 * the current step; anything it can't place becomes a note or a coach reply.
 */
export function freeText(state: AppState, text: string): AppState {
  const t = state.today;
  switch (t.step) {
    case "setup-goal": {
      const n = text.match(/(\d+(?:\.\d+)?)/);
      if (n) return setupGoal(state, text, parseFloat(n[1]));
      if (/\b(guideline|default|standard|recommended|sure|ok|okay|yes)\b/i.test(text)) return setupGoal(state, text, 7.5);
      return push(state, user(text), agent("Type a number of MET-hours, like 6, or tap one of the options."));
    }
    case "setup-plan": {
      const changes = parsePlanChanges(text);
      if (Object.keys(changes).length) return changePlan(state, text, changes);
      if (parseYesNo(text) === true || /\b(done|good|fine|looks good|that's it|thats it)\b/i.test(text)) return setupPlanDone(state, text);
      return push(state, user(text), agent('Tap the days to change them, or type something like "Thursday off, Saturday 45 min".'));
    }
    case "time-confirm": {
      if (/\b(off|day off|sick|rest day|resting|not today)\b/i.test(text)) return takeDayOff(state, text);
      const yn = parseYesNo(text);
      if (yn !== null) return confirmTime(state, yn, text);
      if (/\b(more|less|longer|shorter|change|different)\b/i.test(text)) return confirmTime(state, false, text);
      const m = parseMinutes(text);
      if (m !== null) return answerTime(state, text, Math.min(m, 120));
      return push(state, user(text), agent(`Tap "${keepTimeLabel(state)}", or "${CHANGE_TIME_LABEL}" to change it.`));
    }
    case "time": {
      if (/\b(off|day off|sick|rest day|resting|not today)\b/i.test(text)) return takeDayOff(state, text);
      const m = parseMinutes(text);
      if (m === null) return push(state, user(text), agent("I didn't catch a time. Roughly how many minutes, like 15 or 40?"));
      return answerTime(state, text, Math.min(m, 120));
    }
    case "place": {
      const p = parsePlace(text);
      // Each answer has to answer the question asked: a place that isn't one of the three is asked again.
      return p ? answerPlace(state, text, p) : push(state, user(text), agent(PLACE_AGAIN));
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
    case "own":
      return ownText(state, text);
    case "own-minutes": {
      // "45" answers the question; "45 min tennis" names another activity too.
      if (matchTable(text).length) return ownText(state, text);
      const m = parseMinutes(text);
      if (m === null) return push(state, user(text), agent("Roughly how many minutes, like 20 or 45?"));
      return ownAnswer(state, { minutes: m }, text);
    }
    case "own-confirm": {
      const low = text.toLowerCase();
      if (/\b(did|done|finished|already)\b/.test(low)) return ownAnswer(state, "did", text);
      if (/\b(plan|will|later|going to|gonna|tonight)\b/.test(low)) return ownAnswer(state, "plan", text);
      return ownText(state, text);
    }
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
    entryCount: n, today, plan: prev.plan, planSource: prev.planSource, sessions: prev.sessions, declines: prev.declines, profile: prev.profile,
    notes: prev.notes, painReports: prev.painReports, syncCount: prev.syncCount,
    goal: prev.goal, goalSource: prev.goalSource, goalSet: prev.goalSet, weekSetup: prev.weekSetup, weekPlanned: prev.weekPlanned,
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
    plan: r.plan ?? state.plan, planSource: r.planSource ?? state.planSource, sessions: r.sessions, declines: r.declines, profile: r.profile, notes: r.notes, painReports: r.painReports, syncCount: r.syncCount,
    ...(r.goal !== undefined ? { goal: r.goal, goalSource: r.goalSource ?? state.goalSource, goalSet: r.goalSet, weekSetup: r.weekSetup, weekPlanned: r.weekPlanned } : {}),
    today: { ...r.today, entries: state.today.entries.slice(0, r.entryCount) },
  };
}
