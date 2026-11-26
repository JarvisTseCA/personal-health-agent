/**
 * Opening the app from Memory: the state the screens need, put back together from what the
 * backend holds (toMemory.ts is the other direction).
 *
 * Memory holds real dates; the app counts days inside "this week" and "n weeks ago". The
 * backend has already sorted Memory into weeks for the numbers (this week, then each past
 * week, oldest first), so the app's weeks are laid out to match those exactly: the same
 * weeks, with the goal and plan each one ran on.
 *
 * What comes back from where:
 *
 *    who, preferences     the profile: name, Fitbit, 👍 / 👎, equipment, "no vigorous exercise"
 *    goals, the numbers   this week's goal and plan; each past week's
 *    daily                workouts → this week's sessions and the past weeks'; declines; accepted
 *                         table picks, by place; the days the app was opened
 *    health               VO2 max, a workout's heart rate
 *    other                the Today conversation, Chat, notes, the clinician's feedback, and
 *                         the rest of the app's own state (AppOwn in memoryTypes.ts)
 */
import type { WeekRecord } from "../data/mockFitbit";
import { ACTIVITIES } from "../lib/activities";
import { categoryOfCode } from "../lib/categories";
import { CUSTOM_PREFIX, EQUIPMENT } from "../lib/equipment";
import { VO2_MONTHS } from "../lib/fitbit";
import { VIGOROUS_MET, type FitbitBand, type Session } from "../lib/met";
import type { WeekPlan } from "../lib/plan";
import type { DeclineReason, Place } from "../lib/suggest";
import { codeOfTableId, isTableId, registerTable, tableId, type TableActivity } from "../lib/tableActivities";
import type { AppState, DeclineRecord } from "../state/types";
import { addDays, addMonths, daysBetween, weekOf, type Memory, type MemoryWorkout, type Numbers, type OtherOfApp } from "./memoryTypes";

const equipmentIdByName = new Map(EQUIPMENT.map((e) => [e.name, e.id]));
const familyIdByName = new Map(ACTIVITIES.map((f) => [f.name, f.id]));

export interface FromMemory {
  state: AppState;
  /** Memory was last saved in an earlier week: the Today conversation there belongs to that week, so today starts fresh */
  newWeek: boolean;
}

/**
 * The app's state from Memory and the numbers worked out from it. `base` supplies what Memory
 * has no word on (a fresh initialState()).
 *
 * null when Memory doesn't hold this app's own part yet (nothing under other.app): the user is
 * new to Memory, and the app's content has to be put there first.
 */
export function fromMemory(memory: Memory, numbers: Numbers, base: AppState): FromMemory | null {
  const other = memory.other as OtherOfApp;
  const own = other.app;
  if (!own || own.version !== 1) return null;

  const monday = numbers.this_week.week_start;
  const sameWeek = own.week === monday;

  // Rows of the activity table the app knows, plus a plain one for any table activity Memory names that it doesn't.
  const tableActivities: Record<string, TableActivity> = { ...(own.tableActivities ?? {}) };
  const knowRow = (code: string, name: string, met: number) => {
    tableActivities[code] ??= { code, heading: categoryOfCode(code) ?? "", description: name, label: name, met, places: [] };
  };

  const heartRate = new Map(memory.health.heart_rates.map((r) => [r.workout_id, r.avg_bpm]));
  const sessionOf = (w: MemoryWorkout, weekMonday: string): Session => {
    const mine = own.workouts[w.id];
    let variantId = mine?.variantId ?? (w.activity_code ? tableId(w.activity_code) : undefined);
    // Neither one of the app's activities nor from the table: kept under its name, as a typed-in activity is.
    const foreign = variantId === undefined;
    variantId ??= w.met >= VIGOROUS_MET ? "other-very" : "other-fairly";
    if (isTableId(variantId)) knowRow(codeOfTableId(variantId), w.activity_name, w.met);
    const customName = mine?.customName ?? (foreign ? w.activity_name : undefined);
    return {
      id: w.id, variantId, durationMin: w.duration_min, dayIndex: daysBetween(weekMonday, w.date), source: w.source, confirmed: w.confirmed,
      ...(w.band ? { band: w.band as FitbitBand } : {}),
      ...(w.start_time ? { startTime: w.start_time } : {}),
      ...(heartRate.has(w.id) ? { avgHeartRate: heartRate.get(w.id) } : {}),
      ...(customName ? { customName } : {}),
    };
  };

  const byWeek = new Map<string, MemoryWorkout[]>();
  for (const w of memory.daily.workouts) byWeek.set(weekOf(w.date), [...(byWeek.get(weekOf(w.date)) ?? []), w]);
  const sessionsOf = (weekMonday: string) => (byWeek.get(weekMonday) ?? []).map((w) => sessionOf(w, weekMonday));

  const opened = new Set(memory.daily.app_opens);
  const opensOf = (weekMonday: string) => Array.from({ length: 7 }, (_, d) => opened.has(addDays(weekMonday, d)));

  const history: WeekRecord[] = numbers.past_weeks.map((w) => ({
    goal: w.goal_met_hours, plan: w.plan as WeekPlan, sessions: sessionsOf(w.week_start),
    signIns: opensOf(w.week_start), // the days on record as opened; a week with none on record has none
  }));

  const declines: DeclineRecord[] = [];
  const picked: Partial<Record<Place, string[]>> = {};
  for (const s of memory.daily.suggestions) {
    if (s.outcome === "accepted") {
      if (!s.place || !s.activity_code) continue;
      const here = (picked[s.place as Place] ??= []);
      if (!here.includes(s.activity_code)) here.push(s.activity_code);
      continue;
    }
    let familyId = own.declines[s.id]?.familyId ?? familyIdByName.get(s.activity_name);
    if (s.activity_code) {
      knowRow(s.activity_code, s.activity_name, tableActivities[s.activity_code]?.met ?? 3);
      familyId = tableId(s.activity_code);
    }
    if (!familyId) continue; // an activity the app has no name for
    declines.push({
      id: s.id, familyId, reason: (s.reason ?? "other") as DeclineReason, day: daysBetween(monday, s.date),
      ...(s.note ? { note: s.note } : {}),
      ...(s.place ? { place: s.place as Place } : {}),
    });
  }

  // One VO2 max a month for the last months ending this one; a month without a reading keeps the last one (as monthlyVo2 does).
  const thisMonth = numbers.today.slice(0, 7);
  const vo2: number[] = [];
  let last: number | null = null;
  for (const r of memory.health.vo2_max) if (r.month <= addMonths(thisMonth, -VO2_MONTHS)) last = r.ml_kg_min;
  for (let k = VO2_MONTHS - 1; k >= 0; k--) {
    const reading = memory.health.vo2_max.find((r) => r.month === addMonths(thisMonth, -k));
    if (reading) last = reading.ml_kg_min;
    if (last !== null) vo2.push(last);
  }

  // The table's activities have to be known before anything looks one up by its id (a session, a decline).
  registerTable(Object.values(tableActivities));

  const equipment = memory.preferences.equipment;
  const idsOf = (names: string[]) => names.map((name) => equipmentIdByName.get(name) ?? `${CUSTOM_PREFIX}${name}`);
  const setBy = [...memory.goals].reverse().find((g) => g.week_start <= monday && g.goal_set_by)?.goal_set_by;

  const state: AppState = {
    ...base,
    onboarded: own.onboarded,
    personaId: own.personaId,
    todayIndex: own.todayIndex,
    profile: {
      ...base.profile,
      name: memory.who.name ?? base.profile.name,
      fitbitConnected: !!memory.who.fitbit_connected,
      fitbitLive: own.profile.fitbitLive,
      hasHealthCondition: !!memory.preferences.no_vigorous,
      categoryPrefs: memory.preferences.categories,
      equipment: equipment.home === null && equipment.gym === null ? undefined : { home: idsOf(equipment.home ?? []), gym: equipment.gym ? idsOf(equipment.gym) : null },
      enjoyed: own.profile.enjoyed,
      access: own.profile.access,
      usualTime: own.profile.usualTime,
      pickedCodes: Object.keys(picked).length ? picked : undefined,
    },
    clinician: other.clinician ?? base.clinician,
    goal: numbers.this_week.goal_met_hours,
    goalSource: setBy ?? "default",
    // Who set this week's goal, when and why: kept for the week it was set in.
    goalSet: sameWeek ? own.goalSet : undefined,
    weekSetup: sameWeek ? own.weekSetup : undefined,
    plan: numbers.this_week.plan as WeekPlan,
    planSource: own.planSource,
    sessions: sessionsOf(monday),
    history,
    signIns: opensOf(monday),
    vo2,
    declines,
    notes: other.notes ?? [],
    today: sameWeek && other.today ? other.today : base.today,
    chat: other.chat ?? [],
    syncCount: own.syncCount,
    fitbitWeek: own.fitbitWeek,
    removedFitbitIds: own.removedFitbitIds,
    suggestSource: own.suggestSource,
    tableActivities: Object.keys(tableActivities).length ? tableActivities : undefined,
    painReports: own.painReports,
    // Last week's recap is answered once a week: a new week asks again.
    recapHandled: sameWeek ? own.recapHandled : false,
    overlay: null,
    toast: null,
  };
  return { state, newWeek: !sameWeek };
}
