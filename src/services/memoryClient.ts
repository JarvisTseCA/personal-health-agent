/**
 * The calls the app makes when it runs with the backend: read Memory, tell it what changed,
 * and get the numbers back (backend/app/main.py: /api/memory and /api/numbers).
 *
 * Every call that changes Memory can say which day it is in the app (`date`); the reply then
 * carries the numbers as they are after the change, so the app never has to work one out.
 * Each function throws when the backend can't be reached or refuses the request.
 */
import { BASE } from "./backend";
import type { Memory, MemoryPart, Numbers } from "./memoryTypes";
import type { MemoryChanges } from "./toMemory";
import { USER_ID } from "./userId";

function url(path: string, date?: string): string {
  const day = date ? `&date=${date}` : "";
  return `${BASE}${path}?user_id=${encodeURIComponent(USER_ID)}${day}`;
}

async function call(path: string, method: string, date?: string, body?: unknown): Promise<{ memory?: Memory; numbers?: Numbers | null }> {
  const res = await fetch(url(path, date), {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} /api${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * What Memory holds about this user, as the backend gives it to the app: this week and the
 * 26 weeks before it. Memory itself keeps everything, however far back it goes; the totals in
 * the numbers (the streak, the trophies) count all of it. `date` is any day of this week.
 * The reply also carries the numbers for `date`; they are left alone here. The app asks for
 * the numbers of its own today, after it has saved today's open (memorySession.ts).
 */
export async function readMemory(date: string): Promise<Memory> {
  return (await call("/memory", "GET", date)).memory!;
}

/** The numbers for one day. null: Memory has no weekly goal and plan yet, so there is nothing to work out. */
export async function readNumbers(date: string): Promise<Numbers | null> {
  return (await call("/numbers", "GET", date)).numbers ?? null;
}

/** Save any part of Memory. With `date`, the numbers after the save come back. */
export async function saveMemory(part: MemoryPart, date?: string): Promise<Numbers | null> {
  return (await call("/memory", "POST", date, part)).numbers ?? null;
}

/**
 * Tell the backend what a step changed: first the parts to save, then the entries to take out
 * (one that is already gone is fine). With `date`, the numbers after all of it come back, in
 * the reply to the last change, so a step is usually one request.
 */
export async function sendChanges(changes: MemoryChanges, date?: string): Promise<Numbers | null> {
  let numbers: Numbers | null | undefined; // undefined: not asked for yet
  const removals = changes.remove.length;
  if (changes.save) {
    const after = await saveMemory(changes.save, removals ? undefined : date);
    if (date && !removals) numbers = after;
  }
  for (const [i, { kind, key }] of changes.remove.entries()) {
    const last = date && i === removals - 1 ? date : undefined;
    const res = await fetch(url(`/memory/${kind}/${encodeURIComponent(key)}`, last), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`DELETE /api/memory/${kind}/${key} failed: ${res.status}`);
    if (last && res.ok) numbers = ((await res.json()) as { numbers?: Numbers | null }).numbers ?? null;
  }
  if (!date) return null;
  return numbers === undefined ? readNumbers(date) : numbers;
}

/** Start this user over in Memory with exactly this: forget everything, then save it all. */
export async function replaceMemory(memory: Memory, date: string): Promise<Numbers | null> {
  await call("/memory", "DELETE");
  return saveMemory(memory, date);
}
