/**
 * Clinician view: opened on the user's own phone during a visit and handed
 * to the clinician. No clinician account. Limits set here go straight into
 * the verifier's rules; the user sees a summary of changes on hand-back.
 */
import { useState } from "react";
import { StethoscopeIcon } from "../components/Icons";
import { getFamily } from "../lib/activities";
import { WEEKLY_UPPER_LIMIT } from "../lib/goal";
import { fmt, fmtGoal } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason } from "../lib/suggest";
import { useStore } from "../state/store";
import type { ClinicianSettings } from "../state/types";

const SESSION_CAPS: Array<[string, number | null]> = [["No limit", null], ["30 min", 30], ["45 min", 45], ["60 min", 60]];

function summarizeChanges(a: ClinicianSettings, b: ClinicianSettings, defaultGoal: number): string | null {
  const out: string[] = [];
  if (a.goal !== b.goal) out.push(b.goal === null ? `goal back to ${fmtGoal(defaultGoal)}` : `goal set to ${fmtGoal(b.goal)} MET-hours`);
  if (a.noVigorous !== b.noVigorous) out.push(b.noVigorous ? "no vigorous activity for now" : "vigorous activity allowed again");
  if (a.maxSessionMin !== b.maxSessionMin) out.push(b.maxSessionMin ? `sessions up to ${b.maxSessionMin} min` : "no session length limit");
  if (a.note !== b.note && b.note.trim()) out.push("a note for you");
  return out.length ? `Your clinician changed: ${out.join(", ")}.` : null;
}

export function ClinicianView() {
  const { state, ctx, dispatch } = useStore();
  const c = state.clinician;
  const [before] = useState(c);
  const set = (patch: Partial<ClinicianSettings>) => dispatch({ type: "clinician", patch });

  const weeks = [...ctx.past.map((w) => ({ label: w.label, done: w.totals.done, goal: w.goal })), { label: "Now", done: ctx.week.done, goal: ctx.goal }].slice(-5);
  const max = Math.max(...weeks.map((w) => Math.max(w.done, w.goal)), 1) * 1.1;

  const allSessions = [...ctx.past.flatMap((w) => w.totals.sessions), ...ctx.week.sessions];
  const mix = new Map<string, number>();
  for (const s of allSessions) mix.set(s.familyId, (mix.get(s.familyId) ?? 0) + s.durationMin);
  const mixRows = [...mix.entries()].sort((a, b) => b[1] - a[1]);
  const mixMax = Math.max(...mixRows.map((r) => r[1]), 1);

  const reasons = new Map<DeclineReason, number>();
  for (const d of state.declines) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);

  const allMedals = [...ctx.past.flatMap((w) => w.medals), ...ctx.medals.slice(0, state.todayIndex + 1)];
  let gap = 0;
  let longestGap = 0;
  for (const m of allMedals) { gap = m === "none" ? gap + 1 : 0; longestGap = Math.max(longestGap, gap); }

  const handBack = () => {
    const msg = summarizeChanges(before, c, state.goal);
    dispatch({ type: "overlay", overlay: null });
    if (msg) dispatch({ type: "toast", text: msg });
  };

  const goal = c.goal ?? state.goal;

  return (
    <div className="clinician" role="dialog" aria-label="Clinician view">
      <header className="clinician-head">
        <StethoscopeIcon className="i" />
        <div>
          <h1>Clinician view</h1>
          <p className="xs">{state.profile.name}'s activity, shared by them during this visit</p>
        </div>
      </header>

      <div className="clinician-body">
        <section>
          <h2>Weekly MET-hours</h2>
          <svg viewBox="0 0 320 132" className="cl-chart" role="img" aria-label={weeks.map((w) => `${w.label}: ${fmt(w.done)} of ${fmtGoal(w.goal)}`).join("; ")}>
            {weeks.map((w, i) => {
              const x = 16 + i * 62;
              const h = (w.done / max) * 96;
              const gy = 104 - (w.goal / max) * 96;
              const met = w.done + 1e-9 >= w.goal;
              return (
                <g key={i}>
                  <rect x={x} y={104 - h} width="40" height={h} rx="5" fill={met ? "var(--ink)" : "var(--line-strong)"} />
                  <line x1={x - 6} x2={x + 46} y1={gy} y2={gy} stroke="var(--ink)" strokeDasharray="3 3" />
                  <text x={x + 20} y={100 - h} textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight="700">{fmt(w.done)}</text>
                  <text x={x + 20} y="122" textAnchor="middle" fontSize="11" fill="var(--ink-2)">{w.label}</text>
                </g>
              );
            })}
          </svg>
          <p className="xs muted">Dashed line: that week's goal. Dark bars met it.</p>
        </section>

        <section>
          <h2>Activity mix</h2>
          <ul className="counts">
            {mixRows.map(([id, min]) => (
              <li key={id}>
                <span className="small">{getFamily(id).name}</span>
                <span className="small num">{min} min</span>
                <div className="bar"><span style={{ width: `${(min / mixMax) * 100}%`, background: getFamily(id).color }} /></div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Why workouts get skipped</h2>
          {reasons.size === 0 ? <p className="small muted">No declines recorded.</p> : (
            <p className="small">{[...reasons.entries()].map(([r, n]) => `${DECLINE_LABEL[r]}: ${n}`).join(", ")}</p>
          )}
        </section>

        <section>
          <h2>Flags</h2>
          <ul className="flags">
            <li className={state.painReports ? "warn" : ""}>{state.painReports ? `${state.painReports} "something hurts" report${state.painReports > 1 ? "s" : ""}` : "No pain reports"}</li>
            <li className={longestGap >= 3 ? "warn" : ""}>Longest gap without activity: {longestGap} {longestGap === 1 ? "day" : "days"}</li>
            <li>{WEEKLY_UPPER_LIMIT === null ? "Weekly upper limit not set yet (open clinical question)" : `Weeks over ${WEEKLY_UPPER_LIMIT} MET-hours flagged`}</li>
          </ul>
        </section>

        <section>
          <h2>Goal and limits</h2>
          <div className="cl-field">
            <span className="small"><b>Weekly goal</b><br /><span className="xs muted">{c.goal === null ? "Using the app's goal" : "Locks automatic changes"}</span></span>
            <div className="stepper">
              <button aria-label="Lower goal by 0.5" onClick={() => set({ goal: Math.max(1, goal - 0.5) })}>−</button>
              <span className="num" style={{ minWidth: 56, textAlign: "center", fontWeight: 700 }}>{fmtGoal(goal)}</span>
              <button aria-label="Raise goal by 0.5" onClick={() => set({ goal: goal + 0.5 })}>+</button>
            </div>
          </div>
          {c.goal !== null && <button className="link-btn" onClick={() => set({ goal: null })}>Use the app's goal again</button>}
          <div className="switch-row">
            <div><b className="small">No vigorous activity</b><p className="xs muted">Nothing at 6 MET or more</p></div>
            <button className="switch" role="switch" aria-checked={c.noVigorous} aria-label="No vigorous activity" onClick={() => set({ noVigorous: !c.noVigorous })} />
          </div>
          <div className="cl-field column">
            <b className="small">Longest session</b>
            <div className="slot-row">
              {SESSION_CAPS.map(([label, v]) => (
                <button key={label} role="radio" aria-checked={c.maxSessionMin === v} className="slot" onClick={() => set({ maxSessionMin: v })}>{label}</button>
              ))}
            </div>
          </div>
          <label className="cl-field column">
            <b className="small">Note for {state.profile.name}</b>
            <textarea rows={2} placeholder="e.g. Try adding two strength days" value={c.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
        </section>
      </div>

      <footer className="clinician-foot">
        <button className="btn btn-primary btn-block" onClick={handBack}>Hand back to {state.profile.name}</button>
      </footer>
    </div>
  );
}
