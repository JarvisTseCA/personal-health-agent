import { useState } from "react";
import { GoalStrip } from "../components/GoalStrip";
import { PlusIcon } from "../components/Icons";
import { MedalCoin } from "../components/Medal";
import { getVariant } from "../lib/activities";
import { DAY_NAMES_LONG, fmt, fmtGoal } from "../lib/met";
import { SLOT_HINT, SLOT_LABEL, SLOTS } from "../lib/plan";
import { useStore } from "../state/store";
import { LogWorkoutSheet } from "./LogWorkoutSheet";

export function WeekScreen() {
  const { state, ctx, dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [log, setLog] = useState(false);
  const t = state.todayIndex;

  const goalNote =
    ctx.goalBy === "clinician" ? "Set by your clinician"
    : ctx.steppingStone ? "A stepping stone back to the 7.5 guideline"
    : ctx.goal > 7.5 ? "Raised after strong weeks"
    : "The activity guideline: 150 min moderate or 75 vigorous";

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>This week</h1>
          <p className="sub">{goalNote}</p>
        </div>
        <button className="btn btn-quiet small-btn" onClick={() => dispatch({ type: "overlay", overlay: "recap" })}>Weekly recap</button>
      </div>

      <div className="hero-number">
        <span className="big num">{fmt(ctx.week.done)}</span>
        <span className="of">of {fmtGoal(ctx.goal)} MET-hours</span>
      </div>
      <GoalStrip done={ctx.week.sessions} goal={ctx.goal} />

      {ctx.unplanned > 0.05 && (
        <p className="note" style={{ marginTop: 16 }}>
          {fmt(ctx.unplanned)} MET-hours have no day left to go on. Add a day back to fit them in; the weekly goal stays the same.
        </p>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Day by day</h2>
          <button className={`btn small-btn ${editing ? "btn-primary" : "btn-quiet"}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Change my week"}
          </button>
        </div>
        {editing && (
          <p className="small muted plan-help">
            Mark days you can't exercise as Off. What's left of the goal is split over the other days by their time, so changing a day re-plans the rest.
          </p>
        )}
        <ul className="days">
          {state.plan.map((slot, i) => {
            const here = ctx.week.sessions.filter((s) => s.dayIndex === i);
            const past = i < t;
            const cls = i === t ? "today" : past ? "past" : "";
            return (
              <li key={i} className={`day ${cls}`}>
                <div className="day-coin">
                  <MedalCoin medal={ctx.medals[i]} size={30} pending={i === t && ctx.medals[i] === "none"} future={i > t} off={slot === "off"} />
                </div>
                <div className="day-body">
                  <div className="day-top">
                    <span className="day-name">{i === t ? "Today" : DAY_NAMES_LONG[i]}</span>
                    {!editing && (
                      <span className="day-target small">
                        {slot === "off" ? <span className="muted">Off</span> : <><span className="num">{fmt(ctx.week.doneByDay[i])}</span><span className="muted"> of {fmt(ctx.targets[i])}</span></>}
                      </span>
                    )}
                  </div>
                  {editing && !past ? (
                    <div className="slot-row" role="radiogroup" aria-label={`${DAY_NAMES_LONG[i]} time`}>
                      {SLOTS.map((s) => (
                        <button key={s} role="radio" aria-checked={slot === s} className="slot" onClick={() => dispatch({ type: "setSlot", day: i, slot: s })} title={SLOT_HINT[s]}>
                          {SLOT_LABEL[s]}
                        </button>
                      ))}
                      <span className="xs muted slot-target">{slot === "off" ? "No target" : ctx.left <= 0 ? "Goal met" : `${fmt(ctx.targets[i])} MET-h`}</span>
                    </div>
                  ) : (
                    !editing && slot !== "off" && i >= t && here.length === 0 && <span className="xs muted">{SLOT_HINT[slot]}</span>
                  )}
                  {here.map((s) => {
                    const { family, variant } = getVariant(s.variantId);
                    return (
                      <div className="item" key={s.id}>
                        <span className="dot" style={{ background: family.color }} />
                        <div className="what">
                          <b>{family.name}</b> {s.durationMin} min
                          <div className="meta">
                            {s.confirmed ? `${variant.label}, ${variant.met} MET` : `Unconfirmed, counted at ${s.met} MET`}
                            {s.source === "fitbit" ? ", from Fitbit" : ", logged by you"}
                          </div>
                        </div>
                        <span className="credit">{s.credit > 0 ? `+${fmt(s.credit)}` : "light"}</span>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <button className="btn btn-quiet btn-block" style={{ marginTop: 8 }} onClick={() => setLog(true)}><PlusIcon />Log a workout Fitbit missed</button>
      <p className="xs muted" style={{ marginTop: 14 }}>
        MET-hours = MET value × minutes ÷ 60, with MET values from the 2024 Adult Compendium of Physical Activities. 7.5 MET-hours equals 150 minutes at 3 MET or 75 minutes at 6 MET.
      </p>
      {log && <LogWorkoutSheet onClose={() => setLog(false)} />}
    </>
  );
}
