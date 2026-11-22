/**
 * Activity categories: the main categories (major headings) of the activity table
 * (activity_tables/2024_compendium_exercise_recommendations.csv) that hold rows marked as
 * recommended exercise. A Compendium code's first two digits name its category, so every
 * activity in the app belongs to exactly one.
 *
 * Users mark categories they like (👍) or dislike (👎), in onboarding ("Tell us what you love
 * doing") and on the Settings tab. Disliked categories are never suggested; liked ones rank higher.
 */
import type { ActivityVariant } from "./activities";

export interface Category {
  /** The table's major_heading, word for word: the id both the app and the backend use */
  id: string;
  /** One line for people unsure what's in it */
  hint?: string;
}

/** In the table's alphabetical order. */
export const CATEGORIES: Category[] = [
  { id: "Bicycling" },
  { id: "Conditioning Exercise", hint: "gym and home workouts: strength, HIIT, yoga, rowing, elliptical" },
  { id: "Dancing" },
  { id: "Running" },
  { id: "Sports" },
  { id: "Walking" },
  { id: "Water Activities", hint: "swimming, water aerobics, paddling" },
  { id: "Winter Activities", hint: "skiing, skating, snowshoeing" },
  { id: "Video Games", hint: "active games like VR fitness" },
];

/** First two digits of a Compendium code → its category (only the exercise categories). */
const BY_PREFIX: Record<string, string> = {
  "01": "Bicycling", "02": "Conditioning Exercise", "03": "Dancing", "12": "Running", "15": "Sports",
  "17": "Walking", "18": "Water Activities", "19": "Winter Activities", "22": "Video Games",
};

/** The category of a Compendium code, or undefined for codes outside the exercise categories (and "none"). */
export function categoryOfCode(code: string): string | undefined {
  return BY_PREFIX[code.slice(0, 2)];
}

export function categoryOf(v: Pick<ActivityVariant, "code">): string | undefined {
  return categoryOfCode(v.code);
}

export type CategoryPref = "like" | "dislike";
export type CategoryPrefs = Record<string, CategoryPref>;

/** One tap: no preference → like → dislike → no preference. */
export function nextPref(p: CategoryPref | undefined): CategoryPref | undefined {
  return p === undefined ? "like" : p === "like" ? "dislike" : undefined;
}

/** Prefs with one category set to like or dislike, or cleared (undefined). */
export function withPref(prefs: CategoryPrefs | undefined, category: string, pref: CategoryPref | undefined): CategoryPrefs {
  const next = { ...(prefs ?? {}) };
  if (pref) next[category] = pref;
  else delete next[category];
  return next;
}

export function likedCategories(prefs: CategoryPrefs | undefined): string[] {
  return CATEGORIES.map((c) => c.id).filter((id) => prefs?.[id] === "like");
}

export function dislikedCategories(prefs: CategoryPrefs | undefined): string[] {
  return CATEGORIES.map((c) => c.id).filter((id) => prefs?.[id] === "dislike");
}
