import { GoalStrip } from "../components/GoalStrip";
import { getVariant } from "../lib/activities";
import { DAY_NAMES, formatDuration } from "../lib/guideline";
import { explainOption } from "../services/mockResponses";
import { useStore } from "../state/store";
import type { Screen } from "../state/types";

export function PlanScreen({ go }: { go: (s: Screen) => void }) {
  const { state, dispatch, ctx } = useStore();
  const { week, options } = ctx;
  const p = state.profile;
  const selected = state.chosenPlan;

  const setTime = (delta: number) =>
    dispatch({ type: "updateProfile", patch: { weeklyTimeMin: Math.max(15, Math.min(600, p.weeklyTimeMin + delta)) } });

  if (week.remainingMinutes === 0) {
    return (
      <>
        <div className="screen-head"><div><h1>You're done</h1><p className="sub">{week.doneMinutes} of 150 guideline minutes this week</p></div></div>
        <GoalStrip done={week.sessions} />
        <p style={{ marginTop: 20 }}>Nothing left to plan. Keep moving for fun if you like, or enjoy the rest days.</p>
        <button className="btn btn-quiet btn-block" style={{ marginTop: 20 }} onClick={() => go("week")}>Back to my week</button>
      </>
    );
  }

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Ways to close the gap</h1>
          <p className="sub">{week.remainingMinutes} min left to earn, using only {ctx.enjoyedNames.join(", ") || "activities you pick"}</p>
        </div>
      </div>

      <div className="time-left">
        <div>
          <div className="v">{formatDuration(ctx.timeLeftMinutes)}</div>
          <div className="xs muted">free time left this week</div>
        </div>
        <div className="stepper" aria-label="Adjust free time">
          <button aria-label="15 minutes less" onClick={() => setTime(-15)}>−</button>
          <button aria-label="15 minutes more" onClick={() => setTime(15)}>+</button>
        </div>
      </div>

      {p.hasHealthCondition && (
        <p className="note" style={{ marginTop: 12 }}>
          You mentioned a health condition, so these plans stick to moderate activity. Check with your clinician before adding vigorous workouts.
        </p>
      )}

      {options.length === 0 ? (
        <div className="section">
          <p>Pick at least one activity you enjoy and I'll build options around it.</p>
          <button className="btn btn-quiet btn-block" style={{ marginTop: 12 }} onClick={() => go("week")}>Open settings on This week</button>
        </div>
      ) : (
        <div className="options section" role="radiogroup" aria-label="Plan options">
          {options.map((o) => {
            const checked = selected === o.kind;
            return (
              <div
                key={o.kind}
                className="option"
                role="radio"
                aria-checked={checked}
                tabIndex={0}
                onClick={() => dispatch({ type: "choosePlan", kind: checked ? null : o.kind })}
                onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), dispatch({ type: "choosePlan", kind: checked ? null : o.kind }))}
              >
                <div className="option-head">
                  <h3>{o.title}</h3>
                  <span className="time">{formatDuration(o.clockMinutes)}</span>
                </div>
                <div className="badges">
                  <span className={`tag ${o.fits ? "badge-fit" : "badge-nofit"}`}>{o.fits ? "Fits your time" : "Over your time"}</span>
                  {o.leastTime && <span className="tag">Least time</span>}
                  {o.hasVigorous && <span className="tag x2">Vigorous ×2</span>}
                </div>
                <GoalStrip done={week.sessions} planned={o.sessions} compact showScale={false} />
                <p className="small muted" style={{ marginTop: 10 }}>{explainOption(o, ctx)}</p>
                <ul className="sessions">
                  {o.sessions.map((s, i) => {
                    const { family, variant } = getVariant(s.variantId);
                    return (
                      <li key={i}>
                        <span className="d">{s.dayIndex === state.todayIndex ? "Today" : DAY_NAMES[s.dayIndex]}</span>
                        <span className="dot" style={{ background: family.color }} />
                        <span style={{ flex: 1 }}>{s.durationMin} min {family.noun}, {variant.label.toLowerCase()}</span>
                        <span className="num" style={{ fontWeight: 700 }}>+{s.credit}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {options.length > 0 && (
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 20 }}
          disabled={!selected}
          onClick={() => go("week")}
        >
          {selected ? "Use this plan" : "Pick a plan"}
        </button>
      )}
      <p className="xs muted" style={{ marginTop: 14 }}>
        Minutes are converted with MET values from the 2024 Adult Compendium of Physical Activities. Vigorous (6+ MET) minutes count double.
      </p>
    </>
  );
}
