/**
 * Finds what a user typed ("played badminton for 40 min") in the activity table, so an
 * exercise they report themselves counts at the table's MET value.
 *
 * The table is the same CSV the backend loads (activity_tables/…csv), bundled with the app, so
 * matching works with or without the backend. Only rows marked as exercise (exercise_rec = 1)
 * are searched. Matching is by words: the user's words, plus a few everyday names for the
 * table's words ("biked" → bicycling, "lifted" → resistance/weight), scored by where they appear
 * in the description. With a real LLM, this could become one Jev question over the top rows.
 */
import tableCsv from "../../activity_tables/2024_compendium_exercise_recommendations.csv?raw";
import type { TableActivity, TablePlace } from "./tableActivities";

interface Row extends TableActivity {
  /** Word stems of the description's first part ("Swimming laps"), its rest, and the heading */
  first: string[];
  rest: string[];
  head: string[];
  exercise: boolean;
}

/** One CSV line → cells, with quoted cells that hold commas. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const EFFORT = /^(very |)(light|moderate|vigorous|general|leisurely|leisure|slow|fast|brisk|easy|competitive|recreational|casual|racing|self-selected|elite)\b|\beffort\b|\bpace\b/i;

/** The description up to its effort level, as the backend's label_of: "Badminton, social singles and doubles". */
export function labelOf(description: string): string {
  const text = description.replace(/\s*\((Taylor Code[^)]*|[^)]*min\/mile)\)/g, "").trim();
  const parts = text.split(/,(?![^()]*\))/).map((p) => p.trim());
  const kept = [parts[0]];
  for (const part of parts.slice(1)) {
    if (!part || EFFORT.test(part)) break;
    kept.push(part);
  }
  return kept.join(", ");
}

/** "Biking" → "bik", "swimming" → "swim", "laps" → "lap". */
function stem(word: string): string {
  let w = word.toLowerCase();
  w = w.replace(/(ing|ed|es|s)$/, "");
  return w.replace(/(.)\1$/, "$1"); // swimm → swim, jogg → jog
}

const words = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).map(stem);

function load(): Row[] {
  const lines = tableCsv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = cells(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const [h, code, met, desc, gym, home, out, rec] = ["major_heading", "activity_code", "met_value", "activity_description", "loc_gym", "at_home", "loc_outside", "exercise_rec"].map(col);
  return lines.slice(1).map(cells).map((c) => {
    const description = c[desc];
    const places: TablePlace[] = [];
    if (c[gym] === "1") places.push("gym");
    if (c[home] === "1") places.push("home");
    if (c[out] === "1") places.push("outside");
    const [first, ...rest] = description.split(",");
    return {
      code: c[code], heading: c[h], description, label: labelOf(description), met: parseFloat(c[met]), places,
      first: words(first), rest: words(rest.join(" ")), head: words(c[h]), exercise: c[rec] === "1",
    };
  });
}

let all: Row[] | null = null;
let rows: Row[] | null = null;
const everyRow = () => (all ??= load());
/** The rows marked as exercise: the ones a typed exercise is matched to. */
const table = () => (rows ??= everyRow().filter((r) => r.exercise));

/** One row of the table by its Compendium code ("02064"), or undefined. */
export function tableRow(code: string): TableActivity | undefined {
  const r = everyRow().find((x) => x.code === code);
  return r && { code: r.code, heading: r.heading, description: r.description, label: r.label, met: r.met, places: r.places };
}

/** Everyday words → the table's words. Keys and values are stems. */
const SYNONYMS: Record<string, string[]> = {
  bik: ["bicycl"], bike: ["bicycl"], cycl: ["bicycl"], cycle: ["bicycl"], biked: ["bicycl"], spin: ["spin", "stationary", "bicycl"],
  ran: ["run"], jog: ["jog"], swam: ["swim"], walk: ["walk"], hik: ["hik"], hike: ["hik"],
  lift: ["resistance", "weight"], weight: ["resistance", "weight"], strength: ["resistance", "strength"],
  hiit: ["interval"], stretch: ["stretch"], danc: ["danc"], dance: ["danc"], row: ["row"],
  hoop: ["basketball"], footy: ["soccer"], football: ["soccer", "football"], skat: ["skat"], ski: ["ski"],
  stair: ["stair"], climb: ["climb"], treadmil: ["treadmill"], elliptical: ["elliptical"],
};

/** Words that say nothing about which activity it was. */
const IGNORE = new Set<string>(["i", "did", "do", "go", "went", "a", "an", "the", "for", "min", "minute", "hour", "hr", "h", "m", "of", "my", "with",
  "some", "play", "playe", "today", "at", "in", "on", "and", "about", "around", "to", "just", "then", "after", "before", "this", "morning",
  "afternoon", "evening", "night", "half", "quarter", "it", "was", "had", "have", "will", "gonna", "want", "like", "would", "instead",
  "half", "bit", "little", "lot", "session", "class", "workout", "exercise", "work", "out", "doing", "got", "get", "few", "long", "time"].map(stem));

/** Effort words: they choose between rows of the same activity, never the activity itself. */
const EFFORT_WORDS = new Set(["light", "moderate", "vigorou", "slow", "fast", "easy", "hard", "brisk", "leisurely", "competitive",
  "casual", "intense", "general", "steady", "quick"]);
const EFFORT_ALIAS: Record<string, string[]> = {
  hard: ["vigorou"], intense: ["vigorou"], fast: ["fast", "brisk", "vigorou"], quick: ["fast", "brisk"], easy: ["light", "slow", "leisurely"],
  slow: ["slow", "light", "leisurely"], steady: ["moderate"],
};

const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
const has = (list: string[], w: string) => list.some((x) => same(x, w));

export interface TableMatch {
  row: TableActivity;
  score: number;
}

/**
 * The table rows that best fit what the user typed, best first (at most `n`). Empty when no word
 * names an activity in the table. Effort words pick between rows of one activity
 * ("fast" → "…, brisk"); without them, a "general" or "self-selected" row is preferred.
 */
export function matchTable(text: string, n = 3): TableMatch[] {
  const typed = text.toLowerCase().replace(/\d+(\.\d+)?/g, " ");
  const all = words(typed).filter((w) => w.length > 1 && !IGNORE.has(w));
  const effort = all.filter((w) => EFFORT_WORDS.has(w)).map((w) => EFFORT_ALIAS[w] ?? [w]);
  const named = all.filter((w) => !EFFORT_WORDS.has(w));
  if (named.length === 0) return [];
  // Each typed word, with the table words it may stand for.
  const terms = named.map((w) => [w, ...(SYNONYMS[w] ?? [])]);

  const scored: TableMatch[] = [];
  for (const r of table()) {
    let score = 0;
    let hits = 0;
    for (const alts of terms) {
      const best = Math.max(...alts.map((w) => (has(r.first, w) ? 3 : has(r.rest, w) ? 2 : has(r.head, w) ? 1 : 0)));
      if (best > 0) { score += best; hits++; }
      // The word itself over a word it may stand for: "spin" → the spin bike class, not any bicycling.
      if (alts.length > 1 && (has(r.first, alts[0]) || has(r.rest, alts[0]))) score += 1;
    }
    if (hits === 0) continue;
    for (const e of effort) if (e.some((w) => has(r.rest, w) || has(r.first, w))) score += 1;
    // Without a matching effort word, the everyday row: "general" or "self-selected" pace.
    if (/\b(general|self-selected)\b/i.test(r.description)) score += 0.5;
    // The activity itself before its kinds: "Walking, …" before "Race walking" or "Walking the dog".
    if (terms.some((alts) => alts.some((w) => same(r.first[0] ?? "", w)))) score += 1;
    score -= 0.3 * (r.first.length - 1);
    // Shorter descriptions first among equals: "Swimming laps, freestyle…" over a long variant.
    score -= r.description.length / 1000;
    scored.push({ row: { code: r.code, heading: r.heading, description: r.description, label: r.label, met: r.met, places: r.places }, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // One row per label, so the choices read differently ("Basketball, game" and "Basketball, general").
  const seen = new Set<string>();
  const out: TableMatch[] = [];
  for (const m of scored) {
    if (seen.has(m.row.label)) continue;
    seen.add(m.row.label);
    out.push(m);
    if (out.length === n) break;
  }
  // Only rows nearly as good as the best: a weak second match is noise.
  return out.filter((m) => m.score >= out[0].score - 2.5);
}
