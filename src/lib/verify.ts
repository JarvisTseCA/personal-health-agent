/**
 * The verifier's guardrail checks, run on every suggestion before the user
 * sees it. In the real backend a second agent runs these plus a language
 * check on the coach's text; here they run in code and the demo panel shows
 * the results ("What the verifier checked").
 */
import { getFamily, getVariant, PICKABLE } from "./activities";
import { creditFor, fmt, VIGOROUS_MET } from "./met";
import { fitsPlace, type Suggestion, type SuggestInput } from "./suggest";
import { equipmentOf } from "./activities";
import { listEquipment } from "./equipment";
import { categoryOf } from "./categories";

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
  const pickCategory = categoryOf(variant);
  const yesterday = input.recent.some((r) => r.familyId === s.familyId && r.daysAgo === 1);
  const otherOptions = PICKABLE.some((f) => f.id !== s.familyId && input.access[f.id] !== "no" && !input.exclude.includes(f.id));

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
      rule: "Accessible and not ruled out today",
      ok: desk || (input.access[s.familyId] !== "no" && !input.exclude.includes(s.familyId)),
      detail: desk
        ? "Desk moves are the one allowed exception"
        : `${getFamily(s.familyId).name}${input.enjoyed.includes(s.familyId) ? ", liked before" : ", not tried yet"}`,
    },
    {
      name: "Category",
      rule: "Not in a category the user dislikes (👎)",
      ok: desk || input.categoryPrefs?.[pickCategory ?? ""] !== "dislike",
      detail: desk ? "Desk moves are the one allowed exception"
        : !pickCategory ? "Not in the table's exercise categories"
        : input.categoryPrefs?.[pickCategory] === "like" ? `${pickCategory}, a category they like` : pickCategory,
    },
    {
      name: "Repetition",
      rule: "Not yesterday's activity unless nothing else fits",
      ok: !yesterday || !otherOptions,
      detail: yesterday ? (otherOptions ? "Done yesterday" : "Done yesterday, but it's the only option") : "Not done yesterday",
    },
    {
      name: "Safety",
      rule: "Nothing ≥ 6 MET with a health flag or clinician advice to keep it moderate",
      ok: !(input.noVigorous && variant.met >= VIGOROUS_MET),
      detail: input.noVigorous ? `Limit on; ${variant.met} MET` : "No limit set",
    },
    {
      name: "Equipment",
      rule: "Needed equipment is where the user is today",
      ok: desk || fitsPlace(family, variant, input.place, input.equipmentHere),
      detail: equipmentOf(family, variant).length === 0
        ? `Needs nothing; ${input.place}`
        : `Needs ${listEquipment(equipmentOf(family, variant))} (any one); ${input.place} has ${input.equipmentHere ? listEquipment(input.equipmentHere) || "none" : "not recorded"}`,
    },
    {
      name: "Sanity",
      rule: "Session ≤ 3 hours",
      ok: s.durationMin <= 180,
      detail: `${s.durationMin} min`,
    },
  ];
}
