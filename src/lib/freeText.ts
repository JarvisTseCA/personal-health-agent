/**
 * Reads typed answers. Every choice in the app also has a free-text box below
 * its options; these functions turn what people type into the same values the
 * option bubbles produce. Anything they can't place is kept as a note the
 * coach remembers, so typing is never a dead end.
 *
 * With a real LLM these become one structured-output call per step; the
 * contract (text in, choice or null out) stays the same.
 */
import { searchFamilies } from "./activities";
import type { DaySlot } from "./plan";
import type { DeclineReason, Energy, Place } from "./suggest";

const norm = (t: string) => t.toLowerCase().replace(/[’']/g, "'").trim();
const hasAny = (t: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(t));

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, ninety: 90,
};

/** "25", "an hour", "1.5 hrs", "half an hour", "no time" → minutes, or null. */
export function parseMinutes(text: string): number | null {
  let t = norm(text);
  for (const [w, n] of Object.entries(NUMBER_WORDS)) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), String(n));
  if (/\b(no time|none|nothing|zero|not at all|can't|cannot)\b/.test(t) && !/\d/.test(t)) return 0;
  let total = 0;
  let found = false;
  if (/\bhour and a half\b/.test(t)) { total += 90; found = true; t = t.replace(/\bhour and a half\b/, ""); }
  if (/\bhalf (an )?hour\b/.test(t)) { total += 30; found = true; t = t.replace(/\bhalf (an )?hour\b/, ""); }
  if (/\b(a )?quarter (of an )?hour\b/.test(t)) { total += 15; found = true; t = t.replace(/\b(a )?quarter (of an )?hour\b/, ""); }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/g)) { total += parseFloat(m[1]) * 60; found = true; }
  t = t.replace(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/g, "");
  if (/\ban hour\b/.test(t)) { total += 60; found = true; }
  for (const m of t.matchAll(/(\d+)\s*(m|min|mins|minute|minutes)\b/g)) { total += parseInt(m[1], 10); found = true; }
  if (!found) {
    const bare = t.match(/\b(\d+)\b/);
    if (bare) { total = parseInt(bare[1], 10); found = true; }
  }
  return found ? Math.round(total) : null;
}

export function parsePlace(text: string): Place | null {
  const t = norm(text);
  // Before "work": "at the gym after work" is the gym.
  if (hasAny(t, ["gym", "fitness center", "fitness centre", "health club", "ymca", "y.m.c.a", "rec center", "studio"])) return "gym";
  if (hasAny(t, ["office", "work", "desk", "meeting", "school", "campus"])) return "office";
  if (hasAny(t, ["travel", "hotel", "airport", "trip", "road", "away"])) return "traveling";
  if (hasAny(t, ["outside", "outdoor", "park", "trail", "street", "beach", "yard"])) return "outside";
  if (hasAny(t, ["home", "house", "apartment", "flat", "living room"])) return "home";
  return null;
}

export function parseEnergy(text: string): Energy {
  const t = norm(text);
  if (hasAny(t, ["tired", "exhaust", "sleepy", "low", "drained", "sick", "meh", "sore", "wiped", "lazy", "not great"])) return "low";
  if (hasAny(t, ["great", "energ", "pumped", "push", "hard", "challenge", "strong", "amazing", "ready"])) return "challenge";
  return "normal";
}

/** The activity a phrase names, e.g. "I biked to work" → cycling. */
export function matchActivity(text: string): string | null {
  const t = norm(text);
  const whole = searchFamilies(t);
  if (whole.length > 0 && whole.length < 4) return whole[0].id;
  const words = t.replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  for (const w of words) {
    const stem = w.replace(/(ing|ed|s)$/, "");
    for (const q of [w, stem]) {
      if (q.length < 3) continue;
      const r = searchFamilies(q);
      if (r.length > 0 && r.length < 4) return r[0].id;
    }
  }
  return null;
}

/** Safety first: anything that sounds like pain maps to "hurts". */
export function parseReason(text: string): DeclineReason {
  const t = norm(text);
  if (hasAny(t, ["hurt", "pain", "sore", "injur", "dizz", "chest", "ache", "sick", "ill", "sprain", "knee", "back", "ankle"])) return "hurts";
  if (hasAny(t, ["tired", "exhaust", "sleepy", "drained", "no energy", "wiped"])) return "tired";
  if (hasAny(t, ["rain", "snow", "cold", "hot", "weather", "storm", "wind", "heat", "dark"])) return "weather";
  if (hasAny(t, ["busy", "no time", "meeting", "late", "deadline", "kids", "work"])) return "no-time";
  if (hasAny(t, ["again", "yesterday", "already", "same", "repeat"])) return "recent";
  if (hasAny(t, ["court", "bike", "closed", "broken", "pool", "gym", "flat tire", "no access", "can't get"])) return "no-access";
  if (hasAny(t, ["mood", "feel like", "bored", "don't want", "boring", "not into"])) return "not-mood";
  return "other";
}

export function parseYesNo(text: string): boolean | null {
  const t = norm(text);
  if (/^(no|nope|nah|not really|done|stop|enough|i'm done|im done)\b/.test(t)) return false;
  if (/^(yes|yeah|yep|yup|sure|ok|okay|keep going|let's|lets|go|sounds good|right|correct|i will|definitely)\b/.test(t)) return true;
  return null;
}

const DAYS: Array<[RegExp, number[]]> = [
  [/\bweekdays?\b/, [0, 1, 2, 3, 4]],
  [/\bweekends?\b/, [5, 6]],
  [/\bmon(day)?s?\b/, [0]],
  [/\btue(s|sday)?s?\b/, [1]],
  [/\bwed(nesday)?s?\b/, [2]],
  [/\bthu(r|rs|rsday)?s?\b/, [3]],
  [/\bfri(day)?s?\b/, [4]],
  [/\bsat(urday)?s?\b/, [5]],
  [/\bsun(day)?s?\b/, [6]],
];

/** A number of minutes → the nearest option at or below it (45+ for anything 45 and up). */
export function slotForMinutes(m: number): DaySlot {
  if (m >= 45) return "45";
  if (m >= 30) return "30";
  if (m >= 10) return "10";
  if (m >= 5) return "5";
  return "0";
}

function slotIn(t: string): DaySlot | null {
  if (hasAny(t, ["off", "sick", "rest", "busy", "can't", "cannot", "unavailable", "away", "not free", "nothing"])) return "off";
  if (hasAny(t, ["desk", "no time"])) return "0";
  const m = t.match(/\b(\d+)\s*\+?\s*(m|min|mins|minutes?)?\b/);
  if (m) return slotForMinutes(parseInt(m[1], 10));
  if (hasAny(t, ["long", "an hour", "hour", "lots", "free all", "plenty"])) return "45";
  if (hasAny(t, ["medium", "half", "some time", "free"])) return "30";
  if (hasAny(t, ["short", "quick", "little", "few min"])) return "10";
  return null;
}

/** "Thursday off, Saturday 45 min" → { 3: "off", 5: "45" }. Empty when nothing is understood. */
export function parsePlanChanges(text: string): Record<number, DaySlot> {
  const out: Record<number, DaySlot> = {};
  for (const clause of norm(text).split(/[,;.]|\band\b|\bbut\b/)) {
    const days = DAYS.filter(([re]) => re.test(clause)).flatMap(([, d]) => d);
    const slot = slotIn(clause);
    if (days.length && slot) for (const d of days) out[d] = slot;
  }
  return out;
}
