/**
 * Clinician tab: opened on the user's own phone during a visit and handed to
 * the clinician. No clinician account. Opening the tab first asks the user to
 * agree to share their records; nothing shows until they do.
 *
 * The goal template uses dropdowns for the structured fields and free text for
 * the rest. Goal, intensity and session limits go straight into the verifier's
 * rules; the note and precautions show on the user's Today screen.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StethoscopeIcon } from "../components/Icons";
import { getFamily } from "../lib/activities";
import { WEEKLY_UPPER_LIMIT } from "../lib/goal";
import { fmt, fmtGoal } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason } from "../lib/suggest";
import { useStore } from "../state/store";
import type { ClinicianSettings } from "../state/types";

const ROLES = ["Physician", "Nurse practitioner", "Physician assistant", "Physical therapist", "Exercise physiologist", "Other"];
const REASONS = [
  "General health and prevention",
  "Blood pressure or heart health",
  "Blood sugar or diabetes",
  "Weight management",
  "Returning after injury or illness",
  "Pregnancy or postpartum",
  "Other (see note)",
];
/** Weekly MET-hour presets. 7.5 = 150 min at 3 MET; 15 = 300 min, the top of the guideline range. */
const GOALS: Array<[number, string]> = [
  [3.75, "3.75: half the guideline"],
  [5, "5: building up"],
  [7.5, "7.5: the guideline"],
  [10, "10: above the guideline"],
  [15, "15: upper guideline range"],
];
const REVIEW = ["In 2 weeks", "In 4 weeks", "In 3 months", "At the next visit"];
const SESSION_CAPS: Array<[string, number | null]> = [["No limit", null], ["30 min", 30], ["45 min", 45], ["60 min", 60]];

type Draft = Required<Omit<ClinicianSettings, "updated">>;

/** The hand-back message: what changed, in plain words. */
export function summarizeChanges(a: ClinicianSettings, b: ClinicianSettings, defaultGoal: number): string | null {
  const out: string[] = [];
  if (a.goal !== b.goal) out.push(b.goal === null ? `goal back to ${fmtGoal(defaultGoal)}` : `goal set to ${fmtGoal(b.goal)} MET-hours`);
  if (a.noVigorous !== b.noVigorous) out.push(b.noVigorous ? "moderate activity only" : "vigorous activity allowed");
  if (a.maxSessionMin !== b.maxSessionMin) out.push(b.maxSessionMin ? `sessions up to ${b.maxSessionMin} min` : "no session length limit");
  if ((a.note ?? "") !== (b.note ?? "") && (b.note ?? "").trim()) out.push("a note for you");
  if ((a.precautions ?? "") !== (b.precautions ?? "") && (b.precautions ?? "").trim()) out.push("precautions");
  const who = (b.name ?? "").trim() || "Your clinician";
  return out.length ? `${who} updated: ${out.join(", ")}.` : null;
}

export function ClinicianScreen({ onSaved, onLeave }: { onSaved: () => void; onLeave: () => void }) {
  const { state } = useStore();
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="clinician" role="region" aria-label="Clinician">
      <header className="clinician-head">
        <StethoscopeIcon className="i" />
        <div>
          <h1>Clinician</h1>
          <p className="xs">{agreed ? `Setting ${state.profile.name}'s exercise goals, shared by them during this visit` : "Locked until the patient agrees"}</p>
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
        <h2 id="consent-title">Get help from your clinician?</h2>
        <p id="consent-body">
          Do you want your clinician to help you set your exercise goals? If so, please hand your phone to them now, and they will
          have access to your records.
        </p>
        <p className="xs muted">They'll see your weekly MET-hours, activity mix, skipped workouts and any pain reports.</p>
        <div className="consent-actions">
          <button ref={yes} className="btn btn-primary btn-block" onClick={onYes}>Yes, I'm handing it over</button>
          <button className="btn btn-quiet btn-block" onClick={onNo}>Not now</button>
        </div>
      </div>
    </>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cl-row">
      <label className="cl-label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="xs muted">{hint}</p>}
    </div>
  );
}

/** After the user agrees: the template and records, with Save and Cancel pinned at the bottom. */
function Session({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { state, dispatch } = useStore();
  const c = state.clinician;
  const [view, setView] = useState<"template" | "records">("template");
  const [d, setD] = useState<Draft>(() => ({
    goal: c.goal, noVigorous: c.noVigorous, maxSessionMin: c.maxSessionMin, note: c.note ?? "",
    name: c.name ?? "", role: c.role ?? "", reason: c.reason ?? "", review: c.review ?? "", precautions: c.precautions ?? "",
  }));
  const save = () => {
    const msg = summarizeChanges(c, d, state.goal);
    dispatch({ type: "clinician", patch: { ...d, updated: new Date().toISOString() } });
    if (msg) dispatch({ type: "toast", text: msg });
    onSaved();
  };

  return (
    <>
      <div className="clinician-body">
        <div className="seg-toggle" style={{ marginTop: 12 }} role="group" aria-label="Section">
          <button aria-pressed={view === "template"} onClick={() => setView("template")}>Goal template</button>
          <button aria-pressed={view === "records"} onClick={() => setView("records")}>Records</button>
        </div>
        {view === "template" ? <GoalTemplate d={d} set={(patch) => setD((x) => ({ ...x, ...patch }))} /> : <Records />}
      </div>
      <footer className="clinician-foot">
        <div className="btn-row">
          <button className="btn btn-quiet" style={{ flex: "0 0 auto" }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save and hand back</button>
        </div>
      </footer>
    </>
  );
}

/** The goal template: dropdowns for structured fields, free text for the rest. */
function GoalTemplate({ d, set }: { d: Draft; set: (patch: Partial<Draft>) => void }) {
  const { state } = useStore();
  const [custom, setCustom] = useState(() => d.goal !== null && !GOALS.some(([g]) => g === d.goal));

  const goalChoice = d.goal === null ? "app" : custom ? "custom" : String(d.goal);
  const goal = d.goal ?? state.goal;
  const moderateMin = Math.round((goal / 3) * 60);
  const vigorousMin = Math.round((goal / 6) * 60);

  return (
    <>
      <section>
        <h2>Clinician</h2>
        <div className="cl-grid">
          <Field label="Name" id="cl-name">
            <input id="cl-name" className="cl-input" placeholder="e.g. Dr. Rivera" autoComplete="off" value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Role" id="cl-role">
            <select id="cl-role" className="cl-select" value={d.role} onChange={(e) => set({ role: e.target.value })}>
              <option value="">Choose…</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section>
        <h2>Weekly MET goal</h2>
        <Field label="Reason for this goal" id="cl-reason">
          <select id="cl-reason" className="cl-select" value={d.reason} onChange={(e) => set({ reason: e.target.value })}>
            <option value="">Choose…</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="MET-hours per week" id="cl-goal">
          <select
            id="cl-goal"
            className="cl-select"
            value={goalChoice}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "app") { setCustom(false); set({ goal: null }); }
              else if (v === "custom") { setCustom(true); set({ goal }); }
              else { setCustom(false); set({ goal: parseFloat(v) }); }
            }}
          >
            <option value="app">Keep the app's goal ({fmtGoal(state.goal)})</option>
            {GOALS.map(([g, label]) => <option key={g} value={String(g)}>{label}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </Field>
        {custom && (
          <Field label="Custom goal (1 to 30)" id="cl-custom">
            <input
              id="cl-custom" className="cl-input" type="number" inputMode="decimal" min={1} max={30} step={0.25}
              value={d.goal ?? ""}
              onChange={(e) => { const v = parseFloat(e.target.value); set({ goal: Number.isNaN(v) ? goal : Math.min(30, Math.max(1, v)) }); }}
            />
          </Field>
        )}
        <p className="cl-summary">
          <b className="num">{fmtGoal(goal)}</b> MET-hours ≈ <b>{moderateMin} min</b> moderate (3 MET)
          {!d.noVigorous && <> or <b>{vigorousMin} min</b> vigorous (6 MET)</>} a week. The guideline is 7.5.
        </p>
        <Field label="Intensity allowed" id="cl-intensity" hint="Moderate only removes every suggestion at 6 MET or more.">
          <select id="cl-intensity" className="cl-select" value={d.noVigorous ? "moderate" : "all"} onChange={(e) => set({ noVigorous: e.target.value === "moderate" })}>
            <option value="all">Moderate and vigorous</option>
            <option value="moderate">Moderate only (under 6 MET)</option>
          </select>
        </Field>
        <Field label="Longest single session" id="cl-session">
          <select id="cl-session" className="cl-select" value={d.maxSessionMin === null ? "none" : String(d.maxSessionMin)} onChange={(e) => set({ maxSessionMin: e.target.value === "none" ? null : parseInt(e.target.value, 10) })}>
            {SESSION_CAPS.map(([label, v]) => <option key={label} value={v === null ? "none" : String(v)}>{label}</option>)}
          </select>
        </Field>
        <Field label="Review this goal" id="cl-review">
          <select id="cl-review" className="cl-select" value={d.review} onChange={(e) => set({ review: e.target.value })}>
            <option value="">Choose…</option>
            {REVIEW.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </section>

      <section>
        <h2>Notes</h2>
        <Field label={`Note for ${state.profile.name}`} id="cl-note">
          <textarea id="cl-note" className="cl-input" rows={3} placeholder="e.g. Great progress. Try adding two strength days." value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <Field label="Precautions" id="cl-prec">
          <textarea id="cl-prec" className="cl-input" rows={2} placeholder="e.g. Stop and call if you feel chest pain or dizziness." value={d.precautions} onChange={(e) => set({ precautions: e.target.value })} />
        </Field>
        <p className="xs muted">{state.profile.name} sees the note and precautions on their Today screen.</p>
      </section>

    </>
  );
}

/** Read-only records the clinician can review: weekly totals, activity mix, skip reasons, flags. */
function Records() {
  const { state, ctx } = useStore();
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

  return (
    <>
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
        {mixRows.length === 0 ? <p className="small muted">No workouts recorded yet.</p> : (
          <ul className="counts">
            {mixRows.map(([id, min]) => (
              <li key={id}>
                <span className="small">{getFamily(id).name}</span>
                <span className="small num">{min} min</span>
                <div className="bar"><span style={{ width: `${(min / mixMax) * 100}%`, background: getFamily(id).color }} /></div>
              </li>
            ))}
          </ul>
        )}
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
          <li className={state.profile.hasHealthCondition ? "warn" : ""}>{state.profile.hasHealthCondition ? "Reports a health condition" : "No health condition reported"}</li>
          <li className={state.painReports ? "warn" : ""}>{state.painReports ? `${state.painReports} "something hurts" report${state.painReports > 1 ? "s" : ""}` : "No pain reports"}</li>
          <li className={longestGap >= 3 ? "warn" : ""}>Longest gap without activity: {longestGap} {longestGap === 1 ? "day" : "days"}</li>
          <li>{WEEKLY_UPPER_LIMIT === null ? "Weekly upper limit not set yet (open clinical question)" : `Weeks over ${WEEKLY_UPPER_LIMIT} MET-hours flagged`}</li>
        </ul>
      </section>
    </>
  );
}
