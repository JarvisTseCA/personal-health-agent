import { useState } from "react";
import { GoalStrip } from "../components/GoalStrip";
import { WatchIcon } from "../components/Icons";
import { ACTIVITIES, searchFamilies } from "../lib/activities";
import { formatDuration, withCredit } from "../lib/guideline";
import { DEFAULT_PROFILE, useStore } from "../state/store";
import type { UserProfile } from "../state/types";

const STEPS = 5;

const SAMPLE = [
  withCredit({ id: "a", variantId: "cycling-commute", durationMin: 25, dayIndex: 0, source: "fitbit" }),
  withCredit({ id: "b", variantId: "dancing-salsa", durationMin: 40, dayIndex: 2, source: "fitbit" }),
  withCredit({ id: "c", variantId: "walking-brisk", durationMin: 30, dayIndex: 4, source: "fitbit" }),
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<UserProfile>({ ...DEFAULT_PROFILE, ...state.profile });
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);

  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const finish = () => {
    dispatch({ type: "completeOnboarding", profile: { ...draft, hasHealthCondition: !!health } });
    onDone();
  };

  const toggle = (id: string) =>
    setDraft((d) => ({
      ...d,
      enjoyedFamilyIds: d.enjoyedFamilyIds.includes(id) ? d.enjoyedFamilyIds.filter((x) => x !== id) : [...d.enjoyedFamilyIds, id],
    }));

  const connect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setDraft((d) => ({ ...d, fitbitConnected: true }));
    }, 900);
  };

  const results = query ? searchFamilies(query) : ACTIVITIES;

  return (
    <div className="onb">
      {step > 0 && (
        <div className="onb-progress" aria-label={`Step ${step} of ${STEPS - 1}`}>
          {Array.from({ length: STEPS - 1 }, (_, i) => (
            <span key={i} className={i < step ? "on" : ""} />
          ))}
        </div>
      )}

      {step === 0 && (
        <>
          <div className="grow">
            <div className="welcome-art">
              <GoalStrip done={SAMPLE} showScale={false} />
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Make your workouts count</h1>
            <p className="lead" style={{ marginTop: 14 }}>
              Tell me what you enjoy and how much time you have. I'll turn it into a week that meets the
              physical activity guideline: 150 minutes of moderate activity, or 75 vigorous.
            </p>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={next}>Get started</button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="grow">
            <h1>How much free time do you have this week?</h1>
            <p className="lead">A rough guess is fine. Short blocks of 15 or 20 minutes count.</p>
            <div className="time-display" aria-live="polite">{formatDuration(draft.weeklyTimeMin)}</div>
            <p className="muted small" style={{ marginBottom: 20 }}>this week</p>
            <label className="sr-only" htmlFor="time">Free time this week in minutes</label>
            <input
              id="time" type="range" min={30} max={300} step={15} value={draft.weeklyTimeMin}
              onChange={(e) => setDraft({ ...draft, weeklyTimeMin: Number(e.target.value) })}
            />
            <div className="range-scale"><span>30 min</span><span>5 hr</span></div>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={next}>Continue</button>
            <button className="btn btn-ghost" onClick={back}>Back</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="grow">
            <h1>What do you enjoy doing?</h1>
            <p className="lead">Pick two or three. I'll only suggest these, and your first pick is your favorite.</p>
            <label className="sr-only" htmlFor="q">Search activities</label>
            <input id="q" className="search" placeholder="Search, e.g. salsa or bike" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="chips">
              {results.map((f) => {
                const order = draft.enjoyedFamilyIds.indexOf(f.id);
                return (
                  <button key={f.id} className="chip" aria-pressed={order >= 0} onClick={() => toggle(f.id)}>
                    {order >= 0 ? <span className="order">{order + 1}</span> : <span className="dot" style={{ background: f.color }} />}
                    {f.name}
                  </button>
                );
              })}
              {results.length === 0 && <p className="muted small">No match yet. Try a broader word like "dance" or "walk".</p>}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={next} disabled={draft.enjoyedFamilyIds.length === 0}>
              {draft.enjoyedFamilyIds.length === 0 ? "Pick at least one" : "Continue"}
            </button>
            <button className="btn btn-ghost" onClick={back}>Back</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="grow">
            <h1>Any health condition that affects exercise?</h1>
            <p className="lead">
              For example heart disease, high blood pressure, diabetes, or pregnancy. If so, I'll keep to moderate
              activity and suggest checking with a clinician before going vigorous.
            </p>
            <div className="choice">
              <button aria-pressed={health === false} onClick={() => setHealth(false)}>
                <b>No</b><span>Plan with moderate and vigorous activity</span>
              </button>
              <button aria-pressed={health === true} onClick={() => setHealth(true)}>
                <b>Yes, or I'm not sure</b><span>Plan with moderate activity only for now</span>
              </button>
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={next} disabled={health === null}>Continue</button>
            <button className="btn btn-ghost" onClick={back}>Back</button>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <div className="grow">
            <h1>Connect your Fitbit</h1>
            <p className="lead">I'll read your workouts to see how much each one counts. In this demo the data is simulated.</p>
            <div className="device">
              <div className="device-icon"><WatchIcon /></div>
              <div style={{ flex: 1 }}>
                <b>Fitbit</b>
                <p className="small muted">{draft.fitbitConnected
                    ? `Connected. ${state.sessions.length} ${state.sessions.length === 1 ? "workout" : "workouts"} found this week.`
                    : "Not connected"}</p>
              </div>
              {!draft.fitbitConnected && (
                <button className="btn btn-quiet" onClick={connect} disabled={connecting} style={{ minHeight: 40 }}>
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={finish}>{draft.fitbitConnected ? "See my week" : "Skip for now"}</button>
            <button className="btn btn-ghost" onClick={back}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}
