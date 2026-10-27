import { useEffect, useRef, useState } from "react";
import { SendIcon } from "../components/Icons";
import { UserMessage } from "../components/UserMessage";
import { fmt, fmtGoal } from "../lib/met";
import { agent } from "../services/agent";
import { STARTER_SUGGESTIONS } from "../services/mockResponses";
import { newId, useStore } from "../state/store";
import type { ChatMessage } from "../state/types";

export function CoachScreen() {
  const { state, dispatch, ctx } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const greeting: ChatMessage = {
    id: "greeting",
    role: "agent",
    text: `Hi ${state.profile.name}. You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours this week. Ask me anything: what counts, what a MET is, or how medals work.`,
    suggestions: STARTER_SUGGESTIONS,
  };
  const messages = [greeting, ...state.chat];
  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [state.chat]);

  /** `before` is the conversation the message follows (shorter when resending an edit). */
  const send = async (text: string, before: ChatMessage[] = state.chat) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setSelected(null);
    setBusy(true);
    const userMsg: ChatMessage = { id: newId("u"), role: "user", text: t, at: Date.now() };
    dispatch({ type: "addMessage", message: userMsg });
    const agentId = newId("a");
    dispatch({ type: "addMessage", message: { id: agentId, role: "agent", text: "" } });

    const { stream, suggestions } = agent.reply([...before, userMsg], ctx);
    let acc = "";
    try {
      for await (const chunk of stream) {
        acc += chunk;
        dispatch({ type: "updateMessage", id: agentId, text: acc });
      }
      dispatch({ type: "updateMessage", id: agentId, text: acc, suggestions });
    } catch {
      dispatch({ type: "updateMessage", id: agentId, text: "I couldn't reach the coach just now. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  /** Save on an edited message: drop it and everything after, then send the new text. */
  const resend = (id: string, text: string) => {
    const i = state.chat.findIndex((m) => m.id === id);
    if (i < 0 || busy) return;
    dispatch({ type: "editChat", id });
    send(text, state.chat.slice(0, i));
  };

  return (
    <>
      <div className="screen" ref={scroller}>
        <div className="screen-head">
          <div>
            <h1>Coach</h1>
            <p className="sub">The same coach as Today, for questions in your own words</p>
          </div>
        </div>
        <p className="disclaimer">Demo responses are pre-written. Not medical advice.</p>
        <div className="chat" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} style={{ display: "contents" }}>
              {m.role === "user" ? (
                <UserMessage
                  text={m.text}
                  at={m.at}
                  selected={selected === m.id}
                  onSelect={() => setSelected(selected === m.id ? null : m.id)}
                  onSave={(text) => resend(m.id, text)}
                  disabled={busy}
                />
              ) : (
                <div className={`msg ${m.role}`}>
                  {m.text || <span className="typing" aria-label="Coach is typing"><i /><i /><i /></span>}
                </div>
              )}
              {m === lastAgent && !busy && m.suggestions && (
                <div className="msg-suggestions">
                  {m.suggestions.map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <label className="sr-only" htmlFor="chat-input">Message the coach</label>
        <input id="chat-input" placeholder="Ask about your week or an activity" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        <button type="submit" aria-label="Send" disabled={!input.trim() || busy}><SendIcon /></button>
      </form>
    </>
  );
}
