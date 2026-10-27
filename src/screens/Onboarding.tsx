/**
 * Onboarding, observe-first (workflow doc):
 *   Day 1: connect Fitbit, one health question.
 *   Days 1–7: observe a week; no suggestions yet, but medals already count.
 *   Day 8: confirm what the coach detected, then likes and the first weekly plan.
 * "Don't want to wait?" skips the observing week and asks the day-8 questions now.
 * Every page after the welcome has Back, which returns to the page the user came from.
 * Access and usual weekly time aren't asked: everything starts as available
 * ("Can't access it" on a pick fixes that later), and each day starts at 10 min.
 */
import { useMemo, useState } from "react";
import { BackIcon, WatchIcon } from "../components/Icons";
import { OtherInput } from "../components/OtherInput";
import { matchActivity, parsePlanChanges, parseYesNo } from "../lib/freeText";
import { MedalCoin } from "../components/Medal";
import { PERSONAS } from "../data/mockFitbit";
import { getFamily, getVariant, PICKABLE, searchFamilies } from "../lib/activities";
import { DAY_NAMES_LONG } from "../lib/met";
import { SLOT_LABEL, SLOT_MINUTES, type WeekPlan } from "../lib/plan";
import { TimeOptions } from "../components/TimeOptions";
import type { Access } from "../lib/suggest";
import { DEFAULT_PROFILE, useStore } from "../state/store";

type Step = "welcome" | "fitbit" | "health" | "path" | "observing" | "confirm" | "enjoy" | "plan";
const ORDER: Step[] = ["fitbit", "health", "path", "observing", "confirm", "enjoy", "plan"];

/** Every day starts at 10 min; the user changes the days that differ. */
const START_PLAN: WeekPlan = ["10", "10", "10", "10", "10", "10", "10"];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("welcome");
  const [observed, setObserved] = useState(false);
  const [health, setHealth] = useState<null | "none" | "skip">(null);
  /** The large "anything we should know?" box */
  const [about, setAbout] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [enjoyed, setEnjoyed] = useState<string[]>([]);
  const [access, setAccess] = useState<Record<string, Access>>({});
  const [plan, setPlan] = useState<WeekPlan>(START_PLAN);
  const [query, setQuery] = useState("");
  const [bout, setBout] = useState(0);
  const [fixing, setFixing] = useState(false);

  // The "observed" week: the persona's most recent week, or Alex's for new users.
  const bouts = useMemo(() => {
    const p = PERSONAS.find((x) => x.id === state.personaId);
    const wk = (p?.history.length ? p : PERSONAS[0]).history.at(-1)!.sessions.filter((s) => !getVariant(s.variantId).family.fallbackOnly);
    const seen = new Set<string>();
    return wk.filter((s) => {
      const f = getVariant(s.variantId).family.id;
      if (seen.has(f)) return false;
      seen.add(f);
      return true;
    }).slice(0, 3);
  }, [state.personaId]);

  const [hint, setHint] = useState<string | null>(null);
  /** Pages visited, so Back returns to the one the user came from */
  const [trail, setTrail] = useState<Step[]>([]);
  const go = (s: Step) => { setTrail((t) => [...t, step]); setStep(s); setHint(null); };
  const back = () => {
    setHint(null);
    if (step === "confirm" && fixing) { setFixing(false); return; }
    if (step === "confirm" && bout > 0) { setBout((b) => b - 1); return; }
    const prev = trail.at(-1);
    if (!prev) return;
    setTrail(trail.slice(0, -1));
    setStep(prev);
  };
  const note = (text: string, where: string) => dispatch({ type: "addNote", text, where: `Onboarding: ${where}` });

  // ---- The "Other" box on each step: typed answers become the same choices the buttons make.
  const typedBout = (text: string) => {
    const yn = parseYesNo(text);
    if (!fixing && yn === true) { confirmBout(getVariant(current.variantId).family.id); return; }
    if (/\b(skip|not sure|don't know|dont know|no idea)\b/i.test(text)) { confirmBout(null); return; }
    const fam = matchActivity(text);
    if (fam) { confirmBout(fam); setHint(`Got it: ${getFamily(fam).noun}.`); return; }
    if (!fixing && yn === false) { setFixing(true); return; }
    note(`Did "${text}"`, "confirm workout");
    confirmBout(null);
    setHint(`"${text}" isn't in my activity list yet, so I've noted it for the team.`);
  };
  const typedEnjoy = (text: string) => {
    const fam = matchActivity(text);
    if (fam) {
      if (!enjoyed.includes(fam)) toggle(fam);
      setHint(`Added ${getFamily(fam).noun}.`);
      return;
    }
    note(`Enjoys "${text}"`, "activities");
    setHint(`I don't have "${text}" in my list yet, so I can't count it accurately. I've noted it for the team.`);
  };
  const typedPlan = (text: string) => {
    const changes = parsePlanChanges(text);
    const days = Object.keys(changes).map(Number);
    if (!days.length) { note(text, "plan"); setHint('Noted. To change a day, try something like "Thursday off, Saturday 45 min".'); return; }
    setPlan((p) => p.map((x, i) => changes[i] ?? x));
    setHint(`Updated ${days.map((d) => `${DAY_NAMES_LONG[d]} to ${SLOT_LABEL[changes[d]]}`).join(", ")}.`);
  };
  const idx = ORDER.indexOf(step as Step);

  const confirmBout = (familyId: string | null) => {
    if (familyId && !enjoyed.includes(familyId)) {
      setEnjoyed((e) => [...e, familyId]);
      setAccess((a) => ({ ...a, [familyId]: "have" }));
    }
    setFixing(false);
    if (bout + 1 >= bouts.length) go("enjoy");
    else setBout((b) => b + 1);
  };

  const toggle = (id: string) => {
    setEnjoyed((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
    setAccess((a) => ({ ...a, [id]: a[id] ?? "have" }));
  };

  /**
   * The health page. The box takes anything the coach should know and is kept
   * as a note. Text without "No health conditions" is treated as a condition:
   * moderate activity only, and check with a clinician before anything vigorous.
   */
  const healthFlag = health === "skip" || (health !== "none" && about.trim() !== "");
  const continueHealth = () => {
    if (about.trim()) note(about.trim(), "anything we should know");
    go("path");
  };

  const finish = () => {
    dispatch({
      type: "completeOnboarding",
      profile: { ...DEFAULT_PROFILE, ...state.profile, enjoyed, access, hasHealthCondition: healthFlag, fitbitConnected: connected },
      plan,
    });
    onDone();
  };

  const results = query ? searchFamilies(query) : PICKABLE;
  const current = bouts[bout];

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
            <div className="welcome-coins" aria-hidden>
              {(["bronze", "silver", "gold", "gold", "silver", "bronze", "gold"] as const).map((m, i) => <MedalCoin key={i} medal={m} size={40} />)}
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Stop deciding. Start moving.</h1>
            <p className="lead" style={{ marginTop: 14 }}>
              Each day I'll hand you one workout that fits your time and the things you enjoy, and count it toward the
              activity guideline. You just tap.
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
            <p className="lead">I read your workouts to see how much each one counts. In this demo the data is simulated.</p>
            <div className="device">
              <div className="device-icon"><WatchIcon /></div>
              <div style={{ flex: 1 }}>
                <b>Fitbit</b>
                <p className="small muted">{connected ? "Connected" : "Not connected"}</p>
              </div>
              {!connected && (
                <button className="btn btn-quiet" style={{ minHeight: 40 }} disabled={connecting}
                  onClick={() => { setConnecting(true); setTimeout(() => { setConnecting(false); setConnected(true); }, 800); }}>
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>
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

      {step === "path" && (
        <>
          <div className="grow">
            <h1>First, I'll watch a week</h1>
            <p className="lead">Wear your Fitbit as usual for 7 days. I won't suggest anything yet. On day 8 I'll show you what I noticed, and we'll build your list from what you already do.</p>
            <p className="small muted">Your progress and medals count from today.</p>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => { setObserved(true); go("observing"); }}>Start my week</button>
            <button className="btn btn-ghost" onClick={() => { setObserved(false); go("enjoy"); }}>Don't want to wait? Set up now</button>
          </div>
        </>
      )}

      {step === "observing" && (
        <>
          <div className="grow">
            <h1>Watching your week</h1>
            <p className="lead">Day 1 of 7. Just move the way you normally do.</p>
            <ol className="observe-days">
              {DAY_NAMES_LONG.map((d, i) => (
                <li key={d} className={i === 0 ? "now" : ""}><MedalCoin medal="none" size={30} pending={i === 0} future={i > 0} /><span>{d.slice(0, 3)}</span></li>
              ))}
            </ol>
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("confirm")}>Skip ahead to day 8 (demo)</button>
          </div>
        </>
      )}

      {step === "confirm" && current && (
        <>
          <div className="grow">
            <h1>Here's what I noticed</h1>
            <p className="lead">{bout + 1} of {bouts.length}. Confirming helps me count it right.</p>
            <div className="msg agent" style={{ maxWidth: "100%" }}>
              {DAY_NAMES_LONG[current.dayIndex]}, {current.durationMin} min at {current.startTime}. Looks like {getVariant(current.variantId).family.noun}. Right?
            </div>
            {!fixing ? (
              <div className="bubbles" style={{ marginTop: 12 }}>
                <button className="chip chip-strong" onClick={() => confirmBout(getVariant(current.variantId).family.id)}>Yes</button>
                <button className="chip" onClick={() => setFixing(true)}>It was something else</button>
                <button className="chip" onClick={() => confirmBout(null)}>Skip</button>
              </div>
            ) : (
              <div className="chips" style={{ marginTop: 12 }}>
                {PICKABLE.map((f) => (
                  <button key={f.id} className="chip" onClick={() => confirmBout(f.id)}><span className="dot" style={{ background: f.color }} />{f.name}</button>
                ))}
              </div>
            )}
            <OtherInput key={`${bout}-${fixing}`} placeholder={fixing ? "Other: type what it was" : "Other: type your answer"} onSubmit={typedBout} hint={hint} />
          </div>
        </>
      )}

      {step === "enjoy" && (
        <>
          <div className="grow">
            <h1>{observed ? "Anything else you enjoy?" : "What do you enjoy doing?"}</h1>
            <p className="lead">I'll only suggest these. Tap in order of how much you like them; your first is your favorite.</p>
            <label className="sr-only" htmlFor="q">Search activities</label>
            <input id="q" className="search" placeholder="Search, e.g. salsa or hoops" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="chips">
              {results.map((f) => {
                const order = enjoyed.indexOf(f.id);
                return (
                  <button key={f.id} className="chip" aria-pressed={order >= 0} onClick={() => toggle(f.id)}>
                    {order >= 0 ? <span className="order">{order + 1}</span> : <span className="dot" style={{ background: f.color }} />}
                    {f.name}
                  </button>
                );
              })}
            </div>
            <OtherInput placeholder="Other: an activity not listed here" onSubmit={typedEnjoy} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("plan")} disabled={enjoyed.length === 0}>{enjoyed.length ? "Continue" : "Pick at least one"}</button>
          </div>
        </>
      )}

      {step === "plan" && (
        <>
          <div className="grow">
            <h1>Plan this week</h1>
            <p className="lead">Every day starts at 10 min. Change the days that are different, and mark days you can't exercise at all as Off. The weekly goal stays the same; days with more time get more of it.</p>
            <ul className="plan-grid">
              {plan.map((slot, i) => (
                <li key={i}>
                  <div className="plan-day">
                    <b>{DAY_NAMES_LONG[i]}</b>
                    {SLOT_MINUTES[slot] === 0 && <span className="xs muted">{slot === "off" ? "Day off" : "Desk moves only"}</span>}
                  </div>
                  <TimeOptions variant="slot" label={`${DAY_NAMES_LONG[i]} time`} value={slot}
                    onPick={(s) => setPlan((p) => p.map((x, j) => (j === i ? s : x)))} />
                </li>
              ))}
            </ul>
            <OtherInput placeholder="Other: e.g. Thu off, Sat 45 min" onSubmit={typedPlan} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={finish} disabled={plan.every((s) => s === "off")}>Start today</button>
          </div>
        </>
      )}
    </div>
  );
}
