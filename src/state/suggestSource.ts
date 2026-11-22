/**
 * Where Today's suggestions come from:
 * - "library": the app's own 15 activities (the in-app ranker, then Jev through POST /api/suggest).
 * - "table": the activity table, through POST /api/suggest/table. While the backend decides, the
 *   card says "Finding one for you…"; if it can't be reached, errors or takes too long, the
 *   in-app ranker's pick is shown instead.
 *
 * The build setting VITE_SUGGEST_SOURCE picks the default ("library" unless it says "table").
 * The demo controls can switch it for testing; that choice is saved with the app state.
 */
import type { AppState, SuggestSource } from "./types";

export const DEFAULT_SUGGEST_SOURCE: SuggestSource = import.meta.env.VITE_SUGGEST_SOURCE === "table" ? "table" : "library";

export function suggestSourceOf(state: Pick<AppState, "suggestSource">): SuggestSource {
  return state.suggestSource ?? DEFAULT_SUGGEST_SOURCE;
}

/** How long Today waits for the table's pick before showing the in-app ranker's (open question 2 in the plan). */
export const TABLE_WAIT_MS = 10_000;
