import { Sheet } from "../components/Sheet";
import { ArrowIcon, CloseIcon } from "../components/Icons";
import { getFamily, PICKABLE } from "../lib/activities";
import { DECLINE_LABEL, type Access } from "../lib/suggest";
import { EQUIPMENT, type EquipmentPlace } from "../lib/equipment";
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
      <p className="muted small">The agent only suggests what's on this list, favorite first.</p>

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

      <Equipment />

      {state.clinician.note.trim() && (
        <div className="field">
          <label className="lbl">From your clinician</label>
          <div className="clin-note">
            <p className="xs muted" style={{ marginBottom: 4 }}>
              {[state.clinician.name, state.clinician.role].filter(Boolean).join(", ") || "Your clinician"}
              {state.clinician.updated ? `, ${new Date(state.clinician.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
            </p>
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>{state.clinician.note}</p>
          </div>
          <p className="xs muted" style={{ marginTop: 6 }}>The agent uses these notes as context. They don't change your goal: you decide that.</p>
          <button className="btn btn-ghost small-btn" style={{ marginTop: 4 }} onClick={() => dispatch({ type: "forgetClinicianNotes" })}>Remove these notes</button>
        </div>
      )}

      <div className="field">
        <label className="lbl">What the agent remembers</label>
        {state.declines.length + state.notes.length === 0 ? (
          <p className="small muted">Nothing yet. When you say "not today" or type your own answer, it shows up here.</p>
        ) : (
          <ul className="memory-list">
            {[...state.notes].reverse().map((n) => (
              <li key={n.id}>
                <div>
                  <b className="small">"{n.text}"</b>
                  <p className="xs muted">{n.where}, {when(state.todayIndex - n.day)}</p>
                </div>
                <button className="btn btn-ghost small-btn" onClick={() => dispatch({ type: "forgetNote", id: n.id })}>Forget</button>
              </li>
            ))}
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
            <b className="small">Clinician</b>
            <p className="xs muted">At a visit, hand your phone to your clinician to review your summary and leave notes</p>
          </div>
          <button className="btn btn-quiet small-btn" onClick={openClinician}>Open</button>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn btn-quiet" onClick={() => { dispatch({ type: "reset" }); onClose(); }}>Start over</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}

/** Equipment at home and at the gym: tap to add or remove. */
function Equipment() {
  const { state, dispatch } = useStore();
  const eq = state.profile.equipment ?? { home: [], gym: [] };
  const set = (place: EquipmentPlace, ids: string[] | null) => dispatch({ type: "setEquipment", equipment: { ...eq, [place]: ids } });
  const toggle = (place: EquipmentPlace, id: string) => {
    const cur = (place === "home" ? eq.home : eq.gym) ?? [];
    set(place, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="field">
      <label className="lbl">Equipment</label>
      <p className="xs muted" style={{ marginBottom: 8 }}>Workouts are built from what's where you exercise that day.</p>
      <p className="small" style={{ fontWeight: 700, margin: "8px 0 6px" }}>At home</p>
      <div className="chips">
        {EQUIPMENT.map((e) => <button key={e.id} className="chip" aria-pressed={eq.home.includes(e.id)} onClick={() => toggle("home", e.id)}>{e.name}</button>)}
      </div>
      <div className="switch-row" style={{ marginTop: 14 }}>
        <b className="small">At the gym</b>
        <button className="switch" role="switch" aria-checked={eq.gym !== null} aria-label="I use a gym" onClick={() => set("gym", eq.gym === null ? [] : null)} />
      </div>
      {eq.gym !== null ? (
        <div className="chips">
          {EQUIPMENT.map((e) => <button key={e.id} className="chip" aria-pressed={eq.gym!.includes(e.id)} onClick={() => toggle("gym", e.id)}>{e.name}</button>)}
        </div>
      ) : <p className="xs muted">No gym. Turn this on to add one.</p>}
    </div>
  );
}
