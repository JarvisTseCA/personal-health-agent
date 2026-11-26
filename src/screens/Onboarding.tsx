/**
 * Onboarding, short: connect Fitbit, one health question, "Tell us what you love
 * doing". The weekly goal and plan come next, in the Today conversation (today.ts, "setup").
 *
 * "Tell us what you love doing" shows the activity table's categories: one tap
 * likes a category (👍), a second dislikes it (👎), a third clears it. It's
 * optional; the same chips are on the Settings tab. There's no observing week
 * and no equipment question: the coach also learns from feedback on suggestions
 * (accepting one adds it to their likes; "Not in the mood" or "Can't access it"
 * steer away from it).
 *
 * Every page after the welcome has Back, which returns to the page the user came from.
 */
import { useEffect, useState } from "react";
import { BackIcon, WatchIcon } from "../components/Icons";
import type { WeekPlan } from "../lib/plan";
import { CATEGORY_HELP, CategoryChips } from "../components/CategoryChips";
import { withPref, type CategoryPrefs } from "../lib/categories";
import { DEFAULT_PROFILE, pullFitbit, useStore } from "../state/store";
import { connectFitbit, fitbitStatus } from "../services/fitbit";

type Step = "welcome" | "fitbit" | "health" | "likes";
const ORDER: Step[] = ["fitbit", "health", "likes"];

/** Every day starts at 10 min; the user changes the days that differ in Today's first conversation. */
const START_PLAN: WeekPlan = ["10", "10", "10", "10", "10", "10", "10"];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("welcome");
  const [health, setHealth] = useState<null | "none" | "skip">(null);
  /** The large "anything we should know?" box */
  const [about, setAbout] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /** The backend can connect a real Fitbit (a Google OAuth client is set up); otherwise Connect is simulated */
  const [real, setReal] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  useEffect(() => { fitbitStatus().then((s) => setReal(!!s?.configured)); }, []);
  const [prefs, setPrefs] = useState<CategoryPrefs>({});

  /** Pages visited, so Back returns to the one the user came from */
  const [trail, setTrail] = useState<Step[]>([]);
  const go = (s: Step) => { setTrail((t) => [...t, step]); setStep(s); };
  const back = () => {
    const prev = trail.at(-1);
    if (!prev) return;
    setTrail(trail.slice(0, -1));
    setStep(prev);
  };
  const note = (text: string, where: string) => dispatch({ type: "addNote", text, where: `Onboarding: ${where}` });

  const idx = ORDER.indexOf(step);

  /** Google's sign-in opens in a new tab; once the backend has the tokens, the user's own weeks are imported. */
  const connectReal = () => {
    setConnecting(true);
    setConnectFailed(false);
    connectFitbit().then((ok) => {
      setConnecting(false);
      if (!ok) { setConnectFailed(true); return; }
      setConnected(true);
      dispatch({ type: "updateProfile", patch: { fitbitConnected: true, fitbitLive: true } });
      void pullFitbit(dispatch);
    });
  };

  /**
   * The health page. The box takes anything the coach should know and is kept
   * as a note. Text without "No health conditions" is treated as a condition:
   * moderate activity only, and check with a clinician before anything vigorous.
   */
  const healthFlag = health === "skip" || (health !== "none" && about.trim() !== "");
  const continueHealth = () => {
    if (about.trim()) note(about.trim(), "anything we should know");
    go("likes");
  };

  const finish = () => {
    dispatch({
      type: "completeOnboarding",
      profile: {
        ...DEFAULT_PROFILE, ...state.profile,
        // Nothing liked or ruled out yet: feedback on suggestions fills these in.
        enjoyed: [], access: {},
        // No equipment asked: suggestions aren't limited by equipment until the user sets it in Preferences.
        equipment: undefined,
        hasHealthCondition: healthFlag, fitbitConnected: connected,
        categoryPrefs: prefs,
      },
      plan: START_PLAN,
      setUpWeek: true,
    });
    onDone();
  };

  return (
    <div className="onb">
      {step !== "welcome" && (
        <div className="onb-top">
          <button className="onb-back" onClick={back} disabled={trail.length === 0}><BackIcon />Back</button>
          <div className="onb-progress" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
            {ORDER.map((s, i) => <span key={s} className={i <= idx ? "on" : ""} />)}
          </div>
        </div>
      )}

      {step === "welcome" && (
        <>
          <div className="grow">
            <div className="welcome-vo2" aria-hidden>
              <span className="welcome-vo2-k">VO2 max</span>
              <svg viewBox="0 0 220 64" width="220" height="64">
                <path d="M6 54 C 40 52, 60 46, 84 40 S 130 30, 152 22 S 196 10, 214 8" fill="none" stroke="var(--good)" strokeWidth="4" strokeLinecap="round" />
                <circle cx="214" cy="8" r="6" fill="var(--good)" />
              </svg>
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Raise your VO2 max. Skip the planning.</h1>
            <p className="lead" style={{ marginTop: 14 }}>
              VO2 max is the best single measure of cardio fitness. Each day I'll hand you one workout that fits your time
              and where you are, and count it toward the weekly guideline: the training that builds VO2 max. You just tap,
              and I learn what you like from what you pick.
            </p>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("fitbit")}>Get started</button>
          </div>
        </>
      )}

      {step === "fitbit" && (
        <>
          <div className="grow">
            <h1>Connect your Fitbit</h1>
            <p className="lead">I read your workouts to see how much each one counts.{real ? " You'll sign in with the Google account your Fitbit uses." : " In this demo the data is simulated."}</p>
            <div className="device">
              <div className="device-icon"><WatchIcon /></div>
              <div style={{ flex: 1 }}>
                <b>Fitbit</b>
                <p className="small muted">{connected ? "Connected" : "Not connected"}</p>
              </div>
              {!connected && (
                <button className="btn btn-quiet" style={{ minHeight: 40 }} disabled={connecting}
                  onClick={real ? connectReal : () => { setConnecting(true); setTimeout(() => { setConnecting(false); setConnected(true); }, 800); }}>
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>
          {connectFailed && <p className="small muted" role="status">Fitbit wasn't connected. Try again, and finish the sign-in in the tab that opens.</p>}
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("health")} disabled={!connected}>Continue</button>
          </div>
        </>
      )}

      {step === "health" && (
        <>
          <div className="grow">
            <h1>Anything we should know?</h1>
            <p className="lead">For example heart disease, high blood pressure, diabetes, pregnancy or an injury. If there's something, I'll skip vigorous suggestions and suggest checking with a clinician first.</p>
            <label className="sr-only" htmlFor="about">Anything we should know</label>
            <textarea
              id="about"
              className="about-box"
              rows={6}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Tell me anything that matters for your exercise: a condition, an injury, medication, or something you'd rather avoid."
            />
            {about.trim() && health !== "none" && (
              <p className="small muted" role="status" style={{ marginTop: 8 }}>Thanks. I'll keep to moderate activity for now and suggest checking with a clinician before anything vigorous.</p>
            )}
            <div className="choice" style={{ marginTop: 16 }}>
              <button aria-pressed={health === "none"} onClick={() => setHealth(health === "none" ? null : "none")}><b>No health conditions</b></button>
              <button aria-pressed={health === "skip"} onClick={() => setHealth(health === "skip" ? null : "skip")}><b>Prefer not to say</b><span>I'll play it safe with moderate activity</span></button>
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={continueHealth} disabled={!health && !about.trim()}>Continue</button>
          </div>
        </>
      )}

      {step === "likes" && (
        <>
          <div className="grow">
            <h1>Tell us what you love doing</h1>
            <p className="lead">I'll suggest more of what you like and skip what you don't. {CATEGORY_HELP} You can change these any time in Settings.</p>
            <CategoryChips prefs={prefs} onChange={(c, p) => setPrefs((cur) => withPref(cur, c, p))} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={finish}>{Object.keys(prefs).length ? "Continue" : "Skip for now"}</button>
          </div>
        </>
      )}

    </div>
  );
}
