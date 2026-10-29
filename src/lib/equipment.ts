/**
 * Exercise equipment the user has at home and at their gym.
 *
 * Asked once during onboarding (a photo or a typed list, one location at a
 * time) and editable in Preferences. The ranker only suggests an activity
 * that needs equipment when that equipment is where the user says they'll
 * exercise today, and strength and interval workouts are built from what's
 * there (see moves.ts), the way equipment-aware training apps do it.
 */

export type EquipmentPlace = "home" | "gym";

export interface EquipmentItem {
  id: string;
  name: string;
  /** Words that name it in typed text ("weights", "kettle bell") */
  words: string[];
  /** Which onboarding page lists it first */
  usual: EquipmentPlace[];
}

export const EQUIPMENT: EquipmentItem[] = [
  { id: "dumbbells", name: "Dumbbells", words: ["dumbbell", "dumb bell", "hand weight", "free weight", "weights"], usual: ["home", "gym"] },
  { id: "kettlebell", name: "Kettlebell", words: ["kettlebell", "kettle bell", "kb"], usual: ["home", "gym"] },
  { id: "resistance-bands", name: "Resistance bands", words: ["band", "resistance band", "tube", "theraband"], usual: ["home", "gym"] },
  { id: "yoga-mat", name: "Yoga mat", words: ["mat", "yoga mat"], usual: ["home", "gym"] },
  { id: "jump-rope", name: "Jump rope", words: ["jump rope", "skipping rope", "rope"], usual: ["home"] },
  { id: "pullup-bar", name: "Pull-up bar", words: ["pull up", "pullup", "pull-up", "chin up", "chin-up"], usual: ["home", "gym"] },
  { id: "bench", name: "Bench", words: ["bench"], usual: ["gym"] },
  { id: "barbell", name: "Barbell and rack", words: ["barbell", "squat rack", "rack", "olympic bar"], usual: ["gym"] },
  { id: "weight-machines", name: "Weight machines", words: ["machine", "leg press", "cable", "lat pulldown", "nautilus", "smith"], usual: ["gym"] },
  { id: "treadmill", name: "Treadmill", words: ["treadmill"], usual: ["gym", "home"] },
  { id: "stationary-bike", name: "Stationary bike", words: ["stationary bike", "exercise bike", "spin bike", "peloton", "bike trainer", "indoor bike"], usual: ["gym", "home"] },
  { id: "rowing-machine", name: "Rowing machine", words: ["rowing machine", "rower", "erg", "concept2"], usual: ["gym", "home"] },
  { id: "elliptical", name: "Elliptical", words: ["elliptical", "cross trainer", "cross-trainer"], usual: ["gym"] },
  { id: "pool", name: "Pool", words: ["pool", "swimming"], usual: ["gym"] },
];

const byId = new Map(EQUIPMENT.map((e) => [e.id, e]));

export function equipmentName(id: string): string {
  return byId.get(id)?.name ?? id;
}

/** Equipment named in typed text: "two dumbbells, a mat and a spin bike" → dumbbells, yoga-mat, stationary-bike. */
export function parseEquipment(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]/g, " ")} `;
  const found: string[] = [];
  // Longer phrases first, so "spin bike" isn't read as a plain bike and "yoga mat" isn't just "mat".
  const pairs = EQUIPMENT.flatMap((e) => e.words.map((w) => [w, e.id] as const)).sort((a, b) => b[0].length - a[0].length);
  let rest = t;
  for (const [w, id] of pairs) {
    const re = new RegExp(`(^|[^a-z])${w.replace(/[-]/g, "[- ]?")}s?(?=[^a-z]|$)`);
    if (re.test(rest)) {
      if (!found.includes(id)) found.push(id);
      rest = rest.replace(re, "$1 ");
    }
  }
  return found;
}

/**
 * Demo stand-in for photo recognition. The demo has no vision model, so a
 * photo returns a typical set for that place; the user fixes it with the
 * chips. Nothing is uploaded. Swap this for a real model call later.
 */
export function simulatePhotoDetection(place: EquipmentPlace): string[] {
  return place === "home"
    ? ["dumbbells", "yoga-mat", "resistance-bands"]
    : ["treadmill", "stationary-bike", "elliptical", "rowing-machine", "dumbbells", "bench", "weight-machines"];
}

/** "dumbbells, a yoga mat and resistance bands" */
export function listEquipment(ids: string[]): string {
  const names = ids.map((id) => equipmentName(id).toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
