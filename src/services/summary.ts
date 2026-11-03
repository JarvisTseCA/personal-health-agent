/**
 * The numbers behind the Summary tab, worked out once so the page only
 * draws them. Everything comes from the calculator (never the agent).
 *
 * Two audiences read the same page: the user, who may have low health
 * literacy, and their clinician. So every measure has a plain form
 * ("brisk minutes a week", "days you were active") and a clinical form
 * (MET-hours, percent of the guideline, MET bands) shown with *Details*.
 *
 * "Brisk minutes" are moderate-equivalent minutes: MET-hours ÷ 3 MET × 60.
 * That's the unit the guideline's 150 minutes is written in, and vigorous
 * minutes count about double, as in the guideline.
 */
import { getFamily } from "../lib/activities";
import { GUIDELINE_GOAL, MODERATE_MET, VIGOROUS_MET } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason } from "../lib/suggest";
import type { AgentContext } from "./context";

/** Full weeks averaged for the headline numbers */
export const SUMMARY_WEEKS = 4;
/** Weeks shown in the week-by-week chart, this week included */
export const CHART_WEEKS = 6;

export const briskMinutes = (metHours: number) => Math.round((metHours / MODERATE_MET) * 60);
export const GUIDELINE_MIN = briskMinutes(GUIDELINE_GOAL);

export interface SummaryWeek {
  label: string;
  metHours: number;
  briskMin: number;
  goal: number;
  goalMin: number;
  reached: boolean;
  /** This week, still in progress */
  current: boolean;
}

export interface Summary {
  /** Full weeks behind the averages (0 for a new user) */
  weeks: number;
  avgMetHours: number;
  avgBriskMin: number;
  /** Average as a share of the 7.5 MET-hour guideline */
  pctOfGuideline: number;
  goalMin: number;
  goalWeeks: number;
  avgActiveDays: number;
  chart: SummaryWeek[];
  /** The last full weeks, oldest first: which days had activity */
  calendar: Array<{ label: string; days: boolean[] }>;
  longestGap: number;
  /** Average minutes a week at each effort level, last full weeks */
  intensity: { light: number; moderate: number; vigorous: number };
  /** Average minutes a week per activity, most first */
  mix: Array<{ name: string; color: string; min: number }>;
  /** Plain-language things worth bringing up at a visit */
  mention: string[];
}

export function buildSummary(ctx: AgentContext): Summary {
  const s = ctx.state;
  const recent = ctx.past.slice(-SUMMARY_WEEKS);
  const n = recent.length;
  const avg = (f: (w: (typeof recent)[number]) => number) => (n ? recent.reduce((a, w) => a + f(w), 0) / n : 0);

  const avgMetHours = avg((w) => w.totals.done);
  const sessions = recent.flatMap((w) => w.totals.sessions);
  const perWeek = (min: number) => (n ? Math.round(min / n) : 0);
  const sum = (pred: (met: number) => boolean) => sessions.filter((x) => pred(x.met)).reduce((a, x) => a + x.durationMin, 0);

  const mixMap = new Map<string, number>();
  for (const x of sessions) mixMap.set(x.familyId, (mixMap.get(x.familyId) ?? 0) + x.durationMin);
  const mix = [...mixMap.entries()].sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ name: getFamily(id).name, color: getFamily(id).color, min: perWeek(min) }));

  const chart: SummaryWeek[] = [
    ...ctx.past.map((w) => ({ label: w.label, metHours: w.totals.done, goal: w.goal, current: false })),
    { label: "This week", metHours: ctx.week.done, goal: ctx.goal, current: true },
  ].slice(-CHART_WEEKS).map((w) => ({ ...w, briskMin: briskMinutes(w.metHours), goalMin: briskMinutes(w.goal), reached: w.metHours + 1e-9 >= w.goal }));

  const days = [...ctx.past.flatMap((w) => w.totals.activeByDay), ...ctx.activeDays.slice(0, ctx.todayIndex + 1)];
  let gap = 0;
  let longestGap = 0;
  for (const a of days) { gap = a ? 0 : gap + 1; longestGap = Math.max(longestGap, gap); }

  const reasons = new Map<DeclineReason, number>();
  for (const d of s.declines) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  const healthNotes = s.notes.filter((x) => /health|anything we should know/i.test(x.where) || /pain|hurt|sore|injur|pregnan|blood|heart|diabet|dizz|breath/i.test(x.text));
  const mention: string[] = [];
  if (s.profile.hasHealthCondition) mention.push("You told the app about a health condition, so it's suggesting moderate activity only.");
  if (s.painReports) mention.push(`You said something hurt ${s.painReports === 1 ? "once" : `${s.painReports} times`} when skipping a workout.`);
  for (const x of healthNotes) mention.push(`You wrote: "${x.text}"`);
  if (longestGap >= 5) mention.push(`Your longest stretch without activity was ${longestGap} days.`);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) mention.push(`The most common reason you skipped a workout: "${DECLINE_LABEL[top[0]].toLowerCase()}" (${top[1]} times).`);

  return {
    weeks: n,
    avgMetHours,
    avgBriskMin: briskMinutes(avgMetHours),
    pctOfGuideline: avgMetHours / GUIDELINE_GOAL,
    goalMin: briskMinutes(ctx.goal),
    goalWeeks: recent.filter((w) => w.trophy).length,
    avgActiveDays: avg((w) => w.totals.activeByDay.filter(Boolean).length),
    chart,
    calendar: recent.map((w) => ({ label: w.label, days: w.totals.activeByDay })),
    longestGap,
    intensity: {
      light: perWeek(sum((m) => m < MODERATE_MET)),
      moderate: perWeek(sum((m) => m >= MODERATE_MET && m < VIGOROUS_MET)),
      vigorous: perWeek(sum((m) => m >= VIGOROUS_MET)),
    },
    mix,
    mention,
  };
}
