/**
 * The Chat agent for the two ways the app runs: the scripted one without the backend, and
 * MemoryAgent with it. The request MemoryAgent sends carries the recent conversation, the user,
 * the date and the clinician's notes, and nothing about the user's progress.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../state/store";
import type { AppState, ChatMessage } from "../state/types";
import { agent, agentFor, buildMemoryChatRequest, MemoryAgent, MockAgent, NO_REPLY, RECENT_MESSAGES } from "./agent";
import { BASE } from "./backend";
import type { AgentContext } from "./context";
import { USER_ID } from "./userId";

afterEach(() => vi.unstubAllGlobals());

const DATE = "2026-11-25";

const user = (text: string): ChatMessage => ({ id: `u-${text}`, role: "user", text });
const reply = (text: string): ChatMessage => ({ id: `a-${text}`, role: "agent", text });

function withNotes(...texts: string[]): AppState {
  return { ...initialState(), clinician: { entries: texts.map((text, i) => ({ id: `cn${i}`, text, at: `2026-11-2${i}T09:30:00.000Z` })) } };
}

const ctxOf = (state: AppState) => ({ state }) as AgentContext;

/** A session whose earlier steps are all saved. */
const session = { settled: async () => undefined, today: () => DATE };

/** The backend's answer: plain text in pieces, and the header that says what kind of reply it is. */
function stubChat(pieces: string[], kind: string | null = "model", status = 200) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
        controller.close();
      },
    });
    return new Response(body, { status, headers: kind ? { "X-Chat-Reply": kind } : {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function read(stream: AsyncIterable<string>): Promise<string[]> {
  const pieces: string[] = [];
  for await (const piece of stream) pieces.push(piece);
  return pieces;
}

describe("the request for a Chat reply from the backend", () => {
  it("has exactly the user, the date, the conversation and the clinician's notes", () => {
    const request = buildMemoryChatRequest([user("How am I doing this week?")], withNotes(), DATE);
    expect(Object.keys(request).sort()).toEqual(["clinician_notes", "date", "messages", "user_id"]);
    expect(request).toEqual({
      user_id: USER_ID,
      date: DATE,
      messages: [{ role: "user", content: "How am I doing this week?" }],
      clinician_notes: [],
    });
  });

  it("sends the conversation oldest first, with the agent's messages as the assistant's", () => {
    const { messages } = buildMemoryChatRequest([user("What's a MET?"), reply("A MET is…"), user("And a MET-hour?")], withNotes(), DATE);
    expect(messages).toEqual([
      { role: "user", content: "What's a MET?" },
      { role: "assistant", content: "A MET is…" },
      { role: "user", content: "And a MET-hour?" },
    ]);
  });

  it(`sends only the latest ${RECENT_MESSAGES} messages, starting with one the user wrote`, () => {
    const long = Array.from({ length: 31 }, (_, i) => (i % 2 === 0 ? user(`question ${i}`) : reply(`answer ${i}`)));
    const { messages } = buildMemoryChatRequest(long, withNotes(), DATE);
    // The latest 20 are "answer 11" … "question 30"; the answer at the front has no question with it, so it goes.
    expect(messages).toHaveLength(RECENT_MESSAGES - 1);
    expect(messages[0]).toEqual({ role: "user", content: "question 12" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "question 30" });
  });

  it("leaves out a message with no words in it", () => {
    const { messages } = buildMemoryChatRequest([user("Hi"), reply(""), user("Are you there?")], withNotes(), DATE);
    expect(messages.map((m) => m.content)).toEqual(["Hi", "Are you there?"]);
  });

  it("leaves out the line shown when the agent couldn't be reached: the agent never said it", () => {
    const { messages } = buildMemoryChatRequest([user("Is walking enough?"), reply(NO_REPLY), user("Is walking enough?")], withNotes(), DATE);
    expect(messages).toEqual([
      { role: "user", content: "Is walking enough?" },
      { role: "user", content: "Is walking enough?" },
    ]);
  });

  it("sends what the user saved as their clinician's feedback, in the order it was saved", () => {
    const state = withNotes("Keep to moderate exercise for now.", "Add two strength days a week.");
    expect(buildMemoryChatRequest([user("What did my clinician suggest?")], state, DATE).clinician_notes).toEqual([
      { text: "Keep to moderate exercise for now." },
      { text: "Add two strength days a week." },
    ]);
  });
});

describe("MemoryAgent", () => {
  it("posts the request to /chat/memory and gives the reply piece by piece", async () => {
    const fetchMock = stubChat(["You're at ", "2.5 of 7.5 ", "this week."]);
    const state = withNotes("Keep it moderate.");

    const answer = new MemoryAgent(session).reply([user("How am I doing this week?")], ctxOf(state));

    expect((await read(answer.stream)).join("")).toBe("You're at 2.5 of 7.5 this week.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/chat/memory`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(buildMemoryChatRequest([user("How am I doing this week?")], state, DATE));
    expect(answer.suggestions).toBeUndefined(); // no quick replies under a reply from the backend
  });

  it.each(["model", "urgent", "medical_advice", "off_topic"] as const)("says a reply was %s once it has arrived", async (kind) => {
    stubChat(["Some reply."], kind);
    const answer = new MemoryAgent(session).reply([user("Hello")], ctxOf(withNotes()));
    expect(answer.kind?.()).toBeUndefined(); // not known before the backend has answered
    await read(answer.stream);
    expect(answer.kind?.()).toBe(kind);
  });

  it("leaves the kind out when the backend names one the app doesn't know, or none", async () => {
    for (const kind of ["something-new", null]) {
      stubChat(["Some reply."], kind);
      const answer = new MemoryAgent(session).reply([user("Hello")], ctxOf(withNotes()));
      await read(answer.stream);
      expect(answer.kind?.()).toBeUndefined();
    }
  });

  it("asks only once every earlier step is saved, so the backend reads Memory as it is now", async () => {
    const fetchMock = stubChat(["ok"]);
    let saved!: () => void;
    const waiting = { settled: () => new Promise<undefined>((done) => { saved = () => done(undefined); }), today: () => DATE };

    const answer = new MemoryAgent(waiting).reply([user("Hello")], ctxOf(withNotes()));
    const reading = read(answer.stream);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    saved();
    expect(await reading).toEqual(["ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the date the session gives for the app's today", async () => {
    const fetchMock = stubChat(["ok"]);
    const monday = { settled: async () => undefined, today: vi.fn(() => "2026-11-23") };
    const state = withNotes();
    await read(new MemoryAgent(monday).reply([user("Hello")], ctxOf(state)).stream);
    expect(monday.today).toHaveBeenCalledWith(state);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).date).toBe("2026-11-23");
  });

  it("fails when the backend doesn't answer ok, so the Chat screen can say it couldn't reach the agent", async () => {
    stubChat(["Jev could not be reached"], null, 502);
    const answer = new MemoryAgent(session).reply([user("Hello")], ctxOf(withNotes()));
    await expect(read(answer.stream)).rejects.toThrow(/502/);
  });
});

describe("which agent the Chat tab uses", () => {
  it("is the scripted one without the backend", () => {
    expect(agentFor(null)).toBe(agent);
    expect(agent).toBeInstanceOf(MockAgent);
  });

  it("is the backend's when a Memory session is open", () => {
    expect(agentFor(session)).toBeInstanceOf(MemoryAgent);
  });
});
