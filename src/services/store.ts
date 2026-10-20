/**
 * Persistence layer.
 *
 * Today: the whole app state is saved as one JSON document, in SQLite when
 * the Python backend is running and in the browser's localStorage when it
 * isn't (e.g. GitHub Pages).
 *
 * The rest of the app only talks to the `UserRepository` interface, so no
 * screen code needs to change when the storage does. See
 * docs/architecture.md for a suggested table layout.
 */
import type { AppState } from "../state/types";
import { backendHealth, clearRemoteState, loadRemoteState, saveRemoteState } from "./backend";

export interface UserRepository {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "pha-demo-state-v2";

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

/**
 * SQLite through the Python backend (backend/) when it's running, otherwise
 * localStorage. Saves are debounced so a burst of taps is one request.
 */
export class BackendRepository implements UserRepository {
  private local = new LocalStorageRepository();
  private timer: ReturnType<typeof setTimeout> | undefined;

  async load(): Promise<AppState | null> {
    if (!(await backendHealth())) return this.local.load();
    try {
      return (await loadRemoteState()) as AppState | null;
    } catch {
      return this.local.load();
    }
  }

  async save(state: AppState): Promise<void> {
    if (!(await backendHealth())) return this.local.save(state);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => saveRemoteState(state).catch(() => this.local.save(state)), 300);
  }

  async clear(): Promise<void> {
    if (await backendHealth()) await clearRemoteState().catch(() => undefined);
    await this.local.clear();
  }
}

/** Swap this one line to change where data lives. */
export const repository: UserRepository = new BackendRepository();
