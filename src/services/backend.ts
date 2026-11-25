/**
 * Talks to the Python backend (backend/). In dev, Vite proxies /api to it.
 *
 * The backend is optional: if it isn't running (or on GitHub Pages), every
 * call here fails quietly and the app keeps using the in-app ranker and
 * localStorage, exactly like the demo build.
 */
import { categoryOf, dislikedCategories, likedCategories } from "../lib/categories";
import { getFamily, getVariant } from "../lib/activities";
import { codeOfTableId, isTableId, tableHeading, tableId, type TableActivity, type TablePlace } from "../lib/tableActivities";
import { equipmentName } from "../lib/equipment";
import { creditFor, DAY_NAMES_LONG, metHours } from "../lib/met";
import { candidates, type Suggestion } from "../lib/suggest";
import type { AppState } from "../state/types";
import { buildAgentContext, buildSuggestInput } from "./context";
import { USER_ID, userQuery } from "./userId";

// An empty VITE_API_BASE (the GitHub variable not set) means the same as none.
export const BASE = import.meta.env.VITE_API_BASE || "/api";

export interface BackendHealth {
  ok: boolean;
  jev: "live" | "mock";
  model: string;
}

let health: Promise<BackendHealth | null> | null = null;

/** Checked once per page load. */
export function backendHealth(): Promise<BackendHealth | null> {
  health ??= fetch(`${BASE}/health`)
    .then((r) => (r.ok ? (r.json() as Promise<BackendHealth>) : null))
    .catch(() => null);
  return health;
}

export interface BackendSuggestion {
  source: "jev" | "mock";
  model: string;
  logId: number;
  lead: Suggestion;
  backups: Suggestion[];
  jevRequest: unknown;
  jevAnswers: unknown;
  /** From the activity table only: the rows behind the lead and backups, to register and save */
  rows?: TableActivity[];
}

/** The variables from today's check-in and the options that passed the hard filters. */
export function buildSuggestRequest(state: AppState) {
  const ctx = buildAgentContext(state);
  const input = buildSuggestInput(state, ctx);
  const { options, durations } = candidates(input);
  const c = input.constraint;
  return {
    user_id: USER_ID,
    weekly_goal_met_hours: ctx.goal,
    done_this_week_met_hours: +ctx.week.done.toFixed(2),
    left_this_week_met_hours: +ctx.left.toFixed(2),
    day_name: DAY_NAMES_LONG[state.todayIndex],
    check_in: {
      minutes: input.minutes, place: input.place, energy: input.energy, mood: input.mood,
      mood_name: input.mood === "surprise" ? null : getFamily(input.mood).name,
    },
    needed_met_hours: input.needed,
    // What the user said they have where they are today, including their own tags; null on older saves.
    equipment_here: input.equipmentHere?.map(equipmentName) ?? null,
    target_met_hours: input.target,
    // "Up for a challenge" aims for 1.5× today's target, same as "I want more".
    boost: input.boost || input.energy === "challenge",
    enjoyed: input.enjoyed
      .filter((id) => input.access[id] !== "no")
      .map((id, i) => ({ family_id: id, name: getFamily(id).name, rank: i + 1, access: input.access[id] ?? "have" })),
    options: options.map(({ family, variant }) => ({
      variant_id: variant.id, family_id: family.id, family_name: family.name, kind: family.kind,
      label: variant.label, met: variant.met, description: variant.description, setting: variant.setting ?? family.setting,
      category: categoryOf(variant) ?? "",
    })),
    // Categories the user marked 👍; disliked ones are already filtered out of the options.
    liked_categories: likedCategories(input.categoryPrefs),
    durations,
    // Names come from the activity library here; the backend has no copy of it.
    recent: input.recent.map((r) => ({ family_id: r.familyId, name: getFamily(r.familyId).name, days_ago: r.daysAgo })),
    declines: state.declines.map((d) => ({
      family_id: d.familyId, name: getFamily(d.familyId).name, reason: d.reason,
      days_ago: state.todayIndex - d.day, note: d.note ?? null,
    })),
    limits: { no_vigorous: input.noVigorous, max_session_min: input.maxSessionMin },
    constraint_notes: [
      ...(c?.indoorOnly ? ["Indoors only"] : []),
      ...(c?.maxMet !== undefined ? [`Lighter than ${c.maxMet} MET`] : []),
      ...(c?.notKind ? [`Not ${c.notKind} (did it recently)`] : []),
    ],
  };
}

interface Pick {
  variant_id: string;
  family_id: string;
  duration_min: number;
  probability: number;
  reasons: string[];
}

/** MET-hours come from the calculator here, never from the backend or the model. */
function toSuggestion(p: Pick): Suggestion {
  const { family, variant } = getVariant(p.variant_id);
  return {
    familyId: family.id, variantId: variant.id, durationMin: p.duration_min, met: variant.met,
    credit: creditFor(variant.met, p.duration_min), rawMetHours: metHours(variant.met, p.duration_min),
    reasons: p.reasons, score: p.probability,
  };
}

export async function fetchSuggestion(state: AppState): Promise<BackendSuggestion | null> {
  const body = buildSuggestRequest(state);
  if (body.options.length === 0) return null;
  try {
    const res = await fetch(`${BASE}/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      console.warn("Backend suggestion failed; keeping the in-app pick.", res.status, await res.text());
      return null;
    }
    const d = await res.json();
    return {
      source: d.source, model: d.model, logId: d.log_id,
      lead: toSuggestion(d.lead), backups: d.backups.map(toSuggestion),
      jevRequest: d.jev_request, jevAnswers: d.jev_answers,
    };
  } catch (e) {
    console.warn("Backend unreachable; keeping the in-app pick.", e);
    return null;
  }
}

// --- From the activity table (POST /api/suggest/table) ---------------------------------------

/** A library or table activity id as the table route names it: its Compendium code, for table rows. */
const codeOf = (familyId: string) => (isTableId(familyId) ? codeOfTableId(familyId) : undefined);

/**
 * The request for POST /api/suggest/table. No options: the backend finds the candidates in the
 * table. What applies everywhere: 👍 / 👎 categories, health limits, today's time and energy,
 * recent workouts and what was ruled out today. What is learned by place: the codes accepted
 * there (picked_codes), the declines made there, and "Can't access it" there. Before any
 * feedback at two places, their requests are the same.
 */
export function buildTableRequest(state: AppState) {
  const base = buildSuggestRequest(state);
  const input = buildSuggestInput(state);
  const place = input.place;
  const c = input.constraint;
  const here = state.declines.filter((d) => !d.place || d.place === place);
  const today = state.declines.filter((d) => d.day === state.todayIndex);
  const codes = (ids: string[]) => [...new Set(ids.map(codeOf).filter((x): x is string => !!x))];
  const { options: _options, enjoyed: _enjoyed, ...shared } = base;
  return {
    ...shared,
    recent: input.recent.map((r) => ({
      family_id: r.familyId, name: getFamily(r.familyId).name, days_ago: r.daysAgo, code: codeOf(r.familyId) ?? null,
    })),
    declines: here.map((d) => ({
      family_id: d.familyId, name: getFamily(d.familyId).name, reason: d.reason,
      days_ago: state.todayIndex - d.day, note: d.note ?? null, code: codeOf(d.familyId) ?? null,
    })),
    picked_codes: state.profile.pickedCodes?.[place] ?? [],
    // 👎 categories, and the category of a table pick turned down today as "Did this recently".
    exclude_headings: [...new Set([
      ...dislikedCategories(input.categoryPrefs),
      ...today.filter((d) => d.reason === "recent").map((d) => tableHeading(d.familyId)).filter((h): h is string => !!h),
    ])],
    // Ruled out today, and "Can't access it" at this place.
    exclude_codes: codes([...input.exclude, ...here.filter((d) => d.reason === "no-access").map((d) => d.familyId)]),
    indoor_only: !!c?.indoorOnly,
    below_met: c?.maxMet ?? null,
  };
}

interface TablePickReply {
  activity_code: string;
  major_heading: string;
  activity_description: string;
  label: string;
  places: TablePlace[];
  met_value: number;
  duration_min: number;
  probability: number;
  reasons: string[];
}

function tableRow(p: TablePickReply): TableActivity {
  return { code: p.activity_code, heading: p.major_heading, description: p.activity_description, label: p.label, met: p.met_value, places: p.places };
}

/** MET-hours come from the calculator here, with the table's MET value. */
function tableSuggestion(p: TablePickReply): Suggestion {
  const id = tableId(p.activity_code);
  return {
    familyId: id, variantId: id, durationMin: p.duration_min, met: p.met_value,
    credit: creditFor(p.met_value, p.duration_min), rawMetHours: metHours(p.met_value, p.duration_min),
    reasons: p.reasons, score: p.probability,
  };
}

/**
 * Today's pick from the activity table, or null when the backend can't be reached, finds
 * nothing that fits (422), errors, or takes longer than `waitMs`: Today then shows the in-app
 * ranker's pick.
 */
export async function fetchTableSuggestion(state: AppState, waitMs: number): Promise<BackendSuggestion | null> {
  const body = buildTableRequest(state);
  if (body.durations.length === 0) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), waitMs);
  try {
    const res = await fetch(`${BASE}/suggest/table`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal,
    });
    if (!res.ok) {
      console.warn("Table suggestion failed; showing the in-app pick.", res.status, await res.text());
      return null;
    }
    const d = await res.json();
    const picks: TablePickReply[] = [d.lead, ...d.backups];
    return {
      source: d.source, model: d.model, logId: d.log_id,
      lead: tableSuggestion(d.lead), backups: d.backups.map(tableSuggestion),
      jevRequest: d.jev_request, jevAnswers: d.jev_answers, rows: picks.map(tableRow),
    };
  } catch (e) {
    console.warn(abort.signal.aborted ? `No table suggestion within ${waitMs / 1000} s; showing the in-app pick.` : "Backend unreachable; showing the in-app pick.", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- From Memory (POST /api/suggest/memory) --------------------------------------------------

/**
 * The request for POST /api/suggest/memory: today's check-in and which day it is. Nothing else
 * about the user is sent: the backend reads their likes, goal, workouts and declines from
 * Memory and works today's numbers out itself. It refuses a request that carries any of those.
 */
export function buildMemoryRequest(state: AppState, date: string) {
  const c = state.today.checkIn;
  const mood = c.mood ?? "surprise";
  return {
    user_id: USER_ID,
    date,
    check_in: {
      minutes: c.minutes ?? 30, place: c.place ?? "indoors_private", energy: c.energy ?? "normal", mood,
      mood_name: mood === "surprise" ? null : getFamily(mood).name,
    },
    // "I want more today": aim for 1.5× what is still needed.
    want_more: state.today.boost,
  };
}

interface MemoryPickReply extends TablePickReply {
  /** What the pick would add toward the goal, worked out by the backend */
  met_hours: number;
}

/** A pick from the memory route. Its MET-hours are the backend's; the calculator here is not asked. */
function memorySuggestion(p: MemoryPickReply): Suggestion {
  const id = tableId(p.activity_code);
  return {
    familyId: id, variantId: id, durationMin: p.duration_min, met: p.met_value,
    credit: p.met_hours, rawMetHours: p.met_hours, reasons: p.reasons, score: p.probability,
  };
}

/**
 * Today's pick when the app runs with the backend: from the check-in alone. null when the
 * backend can't be reached, finds nothing that fits (422), errors, or takes longer than `waitMs`.
 */
export async function fetchMemorySuggestion(state: AppState, date: string, waitMs: number): Promise<BackendSuggestion | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), waitMs);
  try {
    const res = await fetch(`${BASE}/suggest/memory`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildMemoryRequest(state, date)), signal: abort.signal,
    });
    if (!res.ok) {
      console.warn("No suggestion from the backend.", res.status, await res.text());
      return null;
    }
    const d = await res.json();
    const picks: MemoryPickReply[] = [d.lead, ...d.backups];
    return {
      source: d.source, model: d.model, logId: d.log_id,
      lead: memorySuggestion(d.lead), backups: d.backups.map(memorySuggestion),
      jevRequest: d.jev_request, jevAnswers: d.jev_answers, rows: picks.map(tableRow),
    };
  } catch (e) {
    console.warn(abort.signal.aborted ? `No suggestion from the backend within ${waitMs / 1000} s.` : "The backend can't be reached for a suggestion.", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadRemoteState(): Promise<unknown | null> {
  const res = await fetch(`${BASE}/state${userQuery()}`);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return (await res.json()).state;
}

export async function saveRemoteState(state: unknown): Promise<void> {
  await fetch(`${BASE}/state${userQuery()}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
}

export async function clearRemoteState(): Promise<void> {
  await fetch(`${BASE}/state${userQuery()}`, { method: "DELETE" });
}
