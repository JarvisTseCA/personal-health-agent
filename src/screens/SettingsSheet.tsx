import { Sheet } from "../components/Sheet";
import { ACTIVITIES } from "../lib/activities";
import { formatDuration } from "../lib/guideline";
import { useStore } from "../state/store";

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const p = state.profile;
  const patch = (x: Partial<typeof p>) => dispatch({ type: "updateProfile", patch: x });

  const toggle = (id: string) =>
    patch({
      enjoyedFamilyIds: p.enjoyedFamilyIds.includes(id) ? p.enjoyedFamilyIds.filter((x) => x !== id) : [...p.enjoyedFamilyIds, id],
    });

  return (
    <Sheet title="Your week" onClose={onClose}>
      <h2>Your week</h2>
      <p className="muted small">Changes update your progress and plan right away.</p>

      <div className="field" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="lbl" style={{ margin: 0 }}>Free time this week</label>
        <div className="stepper">
          <button aria-label="15 minutes less" onClick={() => patch({ weeklyTimeMin: Math.max(15, p.weeklyTimeMin - 15) })}>−</button>
          <span className="num" style={{ minWidth: 84, textAlign: "center", fontWeight: 700 }}>{formatDuration(p.weeklyTimeMin)}</span>
          <button aria-label="15 minutes more" onClick={() => patch({ weeklyTimeMin: Math.min(600, p.weeklyTimeMin + 15) })}>+</button>
        </div>
      </div>

      <div className="field">
        <label className="lbl">Activities you enjoy</label>
        <div className="chips">
          {ACTIVITIES.map((f) => {
            const order = p.enjoyedFamilyIds.indexOf(f.id);
            return (
              <button key={f.id} className="chip" aria-pressed={order >= 0} onClick={() => toggle(f.id)}>
                {order >= 0 ? <span className="order">{order + 1}</span> : <span className="dot" style={{ background: f.color }} />}
                {f.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <div className="switch-row">
          <div>
            <b className="small">Health condition</b>
            <p className="xs muted">Keeps plans to moderate activity</p>
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
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn btn-quiet" onClick={() => { dispatch({ type: "reset" }); onClose(); }}>Start over</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
