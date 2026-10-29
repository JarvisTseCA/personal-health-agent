/**
 * Daily suggestion ranker: filter → score → pick one lead and two backups.
 *
 * Rule-based on purpose. The coach writes the suggestion up in friendly
 * words, but the activity, minutes and MET-hours come from here, so they are
 * explainable ("Why this?") and the backend always has a safe fallback.
 */
import { equipmentOf, getFamily, settingOf, type ActivityFamily, type ActivityKind, type ActivityVariant } from "./activities";
import { equipmentName } from "./equipment";
import { countsTowardGoal, creditFor, metHours, VIGOROUS_MET } from "./met";

export type Access = "have" | "sometimes" | "no";
export type Place = "home" | "gym" | "office" | "outside" | "traveling" | "other";
export type Energy = "challenge" | "normal" | "low";

export type DeclineReason = "no-time" | "tired" | "not-mood" | "recent" | "no-access" | "weather" | "hurts" | "other";

export interface Suggestion {
  familyId: string;
  variantId: string;
  durationMin: number;
  met: number;
  /** MET-hours toward the goal */
  credit: number;
  /** For light activity that gets you moving but earns no goal credit */
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
  /**
   * Equipment where the user is exercising today. Leave out when unknown
   * (older profiles): then nothing is filtered by equipment.
   */
  equipmentHere?: string[];
  energy: Energy;
  /** A family id the user said they're in the mood for, or "surprise" */
  mood: string;
  /** MET-hours still needed to reach today's target */
  needed: number;
  /** Today's full target in MET-hours (for "Up for a challenge" = 1.5× this) */
  target?: number;
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

/** Can this be done where the user is today, with what's there? */
export function fitsPlace(f: ActivityFamily, v: ActivityVariant, place: Place, equipmentHere?: string[]): boolean {
  // At the gym, suggest what happens inside it.
  if (place === "gym" && settingOf(f, v) === "outdoor") return false;
  if (!equipmentHere) return true;
  const needs = equipmentOf(f, v);
  return needs.length === 0 || needs.some((e) => equipmentHere.includes(e));
}

function allowed(f: ActivityFamily, v: ActivityVariant, input: SuggestInput): boolean {
  if (input.noVigorous && v.met >= VIGOROUS_MET) return false;
  if (!fitsPlace(f, v, input.place, input.equipmentHere)) return false;
  const c = input.constraint;
  if (c?.indoorOnly && settingOf(f, v) === "outdoor") return false;
  if (c?.maxMet !== undefined && v.met >= c.maxMet) return false;
  if (c?.notKind && f.kind === c.notKind) return false;
  return creditFor(v.met, 10) > 0;
}

/** "Up for a challenge" (or "I want more") aims for this much of today's target. */
export const CHALLENGE_FACTOR = 1.5;

const stretching = (input: SuggestInput) => input.boost || input.energy === "challenge";

/**
 * MET-hours to aim for in this session. Normal: what's left of today's
 * target. Challenge: enough to reach 1.5× today's target in total.
 */
function aim(input: SuggestInput): number {
  if (!stretching(input)) return Math.max(0, input.needed);
  const target = input.target ?? input.needed;
  if (target <= 0) return input.boost ? CHALLENGE_FACTOR : 0;
  const doneToday = Math.max(0, target - input.needed);
  return Math.max(0, target * CHALLENGE_FACTOR - doneToday);
}

export interface ChallengePlan {
  variant: ActivityVariant;
  durationMin: number;
  /** Today's usual session length for this activity */
  usualMin: number;
  /** A harder pace than the easiest one */
  harder: boolean;
  /** Longer than usual, because even the hardest pace falls short */
  longer: boolean;
}

/**
 * "Up for a challenge" earns its extra MET-hours with intensity, not time.
 *
 * Usual length = the shortest allowed session that covers today's need at the
 * activity's easiest pace that counts toward the goal. The challenge keeps
 * that length and picks the gentlest pace that reaches the aim (1.5× today's
 * target), trimming the session if that pace gets there sooner. Only if even
 * the hardest pace falls short does it get longer.
 */
export function challengePlan(variants: ActivityVariant[], choices: number[], need: number, want: number): ChallengePlan | null {
  const paces = variants.filter((v) => countsTowardGoal(v.met)).sort((a, b) => a.met - b.met);
  if (paces.length === 0 || choices.length === 0) return null;
  const easiest = paces[0];
  const usualMin = need > 0
    ? choices.find((d) => creditFor(easiest.met, d) + 1e-9 >= need) ?? choices[choices.length - 1]
    : choices.filter((d) => d <= 20).at(-1) ?? choices[0];
  const reaches = (v: ActivityVariant, d: number) => creditFor(v.met, d) + 1e-9 >= want;

  const hit = paces.find((v) => reaches(v, usualMin));
  if (hit) {
    const d = choices.find((x) => x <= usualMin && reaches(hit, x)) ?? usualMin;
    return { variant: hit, durationMin: d, usualMin, harder: hit.met > easiest.met, longer: false };
  }

  const hardest = paces[paces.length - 1];
  const d = choices.find((x) => x >= usualMin && reaches(hardest, x)) ?? choices[choices.length - 1];
  return { variant: hardest, durationMin: d, usualMin, harder: hardest.met > easiest.met, longer: d > usualMin };
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
    if (r + 1e-9 >= 1) reasons.push(stretching(input) ? "Goes past today's target" : "Covers today's target");
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

  // Equipment where the user is: prefer the variant that uses it.
  const uses = equipmentOf(f, v).filter((e) => input.equipmentHere?.includes(e));
  if (uses.length) {
    score += 0.6;
    reasons.splice(1, 0, `Uses the ${equipmentName(uses[0]).toLowerCase()}${input.place === "gym" ? " at your gym" : input.place === "home" ? " you have at home" : ""}`);
  }
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
      reasons: ["Works at your desk", "Every bit of movement helps"], score: 0, pattern,
    } satisfies Suggestion;
  });
  return { lead: opts[0], backups: opts.slice(1), desk: true };
}

/**
 * What passes the hard filters today: enjoyed, accessible, not ruled out,
 * allowed by health limits and today's constraints, and the session lengths
 * that fit. The ranker scores these; the backend sends them to Jev as options.
 */
export function candidates(input: SuggestInput): { options: Array<{ family: ActivityFamily; variant: ActivityVariant }>; durations: number[] } {
  const durations = durationChoices(input.minutes, input.maxSessionMin);
  if (input.minutes <= 0 || durations.length === 0) return { options: [], durations: [] };
  const options = input.enjoyed
    .filter((id) => !input.exclude.includes(id) && input.access[id] !== "no")
    .map(getFamily)
    .filter((f) => !f.fallbackOnly)
    .flatMap((family) => family.variants.filter((v) => allowed(family, v, input)).map((variant) => ({ family, variant })));
  return { options, durations };
}

export function suggest(input: SuggestInput): SuggestResult {
  const { options, durations: choices } = candidates(input);
  if (choices.length === 0) return deskOptions();

  const want = aim(input);
  const challenge = stretching(input) && want > 0;
  const best: Suggestion[] = [];
  for (const f of [...new Set(options.map((o) => o.family))]) {
    if (challenge) {
      const plan = challengePlan(options.filter((o) => o.family === f).map((o) => o.variant), choices, input.needed, want);
      if (plan) {
        const v = plan.variant;
        const d = plan.durationMin;
        const { score, reasons, credit } = scoreOne(f, v, d, input);
        const pace = !plan.harder || plan.longer ? null : d < plan.usualMin ? "Harder pace, shorter than usual" : "Usual length, harder pace";
        const why = pace ? [pace, ...reasons] : reasons;
        best.push({
          familyId: f.id, variantId: v.id, durationMin: d, met: v.met, credit, rawMetHours: metHours(v.met, d),
          reasons: [...new Set(why)].slice(0, 3),
          // Getting there by time instead of intensity is the fallback, so rank it lower.
          score: score - (plan.longer ? 1.5 : 0),
        });
        continue;
      }
    }
    let top: Suggestion | null = null;
    for (const { variant: v } of options.filter((o) => o.family === f)) {
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
