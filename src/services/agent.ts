/**
 * The agent interface used by every screen.
 *
 * `MockAgent` (default) answers from the pre-written script in
 * mockResponses.ts and streams the text word by word so it feels like an
 * LLM. To use a real model, implement `Agent` with `HttpAgent` below (or
 * similar) and change the `agent` export at the bottom of this file.
 */
import type { ChatMessage } from "../state/types";
import type { AgentContext } from "./context";
import { SCRIPTED_REPLIES } from "./mockResponses";
import { buildSystemPrompt } from "./prompts";

export interface AgentReply {
  /** Yields the reply text in chunks as it is "generated" */
  stream: AsyncIterable<string>;
  suggestions?: string[];
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

/**
 * Example of a real implementation. It expects a small backend route
 * (e.g. /api/chat) that forwards to an LLM provider. Never put an API key in
 * this frontend code — it would be visible to anyone using the app.
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

/** Swap to `new HttpAgent()` once a backend exists. */
export const agent: Agent = new MockAgent();
