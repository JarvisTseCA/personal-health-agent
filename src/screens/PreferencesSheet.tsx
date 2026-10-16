import { Sheet } from "../components/Sheet";
import { ArrowIcon, CloseIcon } from "../components/Icons";
import { getFamily, PICKABLE } from "../lib/activities";
import { DECLINE_LABEL, type Access } from "../lib/suggest";
import { useStore } from "../state/store";

const ACCESS: Array<[Access, string]> = [["have", "Have it"], ["sometimes", "Sometimes"], ["no", "Not right now"]];

function when(daysAgo: number): string {
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo} days ago`;
}

export function PreferencesSheet({ onClose, openClinician }: { onClose: () => void; openClinician: () => void }) {
  const { state, dispatch } = useStore();
  const p = state.profile;
  const others = PICKABLE.filter((f) => !p.enjoyed.includes(f.id));
  const patch = (x: Partial<typeof p>) => dispatch({ type: "updateProfile", patch: x });

  return (
    <Sheet title="Preferences" onClose={onClose}>
      <h2>Preferences</h2>
      <p className="muted small">The coach only suggests what's on this list, favorite first.</p>

      <div className="field">
        <label className="lbl">Activities you enjoy</label>
        <ol className="rank-list">
          {p.enjoyed.map((id, i) => {
            const f = getFamily(id);
            return (
              <li key={id}>
                <div className="rank-top">
                  <span className="rank-n num">{i + 1}</span>
                  <span className="dot" style={{ background: f.color }} />
                  <b>{f.name}</b>
                  <div className="rank-actions">
                    <button className="mini" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => dispatch({ type: "moveEnjoyed", familyId: id, dir: -1 })}><ArrowIcon /></button>
                    <button className="mini" aria-label={`Move ${f.name} down`} disabled={i === p.enjoyed.length - 1} onClick={() => dispatch({ type: "moveEnjoyed", familyId: id, dir: 1 })}><ArrowIcon dir="down" /></button>
                    <button className="mini" aria-label={`Remove ${f.name}`} onClick={() => dispatch({ type: "toggleEnjoyed", familyId: id })}><CloseIcon /></button>
                  </div>
                </div>
                <div className="access-row" role="radiogroup" aria-label={`Access to ${f.name}`}>
                  {f.needs && <span className="xs muted">Needs {f.needs}:</span>}
                  {ACCESS.map(([a, label]) => (
                    <button key={a} role="radio" aria-checked={(p.access[id] ?? "have") === a} className="slot" onClick={() => dispatch({ type: "setAccess", familyId: id, access: a })}>{label}</button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
        {others.length > 0 && (
          <>
            <p className="xs muted" style={{ margin: "12px 0 8px" }}>Add more</p>
            <div className="chips">
              {others.map((f) => (
                <button key={f.id} className="chip" onClick={() => dispatch({ type: "toggleEnjoyed", familyId: f.id })}>
                  <span className="dot" style={{ background: f.color }} />{f.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="field">
        <label className="lbl">What the coach remembers</label>
        {state.declines.length === 0 ? (
          <p className="small muted">Nothing yet. When you say "not today", the reason shows up here.</p>
        ) : (
          <ul className="memory-list">
            {[...state.declines].reverse().map((d) => (
              <li key={d.id}>
                <div>
                  <b className="small">{getFamily(d.familyId).name}: {DECLINE_LABEL[d.reason].toLowerCase()}</b>
                  <p className="xs muted">{when(state.todayIndex - d.day)}{d.note ? `, "${d.note}"` : ""}</p>
                </div>
                <button className="btn btn-ghost small-btn" onClick={() => dispatch({ type: "forgetDecline", id: d.id })}>Forget</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="field">
        <div className="switch-row">
          <div>
            <b className="small">Health condition</b>
            <p className="xs muted">No vigorous suggestions; check with a clinician first</p>
          </div>
          <button className="switch" role="switch" aria-checked={p.hasHealthCondition} aria-label="Health condition" onClick={() => patch({ hasHealthCondition: !p.hasHealthCondition })} />
        </div>
        <div className="switch-row">
          <div>
            <b className="small">Fitbit</b>
            <p className="xs muted">{p.fitbitConnected ? "Connected (simulated)" : "Not connected"}</p>
          </div>
          <button className="switch" role="switch" aria-checked={p.fitbitConnected} aria-label="Fitbit connected" onClick={() => patch({ fitbitConnected: !p.fitbitConnected })} />
        </div>
        <div className="switch-row">
          <div>
            <b className="small">Clinician view</b>
            <p className="xs muted">Open it at a visit and hand your phone to your clinician</p>
          </div>
          <button className="switch" role="switch" aria-checked={p.clinicianViewEnabled} aria-label="Clinician view" onClick={() => patch({ clinicianViewEnabled: !p.clinicianViewEnabled })} />
        </div>
        {p.clinicianViewEnabled && (
          <button className="btn btn-quiet btn-block" style={{ marginTop: 8 }} onClick={openClinician}>Open clinician view</button>
        )}
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn btn-quiet" onClick={() => { dispatch({ type: "reset" }); onClose(); }}>Start over</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
