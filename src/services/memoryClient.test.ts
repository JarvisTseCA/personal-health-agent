/**
 * memoryClient.ts: readMemory(date) sends the date, so the backend answers with the recent part
 * of Memory (this week and the 26 before it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE } from "./backend";
import { readMemory } from "./memoryClient";
import type { Memory } from "./memoryTypes";
import { USER_ID } from "./userId";

afterEach(() => vi.unstubAllGlobals());

const aMemory = { who: { name: "Alex", fitbit_connected: null }, goals: [] } as unknown as Memory;

function stubFetch(reply: { ok: boolean; status?: number; body?: unknown }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: reply.ok,
    status: reply.status ?? (reply.ok ? 200 : 500),
    json: async () => reply.body,
    text: async () => "nope",
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("readMemory", () => {
  it("makes one GET to /memory with the user and the date, and returns the reply's memory", async () => {
    const fetchMock = stubFetch({ ok: true, body: { memory: aMemory } });

    const memory = await readMemory("2026-11-23");

    expect(memory).toEqual(aMemory);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.startsWith(`${BASE}/memory?`)).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("user_id")).toBe(USER_ID);
    expect(query.get("date")).toBe("2026-11-23");
    expect(init?.method).toBe("GET");
  });

  it("throws when the backend does not answer ok", async () => {
    stubFetch({ ok: false, status: 503 });
    await expect(readMemory("2026-11-23")).rejects.toThrow(/503/);
  });
});
