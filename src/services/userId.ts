/**
 * Which saved state, suggestion log and Fitbit sign-in on the backend belong to this browser.
 *
 * On a shared backend (the hosted demo), every browser gets its own id, kept in localStorage,
 * so testers don't overwrite each other's progress. In development (npm run dev) it stays
 * "demo", so a laptop's existing saved state and Fitbit sign-in keep working.
 */
const KEY = "pha-user-id";

function browserId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const id = `browser-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return "demo"; // storage blocked: fall back to the shared id
  }
}

export const USER_ID: string = import.meta.env.DEV ? "demo" : browserId();

/** "?user_id=…" for the backend's per-user routes. */
export const userQuery = (prefix: "?" | "&" = "?") => `${prefix}user_id=${encodeURIComponent(USER_ID)}`;
