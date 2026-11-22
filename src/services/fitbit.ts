/**
 * Real Fitbit data through the Python backend, which talks to the Google
 * Health API (the Fitbit Web API was turned off on Nov 2, 2026). The backend
 * keeps the tokens; the browser never sees them.
 *
 * Without the backend, or without a client id in backend/.env, the app keeps
 * its simulated Fitbit. Setup: docs/architecture.md ("Real Fitbit data").
 */
import type { FitbitData } from "../lib/fitbit";
import { BASE } from "./backend";
import { userQuery } from "./userId";

export interface FitbitStatus {
  /** The backend has a Google OAuth client id and secret */
  configured: boolean;
  /** The backend holds tokens for this user */
  connected: boolean;
}

/** Null when the backend isn't running. */
export function fitbitStatus(): Promise<FitbitStatus | null> {
  return fetch(`${BASE}/fitbit/status${userQuery()}`)
    .then((r) => (r.ok ? (r.json() as Promise<FitbitStatus>) : null))
    .catch(() => null);
}

const POLL_MS = 1500;
const CONNECT_TIMEOUT_MS = 5 * 60_000;

/**
 * Opens Google's sign-in in a new tab, then checks the backend until it holds
 * the tokens. A new tab keeps the page the user is on (onboarding,
 * Preferences) where it was. Resolves false if the tab is closed, or 5
 * minutes pass, without connecting. Call it straight from a click, or the
 * browser blocks the tab.
 */
export function connectFitbit(): Promise<boolean> {
  const tab = window.open(`${BASE}/fitbit/connect${userQuery()}`, "_blank");
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      if ((await fitbitStatus())?.connected) {
        clearInterval(timer);
        resolve(true);
      } else if (!tab || tab.closed || Date.now() - started > CONNECT_TIMEOUT_MS) {
        clearInterval(timer);
        resolve(false);
      }
    }, POLL_MS);
  });
}

/** The backend no longer has a working sign-in (it expires after 7 days in Google's Testing mode). */
export class FitbitDisconnected extends Error {}

/** Workouts and VO2 max readings from `since` ("2026-05-18") to now. */
export async function fetchFitbitData(since: string): Promise<FitbitData> {
  const res = await fetch(`${BASE}/fitbit/sync?since=${since}${userQuery("&")}`);
  if (res.status === 401) throw new FitbitDisconnected("Your Fitbit sign-in has expired. Connect it again in Preferences.");
  if (!res.ok) throw new Error(`Fitbit sync failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as FitbitData;
}

export async function disconnectFitbit(): Promise<void> {
  const res = await fetch(`${BASE}/fitbit${userQuery()}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Disconnecting Fitbit failed: ${res.status}`);
}
