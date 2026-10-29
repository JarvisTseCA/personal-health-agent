/**
 * Clinician tab: opened on the user's own phone during a visit and handed to
 * the clinician. No clinician account. Opening the tab first asks the user to
 * agree to share their records; nothing shows until they do.
 *
 * The clinician reviews a digestible summary of the user's activity and can
 * leave optional notes. The notes are context for the agent in later
 * conversations; they don't change the user's goal or limits. The user and
 * clinician talk it through in person, and the user makes the final call on
 * their goals (on the Progress tab).
 */
import { useEffect, useRef, useState } from "react";
import { StethoscopeIcon } from "../components/Icons";
import { Trophy } from "../components/Rewards";
import { fmt, fmtGoal } from "../lib/met";
import { buildClinicianSummary } from "../services/clinicianSummary";
import { useStore } from "../state/store";

const ROLES = ["Physician", "Nurse practitioner", "Physician assistant", "Physical therapist", "Exercise physiologist", "Other"];

/** One-tap starters for common suggestions; they're added to the note as text the clinician can edit. */
const QUICK_NOTES = [
  "Build up gradually: add about 10 minutes a week.",
  "Moderate intensity only for now.",
  "Add two strength days a week.",
  "Stop and call if you feel chest pain, dizziness or unusual shortness of breath.",
];

export function ClinicianScreen({ onSaved, onLeave }: { onSaved: () => void; onLeave: () => void }) {
  const { state } = useStore();
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="clinician" role="region" aria-label="Clinician">
      <header className="clinician-head">
        <StethoscopeIcon className="i" />
        <div>
          <h1>Clinician</h1>
          <p className="xs">{agreed ? `${state.profile.name}'s activity summary, shared by them during this visit` : "Locked until the patient agrees"}</p>
        </div>
      </header>

      {agreed ? (
        <Session onSaved={onSaved} onCancel={onLeave} />
      ) : (
        <>
          <div className="clinician-body cl-locked" aria-hidden />
          <ConsentDialog onYes={() => setAgreed(true)} onNo={onLeave} />
        </>
      )}
    </div>
  );
}

function ConsentDialog({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  return (
    <>
      <div className="consent-backdrop" />
      <div className="consent" role="alertdialog" aria-modal="true" aria-labelledby="consent-title" aria-describedby="consent-body">
        <div className="consent-icon"><StethoscopeIcon /></div>
        <h2 id="consent-title">Share your summary with your clinician?</h2>
        <p id="consent-body">
          If you'd like your clinician to review your activity, please hand your phone to them now. They'll see a summary of
          your records and can leave notes for the agent. You'll decide on any changes to your goals together.
        </p>
        <p className="xs muted">They'll see your weekly MET-hours, VO2 max trend, activity mix, skipped workouts and any pain reports.</p>
        <div className="consent-actions">
          <button ref={yes} className="btn btn-primary btn-block" onClick={onYes}>Yes, I'm handing it over</button>
          <button className="btn btn-quiet btn-block" onClick={onNo}>Not now</button>
        </div>
      </div>
    </>
  );
}

/** After the user agrees: the summary, then optional notes, with the hand-back buttons pinned at the bottom. */
function Session({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { state, dispatch } = useStore();
  const c = state.clinician;
  const [name, setName] = useState(c.name ?? "");
  const [role, setRole] = useState(c.role ?? "");
  const [note, setNote] = useState(c.note ?? "");
  const changed = note.trim() !== (c.note ?? "").trim() || name.trim() !== (c.name ?? "").trim() || role !== (c.role ?? "");

  const handBack = () => {
    if (changed) {
      dispatch({ type: "clinicianNotes", notes: { note: note.trim(), name: name.trim(), role, updated: new Date().toISOString() } });
      dispatch({ type: "toast", text: note.trim() ? "Your clinician left notes. The agent will keep them in mind; your goals stay yours to set." : "Your clinician's notes were cleared." });
      // Start today's conversation again (workouts kept) so the agent can mention the notes.
      dispatch({ type: "setToday", index: state.todayIndex });
    }
    onSaved();
  };
  const addQuick = (q: string) => setNote((n) => (n.includes(q) ? n : `${n.trim()}${n.trim() ? "\n" : ""}${q}`));

  return (
    <>
      <div className="clinician-body">
        <Summary />
        <section>
          <h2>Notes for the agent <span className="cl-optional">Optional</span></h2>
          <p className="small muted" style={{ marginBottom: 12 }}>
            Suggestions you discuss with {state.profile.name} can go here. The agent uses them as context in later conversations.
            They don't change {state.profile.name}'s goal: {state.profile.name} decides that after talking with you.
          </p>
          <div className="cl-grid">
            <div className="cl-row">
              <label className="cl-label" htmlFor="cl-name">Your name</label>
              <input id="cl-name" className="cl-input" placeholder="e.g. Dr. Rivera" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="cl-row">
              <label className="cl-label" htmlFor="cl-role">Role</label>
              <select id="cl-role" className="cl-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Choose…</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="cl-row">
            <label className="cl-label" htmlFor="cl-note">Suggestions and notes</label>
            <textarea id="cl-note" className="cl-input" rows={4} placeholder="e.g. Blood pressure is improving. Keep to moderate intensity for now and try adding two strength days." value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="chips cl-quick" role="group" aria-label="Quick suggestions">
            {QUICK_NOTES.map((q) => <button key={q} className="chip" onClick={() => addQuick(q)}>+ {q.replace(/[.:].*$/, "")}</button>)}
          </div>
          <p className="xs muted" style={{ marginTop: 10 }}>{state.profile.name} can read and remove these notes in Preferences.</p>
        </section>
      </div>
      <footer className="clinician-foot">
        <div className="btn-row">
          <button className="btn btn-quiet" style={{ flex: "0 0 auto" }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handBack}>{changed ? "Save notes and hand back" : "Done, hand back"}</button>
        </div>
      </footer>
    </>
  );
}

/** What the clinician reads first: plain sentences, key numbers, then the detail. */
function Summary() {
  const { state, ctx } = useStore();
  const sum = buildClinicianSummary(ctx);
  const weeks = [...ctx.past.map((w) => ({ label: w.label, done: w.totals.done, goal: w.goal })), { label: "Now", done: ctx.week.done, goal: ctx.goal }].slice(-6);
  const max = Math.max(...weeks.map((w) => Math.max(w.done, w.goal)), 1) * 1.1;
  const mixMax = Math.max(...sum.topActivities.map((r) => r.min), 1);
  const healthNotes = state.notes.filter((n) => /health|anything we should know|hurts|pain/i.test(n.where) || /pain|hurt|sore|injur|pregnan|blood|heart|diabet/i.test(n.text));

  return (
    <>
      <section>
        <h2>At a glance</h2>
        <ul className="cl-lines">
          {sum.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
        <div className="facts cl-facts">
          <div className="fact"><div className="v num">{fmt(sum.avgMetHours)}</div><div className="k">MET-hours a week, avg of {sum.weeks || "–"}</div></div>
          <div className="fact"><div className="v num">{sum.goalWeeks}<span className="xs muted"> / {sum.weeks}</span></div><div className="k">weeks at goal</div></div>
          <div className="fact"><div className="v num">{Math.round(sum.avgActiveDays)}</div><div className="k">active days a week</div></div>
          <div className="fact"><div className="v num">{ctx.vo2 ? ctx.vo2.latest : "–"}</div><div className="k">VO2 max, mL/kg/min</div></div>
        </div>
      </section>

      <section>
        <h2>To discuss</h2>
        <ul className="flags">
          <li className={state.profile.hasHealthCondition ? "warn" : ""}>{state.profile.hasHealthCondition ? "Reports a health condition (no vigorous suggestions)" : "No health condition reported"}</li>
          <li className={state.painReports ? "warn" : ""}>{state.painReports ? `${state.painReports} "something hurts" report${state.painReports > 1 ? "s" : ""}` : "No pain reports"}</li>
          {healthNotes.map((n) => <li key={n.id} className="warn">They wrote: "{n.text}"</li>)}
          <li className={sum.longestGap >= 5 ? "warn" : ""}>Longest stretch without activity: {sum.longestGap} {sum.longestGap === 1 ? "day" : "days"}</li>
          <li>{sum.skipReasons.length ? `Why workouts get skipped: ${sum.skipReasons.map((r) => `${r.label.toLowerCase()} (${r.n})`).join(", ")}` : "No skipped workouts recorded"}</li>
        </ul>
      </section>

      <section>
        <h2>Weekly MET-hours</h2>
        <svg viewBox="0 0 330 132" className="cl-chart" role="img" aria-label={weeks.map((w) => `${w.label}: ${fmt(w.done)} of ${fmtGoal(w.goal)}`).join("; ")}>
          {weeks.map((w, i) => {
            const x = 10 + i * 54;
            const h = (w.done / max) * 96;
            const gy = 104 - (w.goal / max) * 96;
            const met = w.done + 1e-9 >= w.goal;
            return (
              <g key={i}>
                <rect x={x} y={104 - h} width="36" height={h} rx="5" fill={met ? "var(--ink)" : "var(--line-strong)"} />
                <line x1={x - 5} x2={x + 41} y1={gy} y2={gy} stroke="var(--ink)" strokeDasharray="3 3" />
                <text x={x + 18} y={100 - h} textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight="700">{fmt(w.done)}</text>
                <text x={x + 18} y="122" textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{w.label}</text>
              </g>
            );
          })}
        </svg>
        <p className="xs muted cl-chart-key"><Trophy size={12} /> Dark bars reached that week's goal (dashed line). 7.5 MET-hours = 150 min moderate or 75 min vigorous.</p>
      </section>

      <section>
        <h2>Activity mix, last {sum.weeks || 1} {sum.weeks === 1 ? "week" : "weeks"}</h2>
        {sum.topActivities.length === 0 ? <p className="small muted">No workouts recorded yet.</p> : (
          <ul className="counts">
            {sum.topActivities.map((a) => (
              <li key={a.name}>
                <span className="small">{a.name}</span>
                <span className="small num">{a.min} min</span>
                <div className="bar"><span style={{ width: `${(a.min / mixMax) * 100}%`, background: a.color }} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
