/**
 * Daily suggestion ranker: filter → score → pick one lead and two backups.
 *
 * Rule-based on purpose. The coach writes the suggestion up in friendly
 * words, but the activity, minutes and MET-hours come from here, so they are
 * explainable ("Why this?") and the backend always has a safe fallback.
 */
import { getFamily, settingOf, type ActivityFamily, type ActivityKind, type ActivityVariant } from "./activities";
import { creditFor, metHours, VIGOROUS_MET } from "./met";

export type Access = "have" | "sometimes" | "no";
export type Place = "home" | "office" | "outside" | "traveling";
export type Energy = "challenge" | "normal" | "low";

export type DeclineReason = "no-time" | "tired" | "not-mood" | "recent" | "no-access" | "weather" | "hurts" | "other";

export interface Suggestion {
  familyId: string;
  variantId: string;
  durationMin: number;
  met: number;
  /** MET-hours toward the goal */
  credit: number;
  /** For light activity that earns a medal but no goal credit */
  rawMetHours: number;
  reasons: string[];
  score: number;
  /** Short line for desk moves ("3 × 2 min between meetings") */
  pattern?: string;
}

export interface Constraint {
  indoorOnly?: boolean;
  /** Only variants below this MET (after "too tired") */
  maxMet?: number;
  /** A different kind of activity than this (after "did this recently") */
  notKind?: ActivityKind;
}

export interface SuggestInput {
  /** Enjoyed family ids, favorite first */
  enjoyed: string[];
  access: Record<string, Access>;
  /** Health flag or clinician limit: nothing at or above 6 MET */
  noVigorous: boolean;
  maxSessionMin: number | null;
  minutes: number;
  place: Place;
  energy: Energy;
  /** A family id the user said they're in the mood for, or "surprise" */
  mood: string;
  /** MET-hours still needed to reach today's target */
  needed: number;
  /** "I want more today" */
  boost: boolean;
  /** Families done recently, with how many days ago */
  recent: Array<{ familyId: string; daysAgo: number; dayName: string }>;
  /** Past declines with how many days ago */
  declines: Array<{ familyId: string; reason: DeclineReason; daysAgo: number }>;
  /** Families ruled out today (declined, or no access) */
  exclude: string[];
  constraint?: Constraint;
}

export interface SuggestResult {
  lead: Suggestion | null;
  backups: Suggestion[];
  /** True when the options are desk moves because there's no time today */
  desk: boolean;
}

const DURATIONS = [10, 15, 20, 25, 30, 40, 45, 60];

function durationChoices(minutes: number, cap: number | null): number[] {
  const limit = Math.min(minutes, cap ?? Infinity);
  const ds = DURATIONS.filter((d) => d <= limit);
  return ds.length ? ds : limit > 0 ? [limit] : [];
}

function allowed(f: ActivityFamily, v: ActivityVariant, input: SuggestInput): boolean {
  if (input.noVigorous && v.met >= VIGOROUS_MET) return false;
  const c = input.constraint;
  if (c?.indoorOnly && settingOf(f, v) === "outdoor") return false;
  if (c?.maxMet !== undefined && v.met >= c.maxMet) return false;
  if (c?.notKind && f.kind === c.notKind) return false;
  return creditFor(v.met, 10) > 0;
}

/** How much of the remaining target to aim for. */
function aim(input: SuggestInput): number {
  if (input.needed > 0) return input.needed * (input.boost ? 1.5 : 1);
  return input.boost ? 1.5 : 0;
}

function pickDuration(v: ActivityVariant, choices: number[], want: number): number {
  if (want <= 0) return choices.filter((d) => d <= 20).at(-1) ?? choices[0];
  return choices.find((d) => creditFor(v.met, d) + 1e-9 >= want) ?? choices[choices.length - 1];
}

function scoreOne(f: ActivityFamily, v: ActivityVariant, d: number, input: SuggestInput) {
  const reasons: string[] = [];
  const want = aim(input);
  const credit = creditFor(v.met, d);
  let score = 0;

  const rank = input.enjoyed.indexOf(f.id);
  const n = Math.max(1, input.enjoyed.length);
  score += 3 * (1 - rank / n);
  if (rank === 0) reasons.push("Your favorite");
  else if (rank === 1) reasons.push("Your second favorite");

  if (input.mood === f.id) {
    score += 3;
    reasons.unshift("What you're in the mood for");
  }

  if (want > 0) {
    const r = credit / want;
    if (r < 1) score -= (1 - r) * 3;
    if (r > 1.5) score -= (r - 1.5) * 2;
    if (r + 1e-9 >= 1) reasons.push(input.boost ? "Goes past today's target" : "Covers today's target");
  }
  reasons.push(`Fits in ${input.minutes} min`);

  const recent = input.recent.filter((x) => x.familyId === f.id).sort((a, b) => a.daysAgo - b.daysAgo)[0];
  if (recent?.daysAgo === 0) score -= 1.5;
  else if (recent?.daysAgo === 1) score -= 2.5;
  else if (recent?.daysAgo === 2) score -= 1.2;
  else reasons.push(recent ? `Not done since ${recent.dayName}` : "Not done in the last few days");

  const moodDecline = input.declines.find((x) => x.familyId === f.id && x.reason === "not-mood" && x.daysAgo <= 7);
  if (moodDecline) score -= 2.5;

  if (input.access[f.id] === "sometimes") score -= 0.7;
  if (input.place === "traveling" && f.needs) score -= 2;

  if (input.energy === "low") {
    if (v.met > 5) score -= (v.met - 5) * 0.8;
    else reasons.push("Easy on a low-energy day");
  } else if (input.energy === "challenge") {
    score += v.met >= 6 ? 0.8 : -0.4;
    if (v.met >= 6) reasons.push("A challenge, like you asked");
  } else if (v.met > 6.5) {
    // Normal energy: prefer getting partway at a moderate pace (the coach can
    // nudge "keep going") over jumping to vigorous just to cover the target.
    score -= (v.met - 6.5) * 0.5;
  }

  if (input.constraint?.indoorOnly) reasons.push("Indoors");
  if (input.constraint?.maxMet !== undefined) reasons.push("Lighter than before");
  if (input.constraint?.notKind) reasons.push("A different type of activity");

  return { score, reasons: [...new Set(reasons)].slice(0, 3), credit };
}

function deskOptions(): SuggestResult {
  const f = getFamily("desk");
  const plans: Array<[string, number, string]> = [
    ["desk-band", 6, "3 × 2 min between meetings"],
    ["desk-sitstand", 5, "5 × 1 min, once an hour"],
    ["desk-stretch", 5, "A 5-minute stretch break"],
  ];
  const opts = plans.map(([vid, d, pattern]) => {
    const v = f.variants.find((x) => x.id === vid)!;
    return {
      familyId: f.id, variantId: v.id, durationMin: d, met: v.met, credit: creditFor(v.met, d), rawMetHours: metHours(v.met, d),
      reasons: ["Works at your desk", "Earns today's bronze"], score: 0, pattern,
    } satisfies Suggestion;
  });
  return { lead: opts[0], backups: opts.slice(1), desk: true };
}

export function suggest(input: SuggestInput): SuggestResult {
  const choices = durationChoices(input.minutes, input.maxSessionMin);
  if (input.minutes <= 0 || choices.length === 0) return deskOptions();

  const families = input.enjoyed
    .filter((id) => !input.exclude.includes(id) && input.access[id] !== "no")
    .map(getFamily)
    .filter((f) => !f.fallbackOnly);

  const best: Suggestion[] = [];
  for (const f of families) {
    let top: Suggestion | null = null;
    for (const v of f.variants) {
      if (!allowed(f, v, input)) continue;
      const d = pickDuration(v, choices, aim(input));
      const { score, reasons, credit } = scoreOne(f, v, d, input);
      if (!top || score > top.score) top = { familyId: f.id, variantId: v.id, durationMin: d, met: v.met, credit, rawMetHours: metHours(v.met, d), reasons, score };
    }
    if (top) best.push(top);
  }

  best.sort((a, b) => b.score - a.score);
  const lead = best[0] ?? null;
  if (!lead) return { lead: null, backups: [], desk: false };
  const leadKind = getFamily(lead.familyId).kind;
  const rest = best.slice(1);
  const differentKind = rest.filter((s) => getFamily(s.familyId).kind !== leadKind);
  const backups = [...differentKind, ...rest.filter((s) => !differentKind.includes(s))].slice(0, 2);
  return { lead, backups, desk: false };
}

/** Constraint to apply after a decline reason, and families to rule out today. */
export function afterDecline(reason: DeclineReason, s: Suggestion, prev?: Constraint): { constraint: Constraint; excludeFamily: boolean; minutes?: number } {
  const c: Constraint = { ...prev };
  switch (reason) {
    case "no-time": return { constraint: c, excludeFamily: false, minutes: 10 };
    case "tired": return { constraint: { ...c, maxMet: Math.min(s.met, c.maxMet ?? Infinity) }, excludeFamily: false };
    case "not-mood": return { constraint: c, excludeFamily: true };
    case "recent": return { constraint: { ...c, notKind: getFamily(s.familyId).kind }, excludeFamily: true };
    case "no-access": return { constraint: c, excludeFamily: true };
    case "weather": return { constraint: { ...c, indoorOnly: true }, excludeFamily: false };
    case "hurts": return { constraint: { ...c, maxMet: 3.5 }, excludeFamily: false };
    case "other": return { constraint: c, excludeFamily: true };
  }
}

export const DECLINE_LABEL: Record<DeclineReason, string> = {
  "no-time": "No time",
  tired: "Too tired",
  "not-mood": "Not in the mood for this",
  recent: "Did this recently",
  "no-access": "Can't access it",
  weather: "Weather",
  hurts: "Something hurts",
  other: "Other",
};
