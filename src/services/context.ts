/**
 * Builds the structured context every screen and the agent see.
 *
 * All numbers come from src/lib (calculator), never from the agent. A real
 * LLM gets this serialized into its system prompt (see prompts.ts).
 *
 * When the app runs with the backend, the numbers are the backend's instead
 * (numbers.ts), and the calculator here is not asked.
 */
import { dislikedCategories, likedCategories } from "../lib/categories";
import { getFamily } from "../lib/activities";
import { goalOffer, type GoalOffer } from "../lib/goal";
import { equipmentName } from "../lib/equipment";
import { guidanceOf, type ClinicianGuidance } from "../lib/clinicianNotes";
import { streakOf, trophyEarned, type Streak } from "../lib/rewards";
import { DAY_NAMES, DAY_NAMES_LONG, totalsFor, withCredit, type Session, type WeekTotals } from "../lib/met";
import { dailyTargets, unplannedLeft, type WeekPlan } from "../lib/plan";
import type { Place, SuggestInput } from "../lib/suggest";
import type { AppState } from "../state/types";
import { contextFromNumbers, numbersFor } from "./numbers";

export interface PastWeek {
  label: string;
  /** That week's Monday */
  start: Date;
  /** That week's plan, for showing planned days off */
  plan: WeekPlan;
  goal: number;
  totals: WeekTotals;
  /** Days the user opened the app */
  signIns: boolean[];
  /** The week reached its goal */
  trophy: boolean;
}

export interface Vo2 {
  /** Monthly estimates, oldest first, ending this month */
  series: Array<{ label: string; value: number }>;
  latest: number;
  /** Change since the first reading shown */
  change: number;
  /** Peak effort in METs (1 MET = 3.5 mL/kg/min) */
  peakMets: number;
}

export interface AgentContext {
  goal: number;
  goalBy: "default" | "recap" | "user";
  steppingStone: boolean;
  today: string;
  todayIndex: number;
  week: WeekTotals;
  targets: number[];
  todayTarget: number;
  todayDone: number;
  todayNeeded: number;
  /** Today's target is reached, as the backend worked it out. Missing when the app works the numbers out itself. */
  todayReached?: boolean;
  left: number;
  unplanned: number;
  /** Days this week with any activity, up to today */
  activeDays: boolean[];
  /** Days this week the app was opened, up to and including today */
  signIns: boolean[];
  streak: Streak;
  /** This week's goal is reached */
  trophy: boolean;
  /** All trophies so far, this week's included */
  trophies: number;
  vo2: Vo2 | null;
  past: PastWeek[];
  offer: GoalOffer;
  noVigorous: boolean;
  /** What the saved clinician feedback asks for */
  guidance: ClinicianGuidance;
  enjoyedNames: string[];
  state: AppState;
}

/** Monday of the current week, shifted back by `weeksAgo`. */
export function weekStart(weeksAgo: number, now = new Date()): Date {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7 * weeksAgo);
  return monday;
}

/** Monday of the current week, shifted by `weeksAgo`, as "Oct 12". */
export function weekLabel(weeksAgo: number): string {
  return weekStart(weeksAgo).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "May", "Jun", … for the last `n` months, ending this month. */
function lastMonths(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1).toLocaleDateString(undefined, { month: "short" }));
}

export function vo2Of(values: number[]): Vo2 | null {
  if (!values.length) return null;
  const labels = lastMonths(values.length);
  const latest = values[values.length - 1];
  return { series: values.map((value, i) => ({ label: labels[i], value })), latest, change: latest - values[0], peakMets: latest / 3.5 };
}

/** Today's target is reached: a day with a target (not off, not 0 min) whose MET-hours meet it. */
export function reachedToday(ctx: Pick<AgentContext, "todayTarget" | "todayDone" | "todayReached">): boolean {
  return ctx.todayReached ?? (ctx.todayTarget > 0 && ctx.todayDone + 1e-9 >= ctx.todayTarget);
}

/** MET-hours a workout adds toward the goal: the backend's figure when the app runs with it. */
export function creditOf(state: AppState, s: Session): number {
  const counted = numbersFor(state)?.this_week.workouts.find((w) => w.id === s.id);
  return counted ? counted.met_hours : withCredit(s).credit;
}

export function buildAgentContext(state: AppState): AgentContext {
  // With the backend, every number is the backend's; the app's own calculator isn't asked.
  const fromBackend = numbersFor(state);
  return fromBackend ? contextFromNumbers(state, fromBackend) : ownContext(state);
}

const NO_DAY_OPENED: boolean[] = Array(7).fill(false);

/** The context with the numbers worked out here, by the app's own calculator. */
export function ownContext(state: AppState): AgentContext {
  const goal = state.goal;
  const t = state.todayIndex;
  const week = totalsFor(state.sessions.filter((s) => s.dayIndex <= t));
  const targets = dailyTargets(goal, state.plan, week.doneByDay, t);
  // The days on record as opened, up to today. Opening the app puts today on record (startDay in state/today.ts).
  const signIns = Array.from({ length: 7 }, (_, i) => i <= t && !!state.signIns?.[i]);

  const past: PastWeek[] = state.history.map((w, i) => {
    const totals = totalsFor(w.sessions);
    return {
      label: weekLabel(state.history.length - i),
      start: weekStart(state.history.length - i),
      plan: w.plan,
      goal: w.goal,
      totals,
      // A week with no record of opens (brought in from Fitbit, an older save) has no day opened. Its workouts count as always.
      signIns: w.signIns ?? NO_DAY_OPENED,
      trophy: trophyEarned(totals.done, w.goal),
    };
  });

  const guidance = guidanceOf(state.clinician.entries);
  const streak = streakOf([...past.flatMap((w) => w.signIns), ...signIns.slice(0, t + 1)]);
  const trophy = trophyEarned(week.done, goal);
  const todayTarget = targets[t];
  const todayDone = week.doneByDay[t];

  return {
    goal,
    goalBy: state.goalSource,
    steppingStone: goal < 7.5 - 1e-9,
    today: DAY_NAMES_LONG[t],
    todayIndex: t,
    week,
    targets,
    todayTarget,
    todayDone,
    todayNeeded: Math.max(0, todayTarget - todayDone),
    left: Math.max(0, goal - week.done),
    unplanned: unplannedLeft(goal, state.plan, week.doneByDay, t),
    activeDays: week.activeByDay.map((a, i) => a && i <= t),
    signIns,
    streak,
    trophy,
    trophies: past.filter((w) => w.trophy).length + (trophy ? 1 : 0),
    vo2: vo2Of(state.vo2 ?? []),
    past,
    offer: goalOffer(goal, past.map((w) => w.totals.done)),
    // A health flag, or clinician feedback that says to keep it moderate
    noVigorous: state.profile.hasHealthCondition || guidance.moderateOnly,
    guidance,
    enjoyedNames: state.profile.enjoyed.map((id) => getFamily(id).noun),
    state,
  };
}

/** What a typical gym has, assumed when the user hasn't listed their gym's equipment. */
export const TYPICAL_GYM = ["treadmill", "stationary-bike", "elliptical", "dumbbells", "weight-machines"];

/** Equipment where the user is today; undefined when the profile has no equipment yet (not asked, or older saves). */
export function equipmentAt(state: AppState, place: Place): string[] | undefined {
  const eq = state.profile.equipment;
  if (!eq) return undefined;
  if (place === "indoors_private") return eq.home;
  // Indoors with others includes the gym. Gym equipment not listed: assume a typical gym
  // rather than suggest nothing.
  if (place === "indoors_with_others") return eq.gym ?? TYPICAL_GYM;
  return [];
}

/** Inputs for the suggestion ranker, from state + today's check-in. */
export function buildSuggestInput(state: AppState, ctx = buildAgentContext(state)): SuggestInput {
  const t = state.todayIndex;
  const c = state.today.checkIn;
  const lastWeek = ctx.past.at(-1)?.totals.sessions ?? [];
  const recent = [
    ...ctx.week.sessions.map((s) => ({ familyId: s.familyId, daysAgo: t - s.dayIndex, dayName: DAY_NAMES[s.dayIndex] })),
    ...lastWeek.map((s) => ({ familyId: s.familyId, daysAgo: t + 7 - s.dayIndex, dayName: `last ${DAY_NAMES[s.dayIndex]}` })),
  ].filter((r) => r.daysAgo >= 0);
  return {
    enjoyed: state.profile.enjoyed,
    access: state.profile.access,
    noVigorous: ctx.noVigorous,
    maxSessionMin: null,
    minutes: c.minutes ?? 30,
    place: c.place ?? "indoors_private",
    equipmentHere: equipmentAt(state, c.place ?? "indoors_private"),
    favorKind: ctx.guidance.strength ? "strength" : undefined,
    energy: c.energy ?? "normal",
    mood: c.mood ?? "surprise",
    needed: ctx.todayNeeded,
    target: ctx.todayTarget,
    boost: state.today.boost,
    recent,
    declines: state.declines.map((d) => ({ familyId: d.familyId, reason: d.reason, daysAgo: t - d.day })),
    exclude: state.today.exclude,
    categoryPrefs: state.profile.categoryPrefs,
    constraint: state.today.constraint,
  };
}

/** Compact, LLM-friendly JSON of the context (ids resolved to names). */
export function serializeContext(ctx: AgentContext) {
  const s = ctx.state;
  const cur = s.today.current?.lead;
  return {
    user: {
      name: s.profile.name,
      enjoys_in_order: ctx.enjoyedNames,
      access: Object.fromEntries(Object.entries(s.profile.access).map(([k, v]) => [getFamily(k).noun, v])),
      health_flag: s.profile.hasHealthCondition,
      equipment_at_home: s.profile.equipment ? s.profile.equipment.home.map(equipmentName) : "not listed",
      equipment_at_gym: s.profile.equipment ? (s.profile.equipment.gym ?? TYPICAL_GYM).map(equipmentName) : "not listed",
      // Categories of the activity table the user marked 👍 / 👎 in onboarding or Settings.
      categories_they_like: likedCategories(s.profile.categoryPrefs),
      categories_they_dislike: dislikedCategories(s.profile.categoryPrefs),
    },
    // Feedback from the user's clinician, as the user typed it in Chat. Context, not a goal or a rule.
    clinician_notes: s.clinician.entries.length
      ? {
          notes: s.clinician.entries.map((n) => ({ saved: n.at.slice(0, 10), text: n.text })),
          applied: [
            ...(ctx.guidance.moderateOnly ? ["moderate activity only (nothing at 6 MET or more)"] : []),
            ...(ctx.guidance.strength ? ["strength training favored"] : []),
          ],
        }
      : null,
    vo2_max: ctx.vo2 ? { latest_ml_kg_min: ctx.vo2.latest, change_over_months: ctx.vo2.change, monthly: ctx.vo2.series.map((x) => `${x.label} ${x.value}`) } : null,
    goal: { weekly_met_hours: ctx.goal, set_by: ctx.goalBy, stepping_stone: ctx.steppingStone },
    today: ctx.today,
    check_in: s.today.checkIn,
    progress: {
      week_done_met_hours: +ctx.week.done.toFixed(2),
      week_left_met_hours: +ctx.left.toFixed(2),
      today_target_met_hours: +ctx.todayTarget.toFixed(2),
      today_done_met_hours: +ctx.todayDone.toFixed(2),
      daily_targets: ctx.targets.map((x, i) => `${DAY_NAMES[i]} ${s.plan[i]} ${x.toFixed(2)}`),
      streak_days_app_opened: ctx.streak.current,
      trophy_this_week: ctx.trophy,
      trophies_total: ctx.trophies,
    },
    sessions_this_week: ctx.week.sessions.map((x) => ({
      day: DAY_NAMES[x.dayIndex], activity: getFamily(x.familyId).name, minutes: x.durationMin, met: x.met, met_hours: +x.credit.toFixed(2), confirmed: x.confirmed,
    })),
    decline_log: s.declines.map((d) => ({ activity: getFamily(d.familyId).noun, reason: d.reason, days_ago: ctx.todayIndex - d.day, note: d.note })),
    current_suggestion: cur ? { activity: getFamily(cur.familyId).noun, variant: cur.variantId, minutes: cur.durationMin, met_hours: +cur.credit.toFixed(2), reasons: cur.reasons } : null,
  };
}
