/**
 * The digestible summary a clinician sees in the Clinician tab: a few plain
 * sentences and key numbers they can take in during a visit, built from
 * the calculator's numbers (never the agent's).
 */
import { getFamily } from "../lib/activities";
import { fmt, fmtGoal, GUIDELINE_GOAL, VIGOROUS_MET } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason } from "../lib/suggest";
import type { AgentContext } from "./context";

export const SUMMARY_WEEKS = 4;

export interface ClinicianSummary {
  weeks: number;
  avgMetHours: number;
  /** Average as a share of the 7.5 MET-hour guideline */
  avgPctOfGuideline: number;
  /** The same average, as minutes of moderate activity (3 MET) */
  avgModerateMin: number;
  goalWeeks: number;
  avgActiveDays: number;
  vigorousShare: number;
  topActivities: Array<{ name: string; min: number; color: string }>;
  skipReasons: Array<{ label: string; n: number }>;
  longestGap: number;
  /** Plain-language sentences, in reading order */
  lines: string[];
}

export function buildClinicianSummary(ctx: AgentContext): ClinicianSummary {
  const s = ctx.state;
  const name = s.profile.name;
  const recent = ctx.past.slice(-SUMMARY_WEEKS);
  const n = recent.length;
  const total = recent.reduce((a, w) => a + w.totals.done, 0);
  const avg = n ? total / n : 0;
  const goalWeeks = recent.filter((w) => w.trophy).length;
  const avgActiveDays = n ? recent.reduce((a, w) => a + w.totals.activeByDay.filter(Boolean).length, 0) / n : 0;

  const sessions = recent.flatMap((w) => w.totals.sessions);
  const minutes = sessions.reduce((a, x) => a + x.durationMin, 0);
  const vigorous = sessions.filter((x) => x.met >= VIGOROUS_MET).reduce((a, x) => a + x.durationMin, 0);
  const mix = new Map<string, number>();
  for (const x of sessions) mix.set(x.familyId, (mix.get(x.familyId) ?? 0) + x.durationMin);
  const topActivities = [...mix.entries()].sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ name: getFamily(id).name, min, color: getFamily(id).color }));

  const reasons = new Map<DeclineReason, number>();
  for (const d of s.declines) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
  const skipReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, k]) => ({ label: DECLINE_LABEL[r], n: k }));

  const days = [...ctx.past.flatMap((w) => w.totals.activeByDay), ...ctx.activeDays.slice(0, ctx.todayIndex + 1)];
  let gap = 0;
  let longestGap = 0;
  for (const a of days) { gap = a ? 0 : gap + 1; longestGap = Math.max(longestGap, gap); }

  const pct = avg / GUIDELINE_GOAL;
  const lines: string[] = [];
  if (n === 0) {
    lines.push(`${name} is new to the app: no full weeks recorded yet. This week so far: ${fmt(ctx.week.done)} MET-hours.`);
  } else {
    lines.push(`Over the last ${n} ${n === 1 ? "week" : "weeks"}, ${name} averaged ${fmt(avg)} MET-hours a week: ${Math.round(pct * 100)}% of the guideline, about ${Math.round((avg / 3) * 60)} min of moderate activity.`);
    lines.push(`Reached their weekly goal in ${goalWeeks} of ${n} weeks, active on about ${Math.round(avgActiveDays)} days a week.`);
    if (topActivities.length) {
      const top = topActivities.slice(0, 2).map((a) => a.name.toLowerCase()).join(" and ");
      lines.push(`Mostly ${top}; ${minutes ? Math.round((vigorous / minutes) * 100) : 0}% of active minutes were vigorous (6 MET or more).`);
    }
  }
  if (ctx.vo2) {
    const v = ctx.vo2;
    const since = v.series.length > 1 ? `, ${v.change > 0 ? `up ${v.change}` : v.change < 0 ? `down ${-v.change}` : "unchanged"} since ${v.series[0].label}` : "";
    lines.push(`VO2 max (Fitbit estimate): ${v.latest} mL/kg/min${since}.`);
  }
  lines.push(`Current goal: ${fmtGoal(ctx.goal)} MET-hours a week, set by ${name}${ctx.steppingStone ? " as a stepping stone back to 7.5" : ""}.`);

  return {
    weeks: n, avgMetHours: avg, avgPctOfGuideline: pct, avgModerateMin: (avg / 3) * 60, goalWeeks, avgActiveDays,
    vigorousShare: minutes ? vigorous / minutes : 0, topActivities, skipReasons, longestGap, lines,
  };
}
