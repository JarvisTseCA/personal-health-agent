/**
 * ChatGPT on the Today tab, through the backend (backend/app/today_words.py and /api/chat).
 * Four jobs, each turning words into fields or fields into words; Jev still ranks and the code
 * still counts:
 *
 *  1. readTyped   a typed answer → the fields the buttons would give, or "it's a question"
 *  2. askToday    a question typed on Today → a reply, through the same checks as the Chat tab
 *                 (askTodayFromMemory on Memory: /api/chat/memory, as the Chat tab does)
 *  3. whyLine     today's pick and the code's facts → one "Based on …" sentence
 *  4. weekRecap   last week's numbers → Monday's two sentences
 *
 * Each one gives back null when there's no backend, no OPENAI_API_KEY, a slow or refused answer,
 * or an answer the backend's check turned down. The app then keeps its own words, as before.
 */
import type { TypedRead } from "../state/today";
import { BASE, backendHealth } from "./backend";

/** Whether ChatGPT is connected: the backend answers and has OPENAI_API_KEY. Checked once per page load. */
export async function chatModelLive(): Promise<boolean> {
  const h = await backendHealth();
  return !!h?.chat_writer && h.chat_writer !== "placeholder";
}

async function post(path: string, body: unknown, waitMs: number): Promise<Response | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), waitMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: stop.signal,
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** How long Today waits before it reads the answer itself (the user is looking at a typing dot). */
export const READ_WAIT_MS = 6000;

export async function readTyped(step: string, question: string, text: string): Promise<TypedRead | null> {
  const res = await post("/today/read", { step, question, text }, READ_WAIT_MS);
  return res ? ((await res.json()) as TypedRead) : null;
}

export async function whyLine(activity: string, facts: string[]): Promise<string | null> {
  const res = await post("/today/why", { activity, facts }, 10_000);
  return res ? ((await res.json()) as { line: string }).line : null;
}

export async function weekRecap(facts: Record<string, number | string | boolean>): Promise<string | null> {
  const res = await post("/today/recap", { facts }, 10_000);
  return res ? ((await res.json()) as { text: string }).text : null;
}

/** A question asked on Today, answered through /api/chat: urgent keywords, Jev's checks, then ChatGPT. */
export async function askToday(system: string, messages: Array<{ role: "user" | "assistant"; content: string }>): Promise<string | null> {
  const res = await post("/chat", { system, messages }, 30_000);
  if (!res) return null;
  try {
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

/** The same through /api/chat/memory, as the Chat tab does: the backend reads the user from Memory. */
export async function askTodayFromMemory(body: unknown): Promise<string | null> {
  const res = await post("/chat/memory", body, 30_000);
  if (!res) return null;
  try {
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}
