/**
 * The verifier's guardrail checks, run on every suggestion before the user
 * sees it. In the real backend a second agent runs these plus a language
 * check on the coach's text; here they run in code and the demo panel shows
 * the results ("What the verifier checked").
 */
import { getFamily, getVariant } from "./activities";
import { creditFor, fmt, VIGOROUS_MET } from "./met";
import type { Suggestion, SuggestInput } from "./suggest";

export interface Check {
  name: string;
  rule: string;
  ok: boolean;
  detail: string;
}

export function verifySuggestion(s: Suggestion, input: SuggestInput, shownCredit?: number): Check[] {
  const { family, variant } = getVariant(s.variantId);
  const recomputed = creditFor(variant.met, s.durationMin);
  const desk = family.fallbackOnly === true;
  const yesterday = input.recent.some((r) => r.familyId === s.familyId && r.daysAgo === 1);
  const otherOptions = input.enjoyed.filter((id) => id !== s.familyId && input.access[id] !== "no").length > 0;

  return [
    {
      name: "MET source",
      rule: "Every MET value maps to a Compendium code",
      ok: /^\d{5}$/.test(variant.code) && variant.met === s.met,
      detail: `${family.name}, ${variant.label.toLowerCase()}: code ${variant.code}, ${variant.met} MET`,
    },
    {
      name: "Arithmetic",
      rule: "Numbers shown equal the calculator's",
      ok: Math.abs(recomputed - (shownCredit ?? s.credit)) < 0.05,
      detail: `${variant.met} × ${s.durationMin} / 60 = ${fmt(recomputed)} MET-hours`,
    },
    {
      name: "Time fit",
      rule: "Minutes fit the time available today",
      ok: desk || s.durationMin <= input.minutes,
      detail: desk ? "Desk moves, offered when there's no free time" : `${s.durationMin} of ${input.minutes} min`,
    },
    {
      name: "Preference",
      rule: "On the enjoyed list and accessible",
      ok: desk || (input.enjoyed.includes(s.familyId) && input.access[s.familyId] !== "no"),
      detail: desk ? "Desk moves are the one allowed exception" : `${getFamily(s.familyId).name} is on the list`,
    },
    {
      name: "Repetition",
      rule: "Not yesterday's activity unless nothing else fits",
      ok: !yesterday || !otherOptions,
      detail: yesterday ? (otherOptions ? "Done yesterday" : "Done yesterday, but it's the only option") : "Not done yesterday",
    },
    {
      name: "Safety",
      rule: "Nothing ≥ 6 MET with a health flag or clinician limit",
      ok: !(input.noVigorous && variant.met >= VIGOROUS_MET),
      detail: input.noVigorous ? `Limit on; ${variant.met} MET` : "No limit set",
    },
    {
      name: "Sanity",
      rule: "Session ≤ 3 hours",
      ok: s.durationMin <= 180,
      detail: `${s.durationMin} min`,
    },
  ];
}
