/**
 * Activity library with MET values from the 2024 Adult Compendium of
 * Physical Activities (https://pacompendium.com/adult-compendium/).
 *
 * Only a small, hand-picked subset is included for the demo. Each "family"
 * is what a user would say they enjoy ("cycling"), and each "variant" is a
 * specific Compendium entry with its own MET value and code.
 *
 * Values were transcribed in Oct 2026 — re-check against the Compendium
 * before using them for anything beyond the demo. Entries marked
 * `estimated: true` are flagged by the Compendium as estimated rather than
 * literature-supported.
 */

export type Intensity = "light" | "moderate" | "vigorous";

/** Where an activity happens; used to swap in indoor options on bad-weather days */
export type Setting = "indoor" | "outdoor";

/** Broad type, used to keep backup suggestions varied ("a different type") */
export type ActivityKind = "cardio" | "dance" | "sport" | "strength" | "water" | "mind-body" | "desk";

export interface ActivityVariant {
  id: string;
  /** Short label shown in the UI, e.g. "Easy pace" */
  label: string;
  /** 5-digit Compendium code */
  code: string;
  met: number;
  /** Plain-language description (paraphrased from the Compendium) */
  description: string;
  estimated?: boolean;
  /** Overrides the family's setting, e.g. spin class is indoor cycling */
  setting?: Setting;
}

export interface ActivityFamily {
  id: string;
  name: string;
  /** Lower-case noun used inside sentences: "40 min of cycling" */
  noun: string;
  color: string;
  kind: ActivityKind;
  setting: Setting;
  /** What the user needs access to, asked during onboarding ("Is there a court near you?") */
  needs?: string;
  /** Not offered in the activity picker; the coach only uses it as a fallback (desk moves) */
  fallbackOnly?: boolean;
  variants: ActivityVariant[];
}

export const ACTIVITIES: ActivityFamily[] = [
  {
    id: "cycling",
    name: "Cycling",
    noun: "cycling",
    color: "#2F8F7A",
    kind: "cardio",
    setting: "outdoor",
    needs: "a bike",
    variants: [
      { id: "cycling-easy", label: "Easy pace", code: "01015", met: 4.3, description: "Bicycling at a self-selected easy pace" },
      { id: "cycling-commute", label: "Commute", code: "01011", met: 6.8, description: "Bicycling to or from work at your own pace" },
      { id: "cycling-steady", label: "12–14 mph", code: "01030", met: 8.0, description: "Leisure bicycling at 12–13.9 mph, moderate effort" },
      { id: "cycling-spin", label: "Spin class", code: "01270", met: 9.0, description: "Stationary bicycling in an RPM or spin class", setting: "indoor" },
    ],
  },
  {
    id: "dancing",
    name: "Dancing",
    noun: "dancing",
    color: "#E0457B",
    kind: "dance",
    setting: "indoor",
    variants: [
      { id: "dancing-salsa", label: "Salsa with a partner", code: "03090", met: 4.8, description: "Salsa dancing with a partner" },
      { id: "dancing-video", label: "Salsa to a video", code: "03091", met: 6.3, description: "Salsa dancing along to a video" },
      { id: "dancing-ballroom", label: "Ballroom or swing", code: "03042", met: 6.0, description: "Recreational ballroom dancing such as waltz, cha-cha or swing" },
      { id: "dancing-nightclub", label: "Nightclub or line", code: "03031", met: 9.8, description: "Vigorous nightclub, folk or line dancing" },
    ],
  },
  {
    id: "zumba",
    name: "Zumba",
    noun: "Zumba",
    color: "#B4469E",
    kind: "dance",
    setting: "indoor",
    variants: [
      { id: "zumba-video", label: "Home video", code: "02315", met: 5.5, description: "Zumba with a home video" },
      { id: "zumba-class", label: "Group class", code: "02310", met: 6.5, description: "Zumba in a group class" },
    ],
  },
  {
    id: "walking",
    name: "Walking",
    noun: "walking",
    color: "#D98A1C",
    kind: "cardio",
    setting: "outdoor",
    variants: [
      { id: "walking-stroller", label: "With kids or stroller", code: "17100", met: 3.8, description: "Walking with children or pushing a stroller, 2.5–3.1 mph" },
      { id: "walking-moderate", label: "About 3 mph", code: "17190", met: 3.8, description: "Walking about 2.8–3.4 mph on level ground" },
      { id: "walking-brisk", label: "Brisk, 3.5 mph", code: "17200", met: 4.8, description: "Brisk exercise walking, 3.5–3.9 mph on level ground" },
    ],
  },
  {
    id: "hiit",
    name: "HIIT",
    noun: "HIIT",
    color: "#6A5AE0",
    kind: "cardio",
    setting: "indoor",
    variants: [
      { id: "hiit-moderate", label: "Moderate effort", code: "02210", met: 7.0, description: "High-intensity interval exercise, moderate effort" },
      { id: "hiit-vigorous", label: "Burpees, Tabata", code: "02214", met: 11.0, description: "High-intensity intervals such as burpees, mountain climbers or Tabata" },
    ],
  },
  {
    id: "running",
    name: "Running",
    noun: "running",
    color: "#2F6FD6",
    kind: "cardio",
    setting: "outdoor",
    variants: [
      { id: "running-jog", label: "Jogging", code: "12020", met: 7.5, description: "Jogging at a self-selected pace" },
      { id: "running-6mph", label: "6 mph", code: "12050", met: 9.3, description: "Running about 6 mph (10-minute miles)" },
    ],
  },
  {
    id: "swimming",
    name: "Swimming",
    noun: "swimming",
    color: "#2A9BB8",
    kind: "water",
    setting: "indoor",
    needs: "a pool",
    variants: [
      { id: "swimming-laps", label: "Easy laps", code: "18292", met: 5.8, description: "Freestyle laps at a slow to moderate crawl" },
      { id: "swimming-leisure", label: "Leisure swim", code: "18310", met: 6.0, description: "Casual swimming, not laps" },
      { id: "swimming-fast", label: "Fast laps", code: "18230", met: 9.8, description: "Fast freestyle laps, vigorous effort" },
    ],
  },
  {
    id: "hiking",
    name: "Hiking",
    noun: "hiking",
    color: "#6E8B2E",
    kind: "cardio",
    setting: "outdoor",
    needs: "a trail",
    variants: [
      { id: "hiking-normal", label: "Normal pace", code: "17082", met: 5.3, description: "Hiking at a normal pace over fields and hills, no load" },
      { id: "hiking-cross", label: "Cross-country", code: "17080", met: 6.0, description: "Cross-country hiking" },
    ],
  },
  {
    id: "yoga",
    name: "Yoga",
    noun: "yoga",
    color: "#9A7B4F",
    kind: "mind-body",
    setting: "indoor",
    variants: [
      { id: "yoga-power", label: "Power yoga", code: "02160", met: 4.0, description: "Power yoga", estimated: true },
      { id: "yoga-hatha", label: "Hatha", code: "02150", met: 2.3, description: "Hatha yoga" },
    ],
  },
  {
    id: "rowing",
    name: "Rowing machine",
    noun: "rowing",
    color: "#3D5A80",
    kind: "cardio",
    setting: "indoor",
    needs: "a rowing machine",
    variants: [
      { id: "rowing-moderate", label: "Moderate", code: "02071", met: 5.0, description: "Stationary rowing under 100 watts, moderate effort" },
      { id: "rowing-vigorous", label: "Vigorous", code: "02070", met: 7.3, description: "Stationary rowing, vigorous effort" },
    ],
  },
  {
    id: "strength",
    name: "Strength",
    noun: "strength training",
    color: "#7A5C3E",
    kind: "strength",
    setting: "indoor",
    variants: [
      { id: "strength-bodyweight", label: "Bodyweight", code: "02056", met: 3.0, description: "Body weight exercises such as squats, lunges, push-ups and crunches" },
      { id: "strength-weights", label: "Weights circuit", code: "02054", met: 3.5, description: "Resistance training, multiple exercises, 8–15 reps at varied resistance" },
      { id: "strength-hard", label: "High-intensity bodyweight", code: "02057", met: 6.5, description: "Body weight exercises at high intensity" },
    ],
  },
  {
    id: "basketball",
    name: "Basketball",
    noun: "basketball",
    color: "#C8642B",
    kind: "sport",
    setting: "outdoor",
    needs: "a court",
    variants: [
      { id: "basketball-shooting", label: "Shooting baskets", code: "15070", met: 5.0, description: "Shooting baskets" },
      { id: "basketball-casual", label: "Casual, no game", code: "15050", met: 6.0, description: "Basketball, non-game, general" },
      { id: "basketball-game", label: "Pickup game", code: "15040", met: 8.0, description: "Basketball game" },
    ],
  },
  {
    // Offered only when the user has 0 minutes (e.g. at the office). Mostly
    // light activity: it earns a bronze medal; whether it should count toward
    // the goal is an open clinical question (see the workflow doc).
    id: "desk",
    name: "Desk moves",
    noun: "desk moves",
    color: "#8C89A6",
    kind: "desk",
    setting: "indoor",
    fallbackOnly: true,
    variants: [
      { id: "desk-stretch", label: "Stretch breaks", code: "02101", met: 2.3, description: "Mild stretching" },
      { id: "desk-sitstand", label: "Sit-to-stands", code: "02340", met: 2.8, description: "Sit-to-stand exercise, 6–12 times a minute" },
      { id: "desk-band", label: "Band rows and squats", code: "02054", met: 3.5, description: "Resistance exercises, 8–15 reps (the Compendium has no band-specific row; this is the closest match)", estimated: true },
    ],
  },
];

const familyById = new Map(ACTIVITIES.map((f) => [f.id, f]));
const variantById = new Map(
  ACTIVITIES.flatMap((f) => f.variants.map((v) => [v.id, { family: f, variant: v }] as const)),
);

/** Families a user can pick as "enjoyed" (excludes fallback-only ones). */
export const PICKABLE = ACTIVITIES.filter((f) => !f.fallbackOnly);

export function settingOf(f: ActivityFamily, v: ActivityVariant): Setting {
  return v.setting ?? f.setting;
}

export function getFamily(id: string): ActivityFamily {
  const f = familyById.get(id);
  if (!f) throw new Error(`Unknown activity family: ${id}`);
  return f;
}

export function getVariant(id: string): { family: ActivityFamily; variant: ActivityVariant } {
  const v = variantById.get(id);
  if (!v) throw new Error(`Unknown activity variant: ${id}`);
  return v;
}

/** Find families whose name matches free text like "salsa" or "bike". */
const ALIASES: Record<string, string> = {
  bike: "cycling", biking: "cycling", spin: "cycling", cycle: "cycling",
  salsa: "dancing", dance: "dancing", ballroom: "dancing", swing: "dancing",
  walk: "walking", stroller: "walking", run: "running", jog: "running", jogging: "running",
  swim: "swimming", hike: "hiking", row: "rowing", intervals: "hiit", tabata: "hiit",
  weights: "strength", gym: "strength", lift: "strength", hoops: "basketball", ball: "basketball",
};

export function searchFamilies(query: string): ActivityFamily[] {
  const q = query.trim().toLowerCase();
  if (!q) return PICKABLE;
  const alias = Object.entries(ALIASES).find(([k]) => k.startsWith(q) || q.startsWith(k));
  return PICKABLE.filter(
    (f) => f.name.toLowerCase().includes(q) || f.id.includes(q) || (alias && alias[1] === f.id) ||
      f.variants.some((v) => v.label.toLowerCase().includes(q)),
  );
}
