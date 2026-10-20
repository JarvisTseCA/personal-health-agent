import { useEffect, useState } from "react";
import { PERSONAS } from "../data/mockFitbit";
import { backendHealth, type BackendHealth } from "../services/backend";
import { verifySuggestion } from "../lib/verify";
import { buildSuggestInput } from "../services/context";
import { buildSystemPrompt } from "../services/prompts";
import { personaProfile, useStore } from "../state/store";
import { DAY_NAMES_LONG } from "../lib/met";
import type { Screen } from "../state/types";

/**
 * Presenter controls shown beside the phone on wide screens. Not part of
 * the app itself: it lets the team set up a scenario during a demo and show
 * the backend at work (the verifier's checks, the prompt the coach gets).
 */
export function DemoPanel({ go }: { go: (s: Screen) => void }) {
  const { state, dispatch, ctx } = useStore();
  const [show, setShow] = useState<null | "prompt" | "checks" | "jev">(null);
  const [backend, setBackend] = useState<BackendHealth | null | undefined>(undefined);
  useEffect(() => { backendHealth().then(setBackend); }, []);
  const picked = state.today.current;

  const skipOnboarding = () => {
    dispatch({ type: "completeOnboarding", profile: personaProfile(state), plan: state.plan });
    go("today");
  };

  const current = state.today.accepted ?? state.today.current?.lead;
  const checks = current ? verifySuggestion(current, buildSuggestInput(state, ctx)) : [];

  return (
    <aside className="demo-panel" aria-label="Demo controls">
      <h2>Demo controls</h2>

      <div className="group">
        <label htmlFor="persona">Scenario</label>
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
        <button className="btn btn-quiet" disabled={!state.onboarded} onClick={() => { dispatch({ type: "restartDay" }); go("today"); }}>Start today's check-in over</button>
        <button className="btn btn-quiet" disabled={!state.onboarded} onClick={() => { dispatch({ type: "sync" }); go("today"); }}>Simulate a Fitbit sync</button>
        <button className="btn btn-quiet" disabled={!state.onboarded} onClick={() => dispatch({ type: "overlay", overlay: "recap" })}>Open the weekly recap</button>
        <button className="btn btn-quiet" disabled={!state.onboarded} onClick={() => { dispatch({ type: "updateProfile", patch: { clinicianViewEnabled: true } }); dispatch({ type: "overlay", overlay: "clinician" }); }}>Open the clinician view</button>
        <button className="btn btn-quiet" onClick={() => { dispatch({ type: "reset" }); go("onboarding"); }}>Reset demo</button>
      </div>

      <div className="group">
        <label>Backend</label>
        <p className="hint">
          {backend === undefined ? "Checking for the Python backend…"
            : backend === null ? "Python backend not running: suggestions come from the in-app ranker, data stays in this browser."
            : `Python backend connected (SQLite). Jev: ${backend.jev === "live" ? `live, ${backend.model}` : "mock (no API key set)"}.`}
          {picked && ` Current pick from: ${picked.source === "jev" ? "Jev" : picked.source === "mock" ? "mock Jev" : "in-app ranker"}.`}
        </p>
        <div className="seg-toggle">
          <button aria-pressed={show === "jev"} onClick={() => setShow(show === "jev" ? null : "jev")}>Jev prompt</button>
          <button aria-pressed={show === "checks"} onClick={() => setShow(show === "checks" ? null : "checks")}>Verifier checks</button>
          <button aria-pressed={show === "prompt"} onClick={() => setShow(show === "prompt" ? null : "prompt")}>What the coach sees</button>
        </div>
        {show === "checks" && (
          current ? (
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.name} className={c.ok ? "ok" : "fail"}>
                  <b>{c.ok ? "Pass" : "Fail"}: {c.name}</b>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          ) : <p className="hint">Get to a suggestion on the Today tab; the verifier checks it before the user sees it.</p>
        )}
        {show === "prompt" && <pre className="prompt-view">{buildSystemPrompt(ctx)}</pre>}
        {show === "jev" && (
          picked?.jev
            ? <pre className="prompt-view">{`Sent to ${picked.jev.model} (log #${picked.jev.logId}):\n${JSON.stringify(picked.jev.request, null, 2)}\n\nAnswers:\n${JSON.stringify(picked.jev.answers, null, 2)}`}</pre>
            : <p className="hint">Get to a suggestion on the Today tab with the backend running to see the prompt sent to Jev and its answers.</p>
        )}
        <p className="hint">The coach writes; the calculator does the math; a second agent runs these checks. Replies are scripted in this demo.</p>
      </div>
    </aside>
  );
}
