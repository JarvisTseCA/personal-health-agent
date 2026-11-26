/**
 * The agent that answers in the Chat tab. Which one depends on the app's one switch, whether
 * the backend answered when the app opened (`agentFor` at the bottom):
 *
 *  - Without the backend (the online demo): `MockAgent`. It answers from the pre-written
 *    script in mockResponses.ts and streams the text word by word so it feels like an LLM.
 *  - With the backend: `MemoryAgent`. It sends the message to POST /api/chat/memory, where it
 *    goes through two checks and, if it passes both, a model writes the reply.
 *
 * Feedback from the user's clinician ("My doctor said…") is taken in by the app's own script
 * in both cases, before either agent is asked (clinicianChat.ts, ChatScreen.tsx).
 */
import type { MemorySession } from "../state/memorySession";
import type { AppState, ChatMessage, ChatReply } from "../state/types";
import { BASE } from "./backend";
import type { AgentContext } from "./context";
import { SCRIPTED_REPLIES } from "./mockResponses";
import { buildSystemPrompt } from "./prompts";
import { USER_ID } from "./userId";

export interface AgentReply {
  /** Yields the reply text in chunks as it is "generated" */
  stream: AsyncIterable<string>;
  suggestions?: string[];
  /** A reply from the backend: what kind it was (see ChatReply). Known once the stream has started. */
  kind?: () => ChatReply | undefined;
}

export interface Agent {
  reply(history: ChatMessage[], ctx: AgentContext): AgentReply;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* streamWords(text: string, msPerWord = 28): AsyncIterable<string> {
  await sleep(450); // "thinking"
  const words = text.split(/(\s+)/);
  for (const w of words) {
    yield w;
    if (w.trim()) await sleep(msPerWord);
  }
}

export class MockAgent implements Agent {
  reply(history: ChatMessage[], ctx: AgentContext): AgentReply {
    const last = [...history].reverse().find((m) => m.role === "user");
    const text = (last?.text ?? "").toLowerCase().trim();
    const script = SCRIPTED_REPLIES.find((r) => r.match(text, ctx))!;
    return { stream: streamWords(script.reply(text, ctx)), suggestions: script.suggestions };
  }
}

/** How much of the conversation goes with a message. Memory keeps all of it; the model reads the latest part. */
export const RECENT_MESSAGES = 20;

const REPLY_KINDS: readonly ChatReply[] = ["model", "urgent", "medical_advice", "off_topic"];

/**
 * What the Chat tab says in place of a reply when the agent can't be reached. It stays on screen
 * and in Memory. It is not sent on with later messages as something the agent said.
 */
export const NO_REPLY = "I couldn't reach the agent just now. Check your connection and try again.";

/**
 * The request for POST /api/chat/memory: the recent conversation, who the user is and which
 * day it is for them. Nothing about their progress is sent: the backend reads the user from
 * Memory and works their numbers out itself, and it refuses a request that carries a prompt
 * of the app's own. The one thing sent along is what the user saved as their clinician's
 * feedback: the app keeps those notes itself, in the part of Memory the backend doesn't read.
 */
export function buildMemoryChatRequest(history: ChatMessage[], state: Pick<AppState, "clinician">, date: string) {
  let recent = history.filter((m) => m.text.trim() && !(m.role === "agent" && m.text === NO_REPLY)).slice(-RECENT_MESSAGES);
  // The part the model reads starts with something the user said.
  while (recent.length && recent[0].role === "agent") recent = recent.slice(1);
  return {
    user_id: USER_ID,
    date,
    messages: recent.map((m) => ({ role: m.role === "agent" ? ("assistant" as const) : ("user" as const), content: m.text })),
    clinician_notes: state.clinician.entries.map((n) => ({ text: n.text })),
  };
}

/**
 * The agent when the app runs with the backend. The reply is plain text that arrives piece by
 * piece. The backend also says what kind of reply it is (the model wrote it, or it is one of
 * the three fixed replies a stopped message gets); that is kept with the message and not shown.
 */
export class MemoryAgent implements Agent {
  constructor(private session: Pick<MemorySession, "settled" | "today">, private endpoint = `${BASE}/chat/memory`) {}

  reply(history: ChatMessage[], ctx: AgentContext): AgentReply {
    const { session, endpoint } = this;
    let kind: ChatReply | undefined;
    async function* run() {
      // Every step taken so far is saved first, so the backend reads Memory as it is now.
      await session.settled();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMemoryChatRequest(history, ctx.state, session.today(ctx.state))),
      });
      if (!res.ok || !res.body) throw new Error(`Agent request failed: ${res.status}`);
      kind = REPLY_KINDS.find((k) => k === res.headers.get("X-Chat-Reply"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    }
    return { stream: run(), kind: () => kind };
  }
}

/**
 * An agent for the backend's other Chat route, POST /api/chat, which takes the prompt the
 * caller built instead of reading Memory. The app doesn't use it. Never put an API key in
 * this frontend code: it would be visible to anyone using the app.
 */
export class HttpAgent implements Agent {
  constructor(private endpoint = "/api/chat") {}

  reply(history: ChatMessage[], ctx: AgentContext): AgentReply {
    const endpoint = this.endpoint;
    async function* run() {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemPrompt(ctx),
          messages: history.map((m) => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text })),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Agent request failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    }
    return { stream: run() };
  }
}

/** The scripted agent: what the app uses without the backend. */
export const agent: Agent = new MockAgent();

/** The agent for the way the app is running: with the backend (a Memory session is open) or without it. */
export function agentFor(session: Pick<MemorySession, "settled" | "today"> | null): Agent {
  return session ? new MemoryAgent(session) : agent;
}
