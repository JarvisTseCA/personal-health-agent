/**
 * Builds the structured context that the agent sees.
 *
 * This is the bridge between "data in the database" and "text in the LLM
 * prompt". The mock agent reads it to fill in its scripted answers; a real
 * LLM gets it serialized into the system prompt (see prompts.ts).
 */
import { getFamily, getVariant } from "../lib/activities";
import { DAY_NAMES_LONG, summarizeWeek, WEEKLY_GOAL_MINUTES, type WeekSummary } from "../lib/guideline";
import { buildPlanOptions, type PlanOption } from "../lib/planner";
import type { AppState } from "../state/types";

export interface AgentContext {
  profile: AppState["profile"];
  goalMinutes: number;
  today: string;
  todayIndex: number;
  week: WeekSummary;
  timeLeftMinutes: number;
  openDays: number[];
  options: PlanOption[];
  chosenPlan: PlanOption | null;
  enjoyedNames: string[];
}

export function buildAgentContext(state: AppState): AgentContext {
  const week = summarizeWeek(state.sessions);
  const timeLeftMinutes = Math.max(0, state.profile.weeklyTimeMin - week.clockMinutesUsed);
  // Plan from today onward; if they already worked out today, start tomorrow (when there is one).
  const workedOutToday = state.sessions.some((s) => s.dayIndex === state.todayIndex);
  const firstDay = workedOutToday && state.todayIndex < 6 ? state.todayIndex + 1 : state.todayIndex;
  const openDays = Array.from({ length: 7 - firstDay }, (_, i) => firstDay + i);
  const options = buildPlanOptions({
    remainingMinutes: week.remainingMinutes,
    timeLeftMinutes,
    familyIds: state.profile.enjoyedFamilyIds,
    openDays,
    cautious: state.profile.hasHealthCondition,
  });
  return {
    profile: state.profile,
    goalMinutes: WEEKLY_GOAL_MINUTES,
    today: DAY_NAMES_LONG[state.todayIndex],
    todayIndex: state.todayIndex,
    week,
    timeLeftMinutes,
    openDays,
    options,
    chosenPlan: options.find((o) => o.kind === state.chosenPlan) ?? null,
    enjoyedNames: state.profile.enjoyedFamilyIds.map((id) => getFamily(id).noun),
  };
}

/** Compact, LLM-friendly JSON of the context (no colors, ids resolved to names). */
export function serializeContext(ctx: AgentContext) {
  return {
    user: {
      name: ctx.profile.name,
      free_time_this_week_min: ctx.profile.weeklyTimeMin,
      enjoys: ctx.enjoyedNames,
      reported_health_condition: ctx.profile.hasHealthCondition,
    },
    goal: { guideline_minutes: ctx.goalMinutes, rule: "moderate counts 1x, vigorous (>=6 MET) counts 2x" },
    today: ctx.today,
    progress: {
      done_guideline_min: ctx.week.doneMinutes,
      remaining_guideline_min: ctx.week.remainingMinutes,
      percent: ctx.week.percent,
      time_used_min: ctx.week.clockMinutesUsed,
      time_left_min: ctx.timeLeftMinutes,
    },
    sessions: ctx.week.sessions.map((s) => {
      const { family, variant } = getVariant(s.variantId);
      return {
        day: DAY_NAMES_LONG[s.dayIndex],
        activity: `${family.name} (${variant.label})`,
        compendium_code: variant.code,
        met: variant.met,
        minutes: s.durationMin,
        intensity: s.intensity,
        guideline_min: s.credit,
      };
    }),
    plan_options: ctx.options.map((o) => ({
      kind: o.kind,
      title: o.title,
      fits_time: o.fits,
      total_min: o.clockMinutes,
      guideline_min: o.creditMinutes,
      sessions: o.sessions.map((s) => `${DAY_NAMES_LONG[s.dayIndex]}: ${s.durationMin} min ${getVariant(s.variantId).family.noun} (${getVariant(s.variantId).variant.label})`),
    })),
    chosen_plan: ctx.chosenPlan?.kind ?? null,
  };
}
