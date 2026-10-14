import { useState } from "react";
import { PERSONAS } from "../data/mockFitbit";
import { DAY_NAMES_LONG } from "../lib/guideline";
import { buildSystemPrompt } from "../services/prompts";
import { useStore } from "../state/store";
import type { Screen } from "../state/types";

/**
 * Presenter controls shown beside the phone on wide screens. Not part of
 * the app itself — it lets the team set up a scenario during a demo.
 */
export function DemoPanel({ go }: { go: (s: Screen) => void }) {
  const { state, dispatch, ctx } = useStore();
  const [showPrompt, setShowPrompt] = useState(false);

  const skipOnboarding = () => {
    dispatch({
      type: "completeOnboarding",
      profile: { ...state.profile, enjoyedFamilyIds: state.profile.enjoyedFamilyIds.length ? state.profile.enjoyedFamilyIds : ["cycling", "dancing"], fitbitConnected: true },
    });
    go("week");
  };

  return (
    <aside className="demo-panel" aria-label="Demo controls">
      <h2>Demo controls</h2>

      <div className="group">
        <label htmlFor="persona">Fitbit data</label>
        <select id="persona" value={state.personaId} onChange={(e) => dispatch({ type: "loadPersona", personaId: e.target.value })}>
          {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="hint">{PERSONAS.find((p) => p.id === state.personaId)?.blurb}</p>
      </div>

      <div className="group">
        <label htmlFor="today">Pretend today is</label>
        <select id="today" value={state.todayIndex} onChange={(e) => dispatch({ type: "setToday", index: Number(e.target.value) })}>
          {DAY_NAMES_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>

      <div className="group">
        {!state.onboarded && <button className="btn btn-quiet" onClick={skipOnboarding}>Skip onboarding</button>}
        <button className="btn btn-quiet" onClick={() => dispatch({ type: "syncFitbit" })} disabled={!state.onboarded}>Simulate a Fitbit sync</button>
        <button className="btn btn-quiet" onClick={() => { dispatch({ type: "reset" }); go("onboarding"); }}>Reset demo</button>
      </div>

      <div className="group">
        <button className="btn btn-quiet" aria-expanded={showPrompt} onClick={() => setShowPrompt((s) => !s)}>
          {showPrompt ? "Hide" : "Show"} what the agent sees
        </button>
        {showPrompt && <pre className="prompt-view">{buildSystemPrompt(ctx)}</pre>}
        <p className="hint">This is the prompt a real LLM would receive. Today the coach answers from pre-written scripts.</p>
      </div>
    </aside>
  );
}
