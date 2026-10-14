/**
 * Persistence layer.
 *
 * Today: the whole app state is saved to the browser's localStorage so a
 * demo survives a page refresh.
 *
 * Later: replace `LocalStorageRepository` with an implementation that calls
 * your backend / database (e.g. Supabase, Firebase, or a small REST API).
 * The rest of the app only talks to the `UserRepository` interface, so no
 * screen code needs to change. See docs/architecture.md for a suggested
 * table layout.
 */
import type { AppState } from "../state/types";

export interface UserRepository {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "pha-demo-state-v1";

export class LocalStorageRepository implements UserRepository {
  async load(): Promise<AppState | null> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppState) : null;
    } catch {
      return null;
    }
  }

  async save(state: AppState): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage can be unavailable (private mode); the demo still works in memory */
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Swap this one line to change where data lives. */
export const repository: UserRepository = new LocalStorageRepository();
