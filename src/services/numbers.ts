/**
 * Showing the backend's numbers: when the app runs with the backend, everything on screen
 * that is worked out comes from the backend (GET /api/numbers, memoryTypes.ts), and the
 * app's own calculator is not asked.
 *
 * This file holds the numbers the backend last gave and turns them into the shapes the
 * screens already use, so no screen has to know where its numbers came from:
 *
 *    contextFromNumbers()   → AgentContext (context.ts): this week, today, streak, trophies,
 *                             past weeks, goal offer, VO2 max
 *    summaryFromNumbers()   → the Summary page (summary.ts)
 *    periodsFromNumbers()   → the month view on Progress (periods.ts)
 *
 * buildAgentContext(), buildSummary() and Progress ask numbersFor() first. It answers null
 * when the app runs without the backend, and then they work the numbers out as before.
 *
 * Two sets can be held at once. A step in the app is first told to the backend, which sends
 * back the numbers as they are after it; only then does the step run. While it runs, the
 * state as it was (before the workout was added, say) gets the numbers on screen, and the
 * state the step produces gets the new ones. That is how "Trophy earned!" can tell that the
 * trophy is new.
 */
import { ACTIVITIES, getFamily, getVariant } from "../lib/activities";
import { guidanceOf } from "../lib/clinicianNotes";
import type { Session, SessionWithCredit, WeekTotals } from "../lib/met";
import type { Period, WeekIn } from "../lib/periods";
import type { WeekPlan } from "../lib/plan";
import { tableId } from "../lib/tableActivities";
import type { AppState } from "../state/types";
import type { AgentContext, PastWeek } from "./context";
import type { Numbers, NumbersWeek } from "./memoryTypes";
import type { Summary } from "./summary";

interface Held {
  key: string;
  numbers: Numbers;
}

/** For the state on screen. null: the app runs without the backend. */
let shown: Held | null = null;
/** For the state the step now running will produce. */
let ahead: Held | null = null;

const historyKeys = new WeakMap<object, string>();

/** Two states with the same key have the same numbers: it is everything the numbers are worked out from. */
export function numbersKey(state: AppState): string {
  let history = historyKeys.get(state.history);
  if (history === undefined) {
    history = JSON.stringify(state.history);
    historyKeys.set(state.history, history);
  }
  return JSON.stringify([state.todayIndex, state.goal, state.plan, state.signIns, state.vo2, state.sessions]) + history;
}

/** The backend's numbers for this state; null when the app works its own out. */
export function numbersFor(state: AppState): Numbers | null {
  if (!shown) return null;
  // Any other state a step looks at (the week without the workout being confirmed, say) is "as things were".
  return ahead && ahead.key === numbersKey(state) ? ahead.numbers : shown.numbers;
}

/** The numbers for the state on screen. null hands the numbers back to the app's own calculator. */
export function showNumbers(state: AppState | null, numbers: Numbers | null): void {
  shown = state && numbers ? { key: numbersKey(state), numbers } : null;
  ahead = null;
}

/** The numbers as they will be once the step now running is done; `state` is what it produces. */
export function numbersAhead(state: AppState, numbers: Numbers): void {
  ahead = { key: numbersKey(state), numbers };
}

// --- AgentContext --------------------------------------------------------------------------------

const DEFAULT_COLOR = "#8C89A6";

/** "2026-11-16" as a date on the user's own calendar. */
const dateOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const weekLabelOf = (iso: string) => dateOf(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** A week's workouts as the app lists them, each with what the backend counted it at. */
function sessionsOf(week: NumbersWeek, byId: Map<string, Session>): SessionWithCredit[] {
  return week.workouts.flatMap((w) => {
    const s = w.id ? byId.get(w.id) : undefined;
    if (!s) return [];
    return [{ ...s, familyId: getVariant(s.variantId).family.id, met: w.counted_met, intensity: w.intensity, credit: w.met_hours }];
  });
}

function totalsOf(week: NumbersWeek, byId: Map<string, Session>): WeekTotals {
  return { sessions: sessionsOf(week, byId), done: week.done_met_hours, doneByDay: week.done_by_day, activeByDay: week.active_days, minutesUsed: week.minutes };
}

/** The context every screen and the agent see, with the backend's numbers in it. */
export function contextFromNumbers(state: AppState, n: Numbers): AgentContext {
  const byId = new Map([...state.history.flatMap((w) => w.sessions), ...state.sessions].map((s) => [s.id, s]));
  const week = n.this_week;
  const guidance = guidanceOf(state.clinician.entries);

  const past: PastWeek[] = n.past_weeks.map((w) => ({
    label: weekLabelOf(w.week_start),
    start: dateOf(w.week_start),
    plan: w.plan as WeekPlan,
    goal: w.goal_met_hours,
    totals: totalsOf(w, byId),
    signIns: w.app_opens,
    trophy: w.trophy,
  }));

  return {
    goal: week.goal_met_hours,
    goalBy: state.goalSource,
    steppingStone: week.goal_met_hours < 7.5 - 1e-9,
    today: n.day.name,
    todayIndex: n.today_index,
    week: totalsOf(week, byId),
    targets: week.targets,
    todayTarget: n.day.target_met_hours,
    todayDone: n.day.done_met_hours,
    todayNeeded: n.day.needed_met_hours,
    todayReached: n.day.reached,
    left: week.left_met_hours,
    unplanned: week.unplanned_met_hours,
    activeDays: week.active_days,
    signIns: week.app_opens,
    streak: n.streak,
    trophy: n.trophy,
    trophies: n.trophies,
    vo2: n.vo2 && {
      series: n.vo2.series.map((r) => ({ label: dateOf(`${r.month}-01`).toLocaleDateString(undefined, { month: "short" }), value: r.ml_kg_min })),
      latest: n.vo2.latest,
      change: n.vo2.change,
      peakMets: n.vo2.peak_mets,
    },
    past,
    offer: n.goal_offer,
    noVigorous: state.profile.hasHealthCondition || guidance.moderateOnly,
    guidance,
    enjoyedNames: state.profile.enjoyed.map((id) => getFamily(id).noun),
    state,
  };
}

// --- The Summary page ----------------------------------------------------------------------------

/** The color the app draws an activity in: its table row's, or the activity family of that name. */
function colorOf(code: string | null, name: string): string {
  try {
    if (code) return getFamily(tableId(code)).color;
  } catch {
    /* a table activity this browser hasn't been shown: fall through to its name */
  }
  return ACTIVITIES.find((f) => f.name === name)?.color ?? DEFAULT_COLOR;
}

/** The numbers behind the Summary page. The "things to mention" are sentences, written by summary.ts. */
export function summaryFromNumbers(n: Numbers): Omit<Summary, "mention"> {
  const s = n.summary;
  return {
    weeks: s.weeks,
    avgMetHours: s.avg_met_hours,
    avgBriskMin: s.avg_brisk_min,
    pctOfGuideline: s.pct_of_guideline,
    goalMin: s.goal_min,
    goalWeeks: s.goal_weeks,
    avgActiveDays: s.avg_active_days,
    chart: s.chart.map((w) => ({
      label: w.current ? "This week" : weekLabelOf(w.week_start), metHours: w.met_hours, briskMin: w.brisk_min,
      goal: w.goal_met_hours, goalMin: w.goal_min, reached: w.reached, current: w.current,
    })),
    calendar: s.calendar.map((w) => ({ label: weekLabelOf(w.week_start), days: w.days })),
    longestGap: s.longest_gap,
    intensity: s.intensity,
    mix: s.mix.map((a) => ({ name: a.activity_name, color: colorOf(a.activity_code, a.activity_name), min: a.min_per_week })),
  };
}

// --- The month view on Progress ------------------------------------------------------------------

/** Past weeks by month, newest first, as the backend added them up. `past` is the context's past weeks. */
export function periodsFromNumbers(past: PastWeek[], n: Numbers): Period[] {
  const weekOf = new Map(past.map((w, i) => [n.past_weeks[i]?.week_start, w]));
  return n.months.map((m) => {
    const year = Number(m.month.slice(0, 4));
    const month = Number(m.month.slice(5, 7)) - 1;
    const weeks: WeekIn[] = m.week_starts.flatMap((start) => {
      const w = weekOf.get(start);
      return w ? [{ start: w.start, label: w.label, done: w.totals.done, goal: w.goal, active: w.totals.activeByDay, signIns: w.signIns, plan: w.plan, trophy: w.trophy }] : [];
    });
    return {
      key: `${year}-${month}`, year, month,
      label: new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      weeks, done: m.done_met_hours, goal: m.goal_met_hours, trophies: m.trophies,
      activeDays: m.active_days, signInDays: m.app_open_days, bestStreak: m.best_streak, partial: m.partial,
    };
  });
}
