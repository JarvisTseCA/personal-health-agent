import { Sheet } from "../components/Sheet";
import { getFamily } from "../lib/activities";
import { DECLINE_LABEL } from "../lib/suggest";
import { EQUIPMENT, equipmentName, isCustom, parseEquipmentWithCustom, type EquipmentPlace } from "../lib/equipment";
import { OtherInput } from "../components/OtherInput";
import { useStore } from "../state/store";
import { isHidden } from "../state/screens";
import { TYPICAL_GYM } from "../services/context";

function when(daysAgo: number): string {
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo} days ago`;
}

export function PreferencesSheet({ onClose, openSummary, openSettings }: { onClose: () => void; openSummary: () => void; openSettings: () => void }) {
  const { state, dispatch } = useStore();
  const p = state.profile;
  const patch = (x: Partial<typeof p>) => dispatch({ type: "updateProfile", patch: x });

  return (
    <Sheet title="Preferences" onClose={onClose}>
      <h2>Preferences</h2>
      <p className="muted small">Equipment, health and Fitbit. What you like and your weekly plan are on the Settings tab.</p>
      <div className="field">
        <button className="btn btn-quiet small-btn" onClick={openSettings}>Open Settings</button>
      </div>

      <Equipment />

      {state.clinician.entries.length > 0 && (
        <div className="field">
          <label className="lbl">From your clinician</label>
          <ul className="memory-list">
            {state.clinician.entries.map((n) => (
              <li key={n.id}>
                <div>
                  <b className="small">"{n.text}"</b>
                  <p className="xs muted">Told to the agent in Chat, {new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                </div>
                <button className="btn btn-ghost small-btn" onClick={() => dispatch({ type: "forgetClinicianNote", id: n.id })}>Forget</button>
              </li>
            ))}
          </ul>
          <p className="xs muted" style={{ marginTop: 6 }}>The agent uses these when it suggests workouts. They don't change your goal: you decide that.</p>
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
        {!isHidden("summary") && <div className="switch-row">
          <div>
            <b className="small">Summary for your clinician</b>
            <p className="xs muted">Show it at a visit, then tell the agent in Chat what they said</p>
          </div>
          <button className="btn btn-quiet small-btn" onClick={openSummary}>Open</button>
        </div>}
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
  // Not asked in onboarding. Until the user sets it, home starts empty and the gym starts as a typical one.
  // There's no "no gym" setting: Gym is always a check-in option.
  const eq = state.profile.equipment ?? { home: [], gym: [...TYPICAL_GYM] };
  const set = (place: EquipmentPlace, ids: string[]) => dispatch({ type: "setEquipment", equipment: { ...eq, [place]: ids } });
  // A gym with nothing listed (older saves) shows, and starts from, a typical gym.
  const gym = eq.gym ?? TYPICAL_GYM;
  const toggle = (place: EquipmentPlace, id: string) => {
    const cur = place === "home" ? eq.home : gym;
    set(place, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  /** Typed equipment: known items are selected, anything else is added as the user's own tag. */
  const typed = (place: EquipmentPlace, text: string) => {
    const cur = place === "home" ? eq.home : gym;
    const found = parseEquipmentWithCustom(text);
    if (found.length) set(place, [...cur, ...found.filter((id) => !cur.includes(id))]);
  };
  const chips = (place: EquipmentPlace, cur: string[]) => (
    <>
      <div className="chips">
        {[...EQUIPMENT.map((e) => e.id), ...cur.filter(isCustom)].map((id) => (
          <button key={id} className={`chip${isCustom(id) ? " chip-custom" : ""}`} aria-pressed={cur.includes(id)} onClick={() => toggle(place, id)}>{equipmentName(id)}</button>
        ))}
      </div>
      <OtherInput placeholder="Add other equipment, e.g. foam roller" label={`Add equipment ${place === "home" ? "indoors, private" : "indoors, with others"}`} onSubmit={(t) => typed(place, t)} />
    </>
  );
  return (
    <div className="field">
      <label className="lbl">Equipment</label>
      <p className="xs muted" style={{ marginBottom: 8 }}>Workouts are built from what's where you exercise that day.</p>
      <p className="small" style={{ fontWeight: 700, margin: "8px 0 6px" }}>Indoors, private <span className="muted" style={{ fontWeight: 400 }}>(home, hotel room)</span></p>
      {chips("home", eq.home)}
      <p className="small" style={{ fontWeight: 700, margin: "14px 0 6px" }}>Indoors, with others <span className="muted" style={{ fontWeight: 400 }}>(gym, office)</span></p>
      {chips("gym", gym)}
    </div>
  );
}
