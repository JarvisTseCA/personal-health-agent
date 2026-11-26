/**
 * For tests only: the numbers in the backend's shape (memoryTypes.ts), worked out by the
 * app's own calculator. A test that needs "what the backend would send" for a state can use
 * this instead of a running backend. The two calculators are held to the same answers by the
 * shared examples (shared_examples/), so for a state laid out by toMemory() they agree.
 */
import { DAY_NAMES_LONG } from "../lib/met";
import { groupWeeks } from "../lib/periods";
import type { AppState } from "../state/types";
import { ownContext, reachedToday, weekStart, type PastWeek } from "./context";
import { addDays, addMonths, type Numbers, type NumbersWeek } from "./memoryTypes";
import { ownSummary } from "./summary";
import { toMemory } from "./toMemory";

const two = (n: number) => String(n).padStart(2, "0");

/** What GET /api/numbers would give for this state, with this week starting on `sunday`. */
export function numbersLike(state: AppState, sunday: string): Numbers {
  const ctx = ownContext(state);
  const sum = ownSummary(ctx);
  const memory = toMemory(state, sunday);
  const nameOf = new Map(memory.daily.workouts.map((w) => [w.id, w]));
  const starts = ctx.past.map((_, i) => addDays(sunday, -7 * (ctx.past.length - i)));

  const weekOf = (start: string, goal: number, plan: readonly string[], totals: PastWeek["totals"], opens: boolean[], trophy: boolean): NumbersWeek => ({
    week_start: start, goal_met_hours: goal, plan: [...plan],
    done_met_hours: totals.done, done_by_day: totals.doneByDay, active_days: totals.activeByDay, app_opens: opens, trophy,
    minutes: totals.minutesUsed, top_activity: null,
    workouts: totals.sessions.map((s) => ({
      id: s.id, day: s.dayIndex, activity_code: nameOf.get(s.id)?.activity_code ?? null, activity_name: nameOf.get(s.id)?.activity_name ?? "",
      duration_min: s.durationMin, counted_met: s.met, met_hours: s.credit, intensity: s.intensity,
    })),
  });

  const past = ctx.past.map((w, i) => weekOf(starts[i], w.goal, w.plan, w.totals, w.signIns, w.trophy));
  const months = groupWeeks(ctx.past.map((w) => ({ start: w.start, label: w.label, done: w.totals.done, goal: w.goal, active: w.totals.activeByDay, signIns: w.signIns })), weekStart(0));
  const today = addDays(sunday, state.todayIndex);
  const month = today.slice(0, 7);
  const vo2 = state.vo2 ?? [];

  return {
    today,
    today_index: state.todayIndex,
    day: { name: DAY_NAMES_LONG[state.todayIndex], target_met_hours: ctx.todayTarget, done_met_hours: ctx.todayDone, needed_met_hours: ctx.todayNeeded, reached: reachedToday(ctx) },
    this_week: {
      ...weekOf(sunday, ctx.goal, state.plan, ctx.week, ctx.signIns, ctx.trophy),
      active_days: ctx.activeDays, left_met_hours: ctx.left, targets: ctx.targets, unplanned_met_hours: ctx.unplanned,
    },
    streak: ctx.streak,
    trophy: ctx.trophy,
    trophies: ctx.trophies,
    past_weeks: past,
    months: months.map((m) => ({
      month: `${m.year}-${two(m.month + 1)}`, week_starts: m.weeks.map((w) => starts[ctx.past.findIndex((x) => x.start === w.start)]),
      done_met_hours: m.done, goal_met_hours: m.goal, trophies: m.trophies, active_days: m.activeDays, app_open_days: m.signInDays,
      best_streak: m.bestStreak, partial: m.partial,
    })),
    goal_offer: ctx.offer,
    summary: {
      weeks: sum.weeks, avg_met_hours: sum.avgMetHours, avg_brisk_min: sum.avgBriskMin, pct_of_guideline: sum.pctOfGuideline,
      goal_min: sum.goalMin, goal_weeks: sum.goalWeeks, avg_active_days: sum.avgActiveDays,
      chart: sum.chart.map((c, i, all) => ({
        week_start: c.current ? sunday : starts[starts.length - (all.length - 1 - i)], current: c.current,
        met_hours: c.metHours, brisk_min: c.briskMin, goal_met_hours: c.goal, goal_min: c.goalMin, reached: c.reached,
      })),
      calendar: sum.calendar.map((c, i, all) => ({ week_start: starts[starts.length - (all.length - i)], days: c.days })),
      longest_gap: sum.longestGap, intensity: sum.intensity,
      mix: sum.mix.map((m) => ({ activity_code: null, activity_name: m.name, min_per_week: m.min })),
    },
    vo2: ctx.vo2 && {
      series: vo2.map((value, i) => ({ month: addMonths(month, i - (vo2.length - 1)), ml_kg_min: value })),
      latest: ctx.vo2.latest, change: ctx.vo2.change, peak_mets: ctx.vo2.peakMets,
    },
  };
}
