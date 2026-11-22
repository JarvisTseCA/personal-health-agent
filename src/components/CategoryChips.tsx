/**
 * "Tell us what you love doing": one chip per activity-table category. Each tap moves a chip
 * through three states: no preference → 👍 like → 👎 dislike → no preference. The 👍 / 👎 sits in a
 * badge on the chip's corner, outside the label, so a chip never changes size or moves when tapped.
 * Liked chips are green and disliked ones rose, so the two read apart at a glance. Used, the same
 * way, by onboarding and the Settings tab.
 */
import { CATEGORIES, nextPref, type CategoryPref, type CategoryPrefs } from "../lib/categories";

/** The sentence both pages show above the chips. */
export const CATEGORY_HELP = "Tap a category once if you like it 👍, twice if you don't 👎, and once more to clear it. Leave the rest blank.";

const STATE_WORD: Record<CategoryPref | "none", string> = { like: "liked", dislike: "disliked", none: "no preference" };
const NEXT_WORD: Record<CategoryPref | "none", string> = { none: "like", like: "dislike", dislike: "clear" };
const EMOJI: Record<CategoryPref, string> = { like: "👍", dislike: "👎" };

export function CategoryChips({ prefs, onChange }: {
  prefs: CategoryPrefs | undefined;
  onChange: (category: string, pref: CategoryPref | undefined) => void;
}) {
  const hinted = CATEGORIES.filter((c) => c.hint);
  return (
    <>
      <div className="chips cat-chips" role="group" aria-label="Activity categories">
        {CATEGORIES.map((c) => {
          const pref = prefs?.[c.id];
          const key = pref ?? "none";
          return (
            <button
              key={c.id}
              className={`chip cat-chip${pref ? ` chip-${pref}` : ""}`}
              aria-label={`${c.id}: ${STATE_WORD[key]}. Tap to ${NEXT_WORD[key]}.`}
              onClick={() => onChange(c.id, nextPref(pref))}
            >
              {c.id}
              {pref && <span aria-hidden className="pref-badge">{EMOJI[pref]}</span>}
            </button>
          );
        })}
      </div>
      <ul className="category-hints">
        {hinted.map((c) => <li key={c.id}><b>{c.id}:</b> {c.hint}</li>)}
      </ul>
    </>
  );
}
