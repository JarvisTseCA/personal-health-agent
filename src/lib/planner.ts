/**
 * Deterministic planner: given what's left of the weekly goal, the time the
 * user has left, and the activities they enjoy, build a few concrete ways to
 * close the gap.
 *
 * This is intentionally rule-based so the numbers are always correct. When
 * an LLM is added, it should *explain and personalize* these options rather
 * than do the arithmetic itself (see docs/architecture.md).
 *
 * Strategy
 *  - One option per favorite activity (first two the user picked), and one
 *    option that mixes the two.
 *  - Each option uses the gentlest pace that still fits in the time the user
 *    has left. If nothing fits, it uses the most time-efficient pace and is
 *    marked `fits: false` so the UI can be honest about it.
 *  - Sessions are split into short blocks (≤ 30 min by default) and spread
 *    across the remaining days.
 */
import { getFamily, type ActivityFamily, type ActivityVariant } from "./activities";
import { guidelineMinutes, intensityOf, multiplierOf } from "./guideline";

/** "only-cycling", "mix", … — stable id used to remember the chosen plan */
export type PlanKind = string;

export interface PlannedSession {
  variantId: string;
  familyId: string;
  durationMin: number;
  dayIndex: number;
  credit: number;
}

export interface PlanOption {
  kind: PlanKind;
  title: string;
  summary: string;
  sessions: PlannedSession[];
  clockMinutes: number;
  creditMinutes: number;
  /** true when the plan fits inside the user's remaining time */
  fits: boolean;
  /** true when the plan includes vigorous activity */
  hasVigorous: boolean;
  /** true for the option that takes the least clock time */
  leastTime?: boolean;
}

export interface PlanInput {
  remainingMinutes: number;
  timeLeftMinutes: number;
  familyIds: string[];
  /** Day indexes (0 = Mon) still available this week, today included */
  openDays: number[];
  /** Max length of a single block; the persona has short, unpredictable gaps */
  maxBlockMin?: number;
  /** When true, only use moderate variants (user reported a health condition) */
  cautious?: boolean;
}

const roundUp5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

/** Variants that count toward the goal, gentlest first. */
function usable(f: ActivityFamily, cautious: boolean): ActivityVariant[] {
  return f.variants
    .filter((v) => multiplierOf(v.met) > 0)
    .filter((v) => !cautious || intensityOf(v.met) === "moderate")
    .sort((a, b) => a.met - b.met);
}

/** Clock minutes (rounded to 5) to earn `credit` guideline minutes. */
function clockNeeded(v: ActivityVariant, credit: number): number {
  return roundUp5(credit / multiplierOf(v.met));
}

/** Gentlest pace that fits the time budget; otherwise the most efficient pace. */
export function pickVariant(f: ActivityFamily, credit: number, budget: number, cautious = false): ActivityVariant | undefined {
  const vs = usable(f, cautious);
  if (!vs.length) return undefined;
  const fitting = vs.find((v) => clockNeeded(v, credit) <= budget);
  if (fitting) return fitting;
  return [...vs].sort((a, b) => multiplierOf(b.met) - multiplierOf(a.met) || a.met - b.met)[0];
}

function splitIntoBlocks(totalMin: number, maxBlock: number): number[] {
  const n = Math.max(1, Math.ceil(totalMin / maxBlock));
  // Distribute in 5-minute units so blocks differ by at most 5 min.
  const units = totalMin / 5;
  const base = Math.floor(units / n);
  const extra = units % n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * 5);
}

function spreadOverDays(count: number, openDays: number[]): number[] {
  const days = openDays.length ? openDays : [6];
  if (count >= days.length) return Array.from({ length: count }, (_, i) => days[i % days.length]).sort((a, b) => a - b);
  // Spread evenly, leaving rest days in between when possible.
  const step = days.length / count;
  return Array.from({ length: count }, (_, i) => days[Math.min(days.length - 1, Math.floor(i * step))]);
}

function blocksFor(v: ActivityVariant, f: ActivityFamily, credit: number, maxBlock: number): PlannedSession[] {
  return splitIntoBlocks(clockNeeded(v, credit), maxBlock).map((d) => ({
    variantId: v.id,
    familyId: f.id,
    durationMin: d,
    dayIndex: 0,
    credit: guidelineMinutes(v.met, d),
  }));
}

function finalize(kind: PlanKind, title: string, summary: string, sessions: PlannedSession[], openDays: number[], timeLeft: number): PlanOption {
  const days = spreadOverDays(sessions.length, openDays);
  const placed = sessions.map((s, i) => ({ ...s, dayIndex: days[i] }));
  const clockMinutes = placed.reduce((a, s) => a + s.durationMin, 0);
  return {
    kind,
    title,
    summary,
    sessions: placed,
    clockMinutes,
    creditMinutes: placed.reduce((a, s) => a + s.credit, 0),
    fits: clockMinutes <= timeLeft,
    hasVigorous: placed.some((s) => s.credit > s.durationMin),
  };
}

export function buildPlanOptions(input: PlanInput): PlanOption[] {
  const { remainingMinutes: R, timeLeftMinutes: T, openDays, cautious = false } = input;
  const maxBlock = input.maxBlockMin ?? 30;
  const families = input.familyIds.map(getFamily).filter((f) => usable(f, cautious).length > 0);
  if (R <= 0 || families.length === 0) return [];

  const options: PlanOption[] = [];

  // One option per favorite activity (up to two).
  for (const f of families.slice(0, 2)) {
    const v = pickVariant(f, R, T, cautious)!;
    options.push(finalize(`only-${f.id}`, `All ${f.noun}`, v.label, blocksFor(v, f, R, maxBlock), openDays, T));
  }

  // A single activity gets a second, more relaxed or more intense alternative.
  if (families.length === 1) {
    const f = families[0];
    const chosen = options[0].sessions[0].variantId;
    const alt = usable(f, cautious).filter((v) => v.id !== chosen).sort((a, b) => b.met - a.met)[0];
    if (alt) options.push(finalize(`alt-${f.id}`, `${f.name}, ${alt.label.toLowerCase()}`, alt.label, blocksFor(alt, f, R, maxBlock), openDays, T));
  }

  // Mix: split the gap between the first two, gentlest combination that fits.
  if (families.length >= 2) {
    const [a, b] = families;
    const half = R / 2;
    const combos = usable(a, cautious).flatMap((va) => usable(b, cautious).map((vb) => [va, vb] as const));
    const scored = combos
      .map(([va, vb]) => ({ va, vb, clock: clockNeeded(va, half) + clockNeeded(vb, half) }))
      .sort((x, y) => Number(x.clock > T) - Number(y.clock > T) || (x.clock <= T ? x.va.met + x.vb.met - (y.va.met + y.vb.met) : x.clock - y.clock));
    const { va, vb } = scored[0];
    const sa = blocksFor(va, a, half, maxBlock);
    const sb = blocksFor(vb, b, half, maxBlock);
    const merged: PlannedSession[] = [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if (sa[i]) merged.push(sa[i]);
      if (sb[i]) merged.push(sb[i]);
    }
    options.push(finalize("mix", "Mix it up", `${a.name} and ${b.noun}`, merged, openDays, T));
  }

  // Remove duplicates, then flag the option that takes the least time.
  const seen = new Set<string>();
  const unique = options.filter((o) => {
    const key = o.sessions.map((s) => `${s.variantId}:${s.durationMin}`).sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const min = Math.min(...unique.map((o) => o.clockMinutes));
  const fastest = unique.filter((o) => o.clockMinutes === min);
  if (fastest.length === 1 && unique.length > 1) fastest.forEach((o) => (o.leastTime = true));
  return unique;
}

/** How much of a single activity it takes to earn `credit` guideline minutes. */
export function clockFor(variant: ActivityVariant, credit: number): number {
  const m = multiplierOf(variant.met);
  return m === 0 ? Infinity : credit / m;
}
