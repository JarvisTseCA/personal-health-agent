/**
 * Telling the backend what happened: the app's state as Memory holds it, and what changed.
 *
 * `toMemory()` lays the whole state out in Memory's seven groups. The app counts days as
 * 0 = Sunday … 6 = Saturday inside "this week" and "n weeks ago"; Memory holds real dates. So
 * everything is put on the calendar from one date, this week's Sunday: day 2 of this week is
 * that Sunday + 2, and the last past week starts 7 days before it.
 *
 * `memoryChanges()` compares two of those and gives what to send: the parts to save
 * (POST /api/memory) and the entries to take out (DELETE /api/memory/{kind}/{key}). After
 * every step in the app, the state before and after go through it, so whatever the step
 * changed is what the backend is told, with nothing listed by hand.
 *
 * Where each part of the state goes:
 *
 *    who           name, Fitbit connected
 *    preferences   👍 / 👎 categories, equipment (by name), "no vigorous exercise"
 *    goals         one row a week: this week's goal and plan, and each past week's
 *    daily         workouts, declines, accepted table picks, today's check-in, days the app was opened
 *    health        VO2 max by month, a workout's average heart rate
 *    chat          the conversation in the Chat tab, one entry a message
 *    other         the Today conversation, notes, the clinician's feedback, and the rest (memoryTypes.ts)
 */
import { getFamily, getVariant } from "../lib/activities";
import { equipmentName } from "../lib/equipment";
import type { Session } from "../lib/met";
import { PLACES } from "../lib/suggest";
import { codeOfTableId, isTableId } from "../lib/tableActivities";
import type { AppState, ChatMessage } from "../state/types";
import {
  addDays, addMonths, type AppOwn, type Memory, type MemoryChatMessage, type MemoryPart, type MemorySuggestion, type MemoryWorkout,
  type OtherOfApp,
} from "./memoryTypes";

/** The app's today as a date: this week's Sunday + the day it is in the app. */
export function todayOf(state: Pick<AppState, "todayIndex">, sunday: string): string {
  return addDays(sunday, state.todayIndex);
}

/** The Sunday of each past week, oldest first, for a history of `weeks` weeks. */
function pastSundays(weeks: number, sunday: string): string[] {
  return Array.from({ length: weeks }, (_, i) => addDays(sunday, -7 * (weeks - i)));
}

function workoutOf(s: Session, weekSunday: string): MemoryWorkout {
  const { family, variant } = getVariant(s.variantId);
  return {
    id: s.id,
    date: addDays(weekSunday, s.dayIndex),
    // Only activities from the activity table have a code here, as in the app's own table request.
    activity_code: isTableId(s.variantId) ? codeOfTableId(s.variantId) : null,
    // The family's name ("Walking" for every kind of walk): the Summary page groups by it.
    activity_name: family.name,
    met: variant.met,
    duration_min: s.durationMin,
    source: s.source,
    confirmed: s.confirmed,
    band: s.band ?? null,
    start_time: s.startTime ?? null,
  };
}

/** A Chat message as Memory keeps it (chatMessageOf in fromMemory.ts is the other direction). */
function chatMessage(m: ChatMessage): MemoryChatMessage {
  const app = { ...(m.suggestions?.length ? { suggestions: m.suggestions } : {}), ...(m.kind ? { kind: m.kind } : {}) };
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    at: m.at === undefined ? null : new Date(m.at).toISOString(),
    reply: m.reply ?? null,
    app: Object.keys(app).length ? app : null,
  };
}

/** The whole state as Memory's seven groups. `sunday` is this week's Sunday, "2026-11-23". */
export function toMemory(state: AppState, sunday: string): Memory {
  const today = todayOf(state, sunday);
  const sundays = pastSundays(state.history.length, sunday);
  const p = state.profile;

  const weeks: Array<{ sunday: string; sessions: Session[] }> = [
    ...state.history.map((w, i) => ({ sunday: sundays[i], sessions: w.sessions })),
    { sunday, sessions: state.sessions },
  ];
  const sessions = weeks.flatMap((w) => w.sessions);

  const opens = [
    ...state.history.flatMap((w, i) => (w.signIns ?? []).flatMap((on, d) => (on ? [addDays(sundays[i], d)] : []))),
    ...(state.signIns ?? []).flatMap((on, d) => (on ? [addDays(sunday, d)] : [])),
  ];

  const declined: MemorySuggestion[] = state.declines.map((d) => ({
    id: d.id,
    date: addDays(sunday, d.day),
    place: d.place ?? null,
    activity_code: isTableId(d.familyId) ? codeOfTableId(d.familyId) : null,
    activity_name: getFamily(d.familyId).name,
    outcome: "declined",
    reason: d.reason,
    note: d.note ?? null,
  }));
  // Table picks the user accepted, by place: the backend ranks them higher there ("picked before").
  const accepted: MemorySuggestion[] = PLACES.flatMap((place) => (p.pickedCodes?.[place] ?? []).map((code) => ({
    id: `picked-${place}-${code}`,
    date: today,
    place,
    activity_code: code,
    activity_name: state.tableActivities?.[code]?.label ?? code,
    outcome: "accepted" as const,
    reason: null,
    note: null,
  })));

  const c = state.today.checkIn;
  const checkedIn = c.minutes !== undefined && c.place !== undefined && c.energy !== undefined && c.mood !== undefined;

  const month = today.slice(0, 7);
  const vo2 = state.vo2 ?? [];

  const own: AppOwn = {
    version: 1,
    onboarded: state.onboarded,
    personaId: state.personaId,
    todayIndex: state.todayIndex,
    week: sunday,
    profile: { enjoyed: p.enjoyed, access: p.access, usualTime: p.usualTime, fitbitLive: p.fitbitLive },
    planSource: state.planSource,
    recapHandled: state.recapHandled,
    syncCount: state.syncCount,
    painReports: state.painReports,
    fitbitWeek: state.fitbitWeek,
    removedFitbitIds: state.removedFitbitIds,
    suggestSource: state.suggestSource,
    tableActivities: state.tableActivities,
    goalSet: state.goalSet,
    weekSetup: state.weekSetup,
    weekPlanned: state.weekPlanned,
    workouts: Object.fromEntries(
      sessions
        .filter((s) => !isTableId(s.variantId) || s.customName)
        .map((s) => [s.id, s.customName ? { variantId: s.variantId, customName: s.customName } : { variantId: s.variantId }]),
    ),
    declines: Object.fromEntries(state.declines.filter((d) => !isTableId(d.familyId)).map((d) => [d.id, { familyId: d.familyId }])),
  };
  const other: OtherOfApp = { today: state.today, notes: state.notes, clinician: state.clinician, app: own };

  return {
    who: { name: p.name, fitbit_connected: p.fitbitConnected },
    preferences: {
      categories: p.categoryPrefs ?? {},
      equipment: p.equipment
        ? { home: p.equipment.home.map(equipmentName), gym: p.equipment.gym ? p.equipment.gym.map(equipmentName) : null }
        : { home: null, gym: null },
      // The clinician's "keep it moderate" isn't here: that feedback stays with the app until Chat is redone.
      no_vigorous: p.hasHealthCondition,
    },
    goals: [
      ...state.history.map((w, i) => ({ week_start: sundays[i], goal_met_hours: w.goal, goal_set_by: "default" as const, plan: [...w.plan] })),
      { week_start: sunday, goal_met_hours: state.goal, goal_set_by: state.goalSource, plan: [...state.plan] },
    ],
    daily: {
      check_ins: checkedIn ? [{ date: today, minutes: c.minutes!, place: c.place!, energy: c.energy!, mood: c.mood! }] : [],
      suggestions: [...declined, ...accepted],
      workouts: weeks.flatMap((w) => w.sessions.map((s) => workoutOf(s, w.sunday))),
      app_opens: [...new Set(opens)].sort(),
    },
    health: {
      // One reading a month, ending this month.
      vo2_max: vo2.map((value, i) => ({ month: addMonths(month, i - (vo2.length - 1)), ml_kg_min: value, source: "fitbit" })),
      heart_rates: sessions.filter((s) => s.avgHeartRate !== undefined).map((s) => ({ workout_id: s.id, avg_bpm: s.avgHeartRate! })),
    },
    chat: state.chat.map(chatMessage),
    other: other as Record<string, unknown>,
  };
}

/** One entry to take out of Memory: DELETE /api/memory/{kind}/{key}. */
export interface MemoryRemoval {
  /** "other": what the app keeps under one name there, taken out by that name */
  kind: "workouts" | "suggestions" | "check_ins" | "chat" | "other";
  key: string;
}

export interface MemoryChanges {
  /** What to save, or null when nothing is new or different */
  save: MemoryPart | null;
  remove: MemoryRemoval[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Entries of `next` that are new or different from the one with the same key in `prev`. */
function changed<T>(prev: T[], next: T[], key: (x: T) => string): T[] {
  const before = new Map(prev.map((x) => [key(x), JSON.stringify(x)]));
  return next.filter((x) => before.get(key(x)) !== JSON.stringify(x));
}

/** Entries of `prev` whose key is gone from `next`. */
function gone<T>(prev: T[], next: T[], key: (x: T) => string): T[] {
  const after = new Set(next.map(key));
  return prev.filter((x) => !after.has(key(x)));
}

/**
 * What to tell the backend after a step: `prev` and `next` are toMemory() of the state before
 * and after it, `sunday` this week's Sunday.
 *
 * Memory is the longer record, so a step in the app never rewrites its past:
 *  - Only this week's goal and plan are sent. A past week keeps the goal it had.
 *  - Only a workout from this week can be taken out. One that left the app's 26 weeks stays in Memory.
 *  - A day the app was opened is never taken back, and an accepted pick stays accepted.
 * The Chat conversation is told message by message: a new one is added, and one that is gone
 * from the screen (the user edited an earlier message, which drops what came after it) is taken out.
 * Starting over (another demo persona, Reset, the first sync of a real Fitbit) replaces
 * everything instead; the store does that with replaceMemory().
 */
export function memoryChanges(prev: Memory, next: Memory, sunday: string): MemoryChanges {
  const save: MemoryPart = {};
  const remove: MemoryRemoval[] = [];

  if (!same(prev.who, next.who)) save.who = next.who;
  if (!same(prev.preferences, next.preferences)) save.preferences = next.preferences;

  const goals = changed(prev.goals, next.goals, (w) => w.week_start).filter((w) => w.week_start >= sunday);
  if (goals.length) save.goals = goals;

  const daily: Partial<Memory["daily"]> = {};
  const workouts = changed(prev.daily.workouts, next.daily.workouts, (w) => w.id);
  if (workouts.length) daily.workouts = workouts;
  const dropped = gone(prev.daily.workouts, next.daily.workouts, (w) => w.id).filter((w) => w.date >= sunday);
  remove.push(...dropped.map((w): MemoryRemoval => ({ kind: "workouts", key: w.id })));

  const isDecline = (s: MemorySuggestion) => s.outcome === "declined";
  const suggestions = [
    ...changed(prev.daily.suggestions.filter(isDecline), next.daily.suggestions.filter(isDecline), (s) => s.id),
    // An accepted pick is sent once, on the day it was accepted.
    ...gone(next.daily.suggestions.filter((s) => !isDecline(s)), prev.daily.suggestions, (s) => s.id),
  ];
  if (suggestions.length) daily.suggestions = suggestions;
  remove.push(...gone(prev.daily.suggestions.filter(isDecline), next.daily.suggestions, (s) => s.id).map((s): MemoryRemoval => ({ kind: "suggestions", key: s.id })));

  const checkIns = changed(prev.daily.check_ins, next.daily.check_ins, (c) => c.date);
  if (checkIns.length) daily.check_ins = checkIns;

  const opens = gone(next.daily.app_opens, prev.daily.app_opens, (d) => d);
  if (opens.length) daily.app_opens = opens;
  if (Object.keys(daily).length) save.daily = daily;

  const health: Partial<Memory["health"]> = {};
  const vo2 = changed(prev.health.vo2_max, next.health.vo2_max, (r) => r.month);
  if (vo2.length) health.vo2_max = vo2;
  const heart = changed(prev.health.heart_rates, next.health.heart_rates, (r) => r.workout_id);
  if (heart.length) health.heart_rates = heart;
  if (Object.keys(health).length) save.health = health;

  const chat = changed(prev.chat, next.chat, (m) => m.id);
  if (chat.length) save.chat = chat;
  remove.push(...gone(prev.chat, next.chat, (m) => m.id).map((m): MemoryRemoval => ({ kind: "chat", key: m.id })));

  const other = Object.fromEntries(Object.entries(next.other).filter(([name, value]) => !same(prev.other[name], value)));
  if (Object.keys(other).length) save.other = other;

  return { save: Object.keys(save).length ? save : null, remove };
}
