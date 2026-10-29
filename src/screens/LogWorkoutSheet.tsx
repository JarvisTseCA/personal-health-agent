import { useState } from "react";
import { Sheet } from "../components/Sheet";
import { getFamily, PICKABLE } from "../lib/activities";
import { creditFor, DAY_NAMES, fmt, intensityOf } from "../lib/met";
import { newId, useStore } from "../state/store";

export function LogWorkoutSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const enjoyed = state.profile.enjoyed;
  const ordered = [...enjoyed.map(getFamily), ...PICKABLE.filter((f) => !enjoyed.includes(f.id))];
  const [familyId, setFamilyId] = useState(ordered[0]?.id ?? "cycling");
  const family = getFamily(familyId);
  const [variantId, setVariantId] = useState(family.variants[0].id);
  const variant = family.variants.find((v) => v.id === variantId) ?? family.variants[0];
  const [duration, setDuration] = useState(30);
  const [day, setDay] = useState(state.todayIndex);

  const credit = creditFor(variant.met, duration);
  const intensity = intensityOf(variant.met);

  const pickFamily = (id: string) => {
    setFamilyId(id);
    setVariantId(getFamily(id).variants[0].id);
  };

  const save = () => {
    dispatch({ type: "addSessionManual", session: { id: newId("m"), variantId: variant.id, durationMin: duration, dayIndex: day, source: "manual", confirmed: true } });
    onClose();
  };

  return (
    <Sheet title="Log a workout" onClose={onClose}>
      <h2>Log a workout</h2>
      <p className="muted small">For anything your Fitbit missed.</p>

      <div className="field">
        <label className="lbl">Activity</label>
        <div className="chips">
          {ordered.map((f) => (
            <button key={f.id} className="chip" aria-pressed={f.id === familyId} onClick={() => pickFamily(f.id)}>
              <span className="dot" style={{ background: f.color }} />{f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="lbl">How hard</label>
        <div className="variant-list">
          {family.variants.map((v) => (
            <button key={v.id} aria-pressed={v.id === variant.id} onClick={() => setVariantId(v.id)}>
              <span>{v.label}</span>
              <span className="muted xs">{v.met} MET, {intensityOf(v.met)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label className="lbl" style={{ margin: 0 }}>Duration</label>
        <div className="stepper">
          <button aria-label="5 minutes less" onClick={() => setDuration((d) => Math.max(5, d - 5))}>−</button>
          <span className="num" style={{ minWidth: 64, textAlign: "center", fontWeight: 700 }}>{duration} min</span>
          <button aria-label="5 minutes more" onClick={() => setDuration((d) => Math.min(180, d + 5))}>+</button>
        </div>
      </div>

      <div className="field">
        <label className="lbl">Day</label>
        <div className="chips">
          {DAY_NAMES.slice(0, state.todayIndex + 1).map((d, i) => (
            <button key={d} className="chip" aria-pressed={i === day} onClick={() => setDay(i)}>{i === state.todayIndex ? "Today" : d}</button>
          ))}
        </div>
      </div>

      <p className="field small" aria-live="polite">
        {intensity === "light"
          ? `${variant.label} is light activity (under 3 MET). It doesn't count toward the goal for now, but it all helps.`
          : `${variant.met} × ${duration} min ÷ 60 = ${fmt(credit)} MET-hours.`}
      </p>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Add workout</button>
      </div>
    </Sheet>
  );
}
