/**
 * Talks to the Python backend (backend/). In dev, Vite proxies /api to it.
 *
 * The backend is optional: if it isn't running (or on GitHub Pages), every
 * call here fails quietly and the app keeps using the in-app ranker and
 * localStorage, exactly like the demo build.
 */
import { getFamily, getVariant } from "../lib/activities";
import { creditFor, DAY_NAMES_LONG, metHours } from "../lib/met";
import { candidates, type Suggestion } from "../lib/suggest";
import type { AppState } from "../state/types";
import { buildSuggestInput } from "./context";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

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
}

/** The variables from today's check-in and the options that passed the hard filters. */
export function buildSuggestRequest(state: AppState) {
  const input = buildSuggestInput(state);
  const { options, durations } = candidates(input);
  const c = input.constraint;
  return {
    day_name: DAY_NAMES_LONG[state.todayIndex],
    check_in: { minutes: input.minutes, place: input.place, energy: input.energy, mood: input.mood },
    needed_met_hours: input.needed,
    target_met_hours: input.target,
    // "Up for a challenge" aims for 1.5× today's target, same as "I want more".
    boost: input.boost || input.energy === "challenge",
    enjoyed: input.enjoyed
      .filter((id) => input.access[id] !== "no")
      .map((id, i) => ({ family_id: id, name: getFamily(id).name, rank: i + 1, access: input.access[id] ?? "have" })),
    options: options.map(({ family, variant }) => ({
      variant_id: variant.id, family_id: family.id, family_name: family.name, kind: family.kind,
      label: variant.label, met: variant.met, description: variant.description, setting: variant.setting ?? family.setting,
    })),
    durations,
    recent: input.recent.map((r) => ({ family_id: r.familyId, days_ago: r.daysAgo })),
    declines: state.declines.map((d) => ({ family_id: d.familyId, reason: d.reason, days_ago: state.todayIndex - d.day, note: d.note ?? null })),
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

export async function loadRemoteState(): Promise<unknown | null> {
  const res = await fetch(`${BASE}/state`);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return (await res.json()).state;
}

export async function saveRemoteState(state: unknown): Promise<void> {
  await fetch(`${BASE}/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
}

export async function clearRemoteState(): Promise<void> {
  await fetch(`${BASE}/state`, { method: "DELETE" });
}
