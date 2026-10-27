/**
 * Builds the structured context every screen and the agent see.
 *
 * All numbers come from src/lib (calculator), never from the agent. A real
 * LLM gets this serialized into its system prompt (see prompts.ts).
 */
import { getFamily } from "../lib/activities";
import { goalOffer, type GoalOffer } from "../lib/goal";
import { streakOf, weekMedals, type Medal, type Streak } from "../lib/medals";
import { DAY_NAMES, DAY_NAMES_LONG, totalsFor, type WeekTotals } from "../lib/met";
import { dailyTargets, unplannedLeft } from "../lib/plan";
import type { SuggestInput } from "../lib/suggest";
import type { AppState } from "../state/types";

export interface PastWeek {
  label: string;
  /** That week's Monday */
  start: Date;
  goal: number;
  totals: WeekTotals;
  medals: Medal[];
  gold: boolean;
}

export interface AgentContext {
  goal: number;
  goalBy: "default" | "recap" | "clinician";
  steppingStone: boolean;
  today: string;
  todayIndex: number;
  week: WeekTotals;
  targets: number[];
  todayTarget: number;
  todayDone: number;
  todayNeeded: number;
  left: number;
  unplanned: number;
  medals: Medal[];
  streak: Streak;
  past: PastWeek[];
  offer: GoalOffer;
  noVigorous: boolean;
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

export function buildAgentContext(state: AppState): AgentContext {
  const goal = state.clinician.goal ?? state.goal;
  const t = state.todayIndex;
  const week = totalsFor(state.sessions.filter((s) => s.dayIndex <= t));
  const targets = dailyTargets(goal, state.plan, week.doneByDay, t);
  const medals = weekMedals(week.activeByDay, week.doneByDay, targets, week.done, goal, t);

  const past: PastWeek[] = state.history.map((w, i) => {
    const totals = totalsFor(w.sessions);
    const tg = dailyTargets(w.goal, w.plan, totals.doneByDay, 6);
    return {
      label: weekLabel(state.history.length - i),
      start: weekStart(state.history.length - i),
      goal: w.goal,
      totals,
      medals: weekMedals(totals.activeByDay, totals.doneByDay, tg, totals.done, w.goal),
      gold: totals.done + 1e-9 >= w.goal,
    };
  });

  const streak = streakOf([...past.flatMap((w) => w.medals), ...medals.slice(0, t + 1)]);
  const todayTarget = targets[t];
  const todayDone = week.doneByDay[t];

  return {
    goal,
    goalBy: state.clinician.goal !== null ? "clinician" : state.goalSource,
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
    medals,
    streak,
    past,
    offer: goalOffer(goal, past.map((w) => w.totals.done), state.clinician.goal !== null),
    noVigorous: state.profile.hasHealthCondition || state.clinician.noVigorous,
    enjoyedNames: state.profile.enjoyed.map((id) => getFamily(id).noun),
    state,
  };
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
    maxSessionMin: state.clinician.maxSessionMin,
    minutes: c.minutes ?? 30,
    place: c.place ?? "home",
    energy: c.energy ?? "normal",
    mood: c.mood ?? "surprise",
    needed: ctx.todayNeeded,
    target: ctx.todayTarget,
    boost: state.today.boost,
    recent,
    declines: state.declines.map((d) => ({ familyId: d.familyId, reason: d.reason, daysAgo: t - d.day })),
    exclude: state.today.exclude,
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
    },
    clinician_limits: { goal: s.clinician.goal, no_vigorous: s.clinician.noVigorous, max_session_min: s.clinician.maxSessionMin, note: s.clinician.note || null },
    goal: { weekly_met_hours: ctx.goal, set_by: ctx.goalBy, stepping_stone: ctx.steppingStone },
    today: ctx.today,
    check_in: s.today.checkIn,
    progress: {
      week_done_met_hours: +ctx.week.done.toFixed(2),
      week_left_met_hours: +ctx.left.toFixed(2),
      today_target_met_hours: +ctx.todayTarget.toFixed(2),
      today_done_met_hours: +ctx.todayDone.toFixed(2),
      daily_targets: ctx.targets.map((x, i) => `${DAY_NAMES[i]} ${s.plan[i]} ${x.toFixed(2)}`),
      streak_days: ctx.streak.current,
      medals_this_week: ctx.medals.slice(0, ctx.todayIndex + 1),
    },
    sessions_this_week: ctx.week.sessions.map((x) => ({
      day: DAY_NAMES[x.dayIndex], activity: getFamily(x.familyId).name, minutes: x.durationMin, met: x.met, met_hours: +x.credit.toFixed(2), confirmed: x.confirmed,
    })),
    decline_log: s.declines.map((d) => ({ activity: getFamily(d.familyId).noun, reason: d.reason, days_ago: ctx.todayIndex - d.day, note: d.note })),
    current_suggestion: cur ? { activity: getFamily(cur.familyId).noun, variant: cur.variantId, minutes: cur.durationMin, met_hours: +cur.credit.toFixed(2), reasons: cur.reasons } : null,
  };
}
