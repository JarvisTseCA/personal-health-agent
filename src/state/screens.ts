import type { Screen } from "./types";

/**
 * Screens hidden for now because they aren't polished yet (Nov 21, 2026). Their code stays; links to
 * them (#summary, #showcase) open Today, and nothing else in the app points to them. Remove a
 * screen from this set to bring it back (Summary has a tab; Showcase would need one added to TABS).
 * The Settings tab is a separate screen (#settings): likes and the weekly plan.
 */
export const HIDDEN_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["summary", "showcase"]);

export const isHidden = (s: Screen) => HIDDEN_SCREENS.has(s);
