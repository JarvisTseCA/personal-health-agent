import { useEffect, useRef, useState } from "react";
import { SendIcon } from "../components/Icons";
import { agent } from "../services/agent";
import { STARTER_SUGGESTIONS } from "../services/mockResponses";
import { newId, useStore } from "../state/store";
import type { ChatMessage } from "../state/types";

export function CoachScreen() {
  const { state, dispatch, ctx } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const greeting: ChatMessage = {
    id: "greeting",
    role: "agent",
    text: `Hi ${state.profile.name}. You're at ${ctx.week.doneMinutes} of 150 guideline minutes this week. Ask me what to do next, or whether something counts.`,
    suggestions: STARTER_SUGGESTIONS,
  };
  const messages = [greeting, ...state.chat];
  const lastAgent = [...messages].reverse().find((m) => m.role === "agent");

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [state.chat]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setBusy(true);
    const userMsg: ChatMessage = { id: newId("u"), role: "user", text: t };
    dispatch({ type: "addMessage", message: userMsg });
    const agentId = newId("a");
    dispatch({ type: "addMessage", message: { id: agentId, role: "agent", text: "" } });

    const { stream, suggestions } = agent.reply([...state.chat, userMsg], ctx);
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

  return (
    <>
      <div className="screen" ref={scroller}>
        <div className="screen-head">
          <div>
            <h1>Coach</h1>
            <p className="sub">Answers use your Fitbit data and the activities you enjoy</p>
          </div>
        </div>
        <p className="disclaimer">Demo responses are pre-written. Not medical advice.</p>
        <div className="chat" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} style={{ display: "contents" }}>
              <div className={`msg ${m.role}`}>
                {m.text || <span className="typing" aria-label="Coach is typing"><i /><i /><i /></span>}
              </div>
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
        <input id="chat-input" placeholder="Ask about your week" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        <button type="submit" aria-label="Send" disabled={!input.trim() || busy}><SendIcon /></button>
      </form>
    </>
  );
}
