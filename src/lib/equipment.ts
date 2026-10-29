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
  { id: "dumbbells", name: "Dumbbells", words: ["dumbbell", "dumb bell", "dumbell", "dumbel", "dumbbel", "hand weight", "free weight", "weights"], usual: ["home", "gym"] },
  { id: "kettlebell", name: "Kettlebell", words: ["kettlebell", "kettle bell", "kettlebel", "kettelbell", "kb"], usual: ["home", "gym"] },
  { id: "resistance-bands", name: "Resistance bands", words: ["band", "resistance band", "resistence band", "tube", "theraband"], usual: ["home", "gym"] },
  { id: "yoga-mat", name: "Yoga mat", words: ["mat", "yoga mat", "exercise mat", "workout mat"], usual: ["home", "gym"] },
  { id: "jump-rope", name: "Jump rope", words: ["jump rope", "jumprope", "skipping rope", "rope"], usual: ["home"] },
  { id: "pullup-bar", name: "Pull-up bar", words: ["pull up bar", "pull-up bar", "pullup bar", "chin up bar", "chin-up bar", "pull up", "pullup", "pull-up", "chin up", "chin-up"], usual: ["home", "gym"] },
  { id: "bench", name: "Bench", words: ["bench", "weight bench", "flat bench", "adjustable bench", "workout bench"], usual: ["gym"] },
  { id: "barbell", name: "Barbell and rack", words: ["barbell", "squat rack", "rack", "olympic bar"], usual: ["gym"] },
  { id: "weight-machines", name: "Weight machines", words: ["machine", "leg press", "cable", "lat pulldown", "nautilus", "smith"], usual: ["gym"] },
  { id: "treadmill", name: "Treadmill", words: ["treadmill", "tread mill", "threadmill"], usual: ["gym", "home"] },
  { id: "stationary-bike", name: "Stationary bike", words: ["stationary bike", "exercise bike", "excercise bike", "spin bike", "peloton", "bike trainer", "indoor bike"], usual: ["gym", "home"] },
  { id: "rowing-machine", name: "Rowing machine", words: ["rowing machine", "rower", "erg", "concept2"], usual: ["gym", "home"] },
  { id: "elliptical", name: "Elliptical", words: ["elliptical", "cross trainer", "cross-trainer"], usual: ["gym"] },
  { id: "pool", name: "Pool", words: ["pool", "swimming"], usual: ["gym"] },
];

const byId = new Map(EQUIPMENT.map((e) => [e.id, e]));

/**
 * Equipment the user typed that isn't in the list ("foam roller") is kept
 * as its own tag, with an id of "custom:" plus the name as typed. It shows
 * as a chip like the others; the ranker can't plan around it, but the agent
 * sees it in the user's context.
 */
export const CUSTOM_PREFIX = "custom:";
export const isCustom = (id: string) => id.startsWith(CUSTOM_PREFIX);
export const customId = (label: string) => `${CUSTOM_PREFIX}${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()}`;

export function equipmentName(id: string): string {
  if (isCustom(id)) return id.slice(CUSTOM_PREFIX.length);
  return byId.get(id)?.name ?? id;
}

/** Words that aren't the item itself: "I also have a pair of", "too", "5 kg". */
const FILLER = new Set([
  "i", "we", "also", "have", "has", "had", "got", "own", "there", "there's", "theres", "is", "are", "a", "an", "the", "some",
  "my", "our", "you", "missed", "forgot", "add", "plus", "it's", "its", "it", "too", "as", "well", "pair", "of", "set",
  "one", "two", "three", "four", "few", "couple", "just", "only", "and", "with", "that's", "thats", "actually", "oh",
  "please", "in", "at", "what", "about", "bar", "bars", "machine", "machines", "equipment", "stuff", "thing", "things", "kg", "kgs", "lb", "lbs", "pound", "pounds", "kilo", "kilos", "can", "be", "used",
]);
const NUMBER = /^\d+(\.\d+)?(kg|kgs|lb|lbs|k)?$/;

/**
 * Turn leftover typed text into a tag name, or null if nothing's left that
 * names a thing: "a foam roller too" → "Foam roller", "5kg" → null.
 */
export function customLabel(fragment: string): string | null {
  const words = fragment.toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean);
  const skip = (w: string) => FILLER.has(w) || NUMBER.test(w);
  let a = 0;
  let b = words.length;
  while (a < b && skip(words[a])) a++;
  while (b > a && skip(words[b - 1])) b--;
  const core = words.slice(a, b);
  if (!core.some((w) => /[a-z]{3,}/.test(w) && !skip(w))) return null;
  const label = core.join(" ");
  return label.length > 40 ? null : label;
}

/** Equipment named in typed text: "two dumbbells, a mat and a spin bike" → dumbbells, yoga-mat, stationary-bike. */
export function parseEquipment(text: string): string[] {
  return matchEquipment(text).ids;
}

/**
 * Like parseEquipment, plus anything left over that names something not in
 * the list, as tags: "dumbbells and a foam roller" → dumbbells + custom:Foam roller.
 */
export function parseEquipmentWithCustom(text: string): string[] {
  const { ids, rest } = matchEquipment(text);
  const custom = rest.split(/\band\b|&|\bwith\b|\/|\+/).map(customLabel).filter((x): x is string => !!x).map(customId);
  return [...ids, ...custom.filter((c, i) => custom.indexOf(c) === i)];
}

/**
 * One-word names that are too generic on their own: "battle rope" is not a
 * jump rope and "foam mat" isn't a yoga mat. These only count when nothing
 * but filler comes right before them; otherwise the whole phrase becomes the
 * user's own tag.
 */
const GENERIC = new Set(["rope", "band", "tube", "mat", "rack", "cable", "machine", "weights", "pool", "bench", "erg"]);

function matchEquipment(text: string): { ids: string[]; rest: string } {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]/g, " ")} `;
  const found: string[] = [];
  // Longer phrases first, so "spin bike" isn't read as a plain bike and "yoga mat" isn't just "mat".
  const pairs = EQUIPMENT.flatMap((e) => e.words.map((w) => [w, e.id] as const)).sort((a, b) => b[0].length - a[0].length);
  let rest = t;
  for (const [w, id] of pairs) {
    const re = new RegExp(`(^|[^a-z])${w.replace(/[-]/g, "[- ]?")}s?(?=[^a-z]|$)`);
    const m = re.exec(rest);
    if (m && GENERIC.has(w)) {
      const raw = rest.slice(0, m.index + m[1].length).trim().split(/\s+/).at(-1) ?? "";
      const before = raw.replace(/[^a-z0-9]/g, "");
      if (before.length > 1 && !FILLER.has(raw) && !FILLER.has(before) && !NEGATION.test(raw) && !NUMBER.test(before)) continue;
    }
    if (m) {
      if (!found.includes(id)) found.push(id);
      rest = rest.replace(re, "$1 ");
    }
  }
  return { ids: found, rest };
}

/** The negation words themselves, removed before reading a custom tag ("no foam roller" → "Foam roller"). */
const NEGATION_WORDS = /\b(there's|theres|there is|no|not|don't|dont|do not|doesn't|doesnt|isn't|isnt|aren't|arent|never|without|remove|delete|drop|wrong|there|gone|sold|broken|have|has)\b/g;
const NEGATION = /\b(no|not|don't|dont|do not|doesn't|doesnt|isn't|isnt|aren't|arent|never|without|remove|delete|drop|wrong|isn't there|not there|gone|sold|broken)\b/;
const CONFIRM = /\b(yes|yep|yeah|correct|right|looks good|looks right|that's it|thats it|perfect|exactly|all good|spot on)\b/;
/** A clause that's conversation, not equipment: "thanks", "that's all". */
const CHATTER = /\b(thanks|thank you|nothing else|that's all|thats all|no more|nope|done|ok|okay|great|cool|nice)\b/;

export interface EquipmentFeedback {
  add: string[];
  remove: string[];
  /** The user said the analysis was right and named nothing to change */
  confirmed: boolean;
}

/**
 * The user's reply to the agent's photo analysis, e.g. "no kettlebell, but
 * I also have a jump rope" → remove kettlebell, add jump rope.
 *
 * The text is split into clauses ("but", "also", "plus", commas, "and I…").
 * In a clause with a negation ("no", "don't have", "isn't there", "wrong"),
 * every item named is removed; in any other clause it's added ("you missed
 * the jump rope", "there's also a bench"). Anything named that isn't in the
 * equipment list becomes its own tag ("I also have a foam roller" → a
 * "Foam roller" tag), so typing an item never ends in "I don't know that".
 */
export function parseEquipmentFeedback(text: string): EquipmentFeedback {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  const clauses = t.split(/\bbut\b|\bhowever\b|\balso\b|\bplus\b|\bthough\b|[,;.!?]|\band (?=i\b|i'|we\b|there\b|it's\b|that's\b|you\b)/);
  const add: string[] = [];
  const remove: string[] = [];
  for (const c of clauses) {
    const known = parseEquipment(c);
    if (!known.length && (CONFIRM.test(c) || CHATTER.test(c))) continue;
    const ids = parseEquipmentWithCustom(c.replace(NEGATION_WORDS, " "));
    if (!ids.length) continue;
    const target = NEGATION.test(c) ? remove : add;
    for (const id of ids) if (!target.includes(id)) target.push(id);
  }
  const clean = add.filter((id) => !remove.includes(id));
  return { add: clean, remove, confirmed: clean.length === 0 && remove.length === 0 && CONFIRM.test(t) };
}

/** "dumbbells, a yoga mat and resistance bands" */
export function listEquipment(ids: string[]): string {
  const names = ids.map((id) => equipmentName(id).toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
