/**
 * The line shown beside the weekly goal: who set it, when, and for the agent's offers, why.
 *   default → "The guideline: 150 min of moderate or 75 min of vigorous activity a week"
 *   user    → "Set by you on Nov 25"
 *   agent   → "Suggested by the agent, accepted on Nov 23. You reached at least 10 MET-hours in each of the last 2 weeks."
 */
import type { AppState, GoalSet } from "../state/types";

/** The calendar date of a day of the app's week (Monday = 0), as "YYYY-MM-DD" in local time. */
export function appDate(todayIndex: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + todayIndex);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-11-25" → "Nov 25", read as a local date (no day shift west of Greenwich). */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function goalNote(state: Pick<AppState, "goal" | "goalSource" | "goalSet">): string {
  const g: GoalSet | undefined = state.goalSet;
  if (!g) {
    if (state.goalSource === "default") return "The guideline: 150 min of moderate or 75 min of vigorous activity a week.";
    return state.goalSource === "recap" ? "Suggested by the agent and accepted." : "Set by you.";
  }
  if (g.by === "user") return `Set by you on ${shortDate(g.on)}.`;
  return `Suggested by the agent, accepted on ${shortDate(g.on)}.${g.reason ? ` ${g.reason}` : ""}`;
}

/** The goal people may set: 1 to 30 MET-hours a week, in steps of 0.5. */
export function clampGoal(n: number): number {
  return Math.min(30, Math.max(1, Math.round(n * 2) / 2));
}
