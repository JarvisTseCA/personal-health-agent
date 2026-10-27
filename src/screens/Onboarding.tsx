/**
 * Onboarding, observe-first (workflow doc):
 *   Day 1: connect Fitbit, one health question.
 *   Days 1–7: observe a week; no suggestions yet, but medals already count.
 *   Day 8: confirm what the coach detected, then likes, access, usual time,
 *          and the first weekly plan.
 * "Don't want to wait?" skips the observing week and asks the day-8 questions now.
 */
import { useMemo, useState } from "react";
import { WatchIcon } from "../components/Icons";
import { OtherInput } from "../components/OtherInput";
import { matchActivity, parseMinutes, parsePlanChanges, parseYesNo } from "../lib/freeText";
import { MedalCoin } from "../components/Medal";
import { PERSONAS } from "../data/mockFitbit";
import { getFamily, getVariant, PICKABLE, searchFamilies } from "../lib/activities";
import { DAY_NAMES_LONG } from "../lib/met";
import { SLOT_LABEL, type WeekPlan } from "../lib/plan";
import { TimeOptions } from "../components/TimeOptions";
import type { Access } from "../lib/suggest";
import { DEFAULT_PROFILE, useStore } from "../state/store";
import type { UsualTime } from "../state/types";

type Step = "welcome" | "fitbit" | "health" | "path" | "observing" | "confirm" | "enjoy" | "access" | "time" | "plan";
const ORDER: Step[] = ["fitbit", "health", "path", "observing", "confirm", "enjoy", "access", "time", "plan"];

const TIME: Array<[UsualTime, string, WeekPlan]> = [
  ["under1", "Under 1 hr", ["10", "off", "10", "off", "10", "off", "10"]],
  ["1to2", "1 to 2 hrs", ["10", "off", "30", "off", "30", "45", "off"]],
  ["2to3", "2 to 3 hrs", ["30", "30", "off", "30", "30", "45", "off"]],
  ["3plus", "3+ hrs", ["30", "45", "30", "off", "30", "45", "30"]],
];

const ACCESS: Array<[Access, string]> = [["have", "Have what I need"], ["sometimes", "Sometimes"], ["no", "Not right now"]];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>("welcome");
  const [observed, setObserved] = useState(false);
  const [health, setHealth] = useState<null | "none" | "yes" | "skip">(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [enjoyed, setEnjoyed] = useState<string[]>([]);
  const [access, setAccess] = useState<Record<string, Access>>({});
  const [usual, setUsual] = useState<UsualTime | null>(null);
  const [plan, setPlan] = useState<WeekPlan>(TIME[1][2]);
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
  const go = (s: Step) => { setStep(s); setHint(null); };
  const note = (text: string, where: string) => dispatch({ type: "addNote", text, where: `Onboarding: ${where}` });

  // ---- The "Other" box on each step: typed answers become the same choices the buttons make.
  const typedHealth = (text: string) => {
    if (/^(no|none|nope|nothing|all good|healthy)\b/i.test(text)) { setHealth("none"); setHint("Got it: no health conditions."); return; }
    setHealth("yes");
    note(text, "health");
    setHint("Thanks, noted. I'll keep to moderate activity for now and suggest checking with a clinician before anything vigorous.");
  };
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
  const typedAccess = (text: string) => {
    const fam = matchActivity(text);
    if (fam && enjoyed.includes(fam)) {
      const a: Access = /\b(sometimes|some weeks|occasionally)\b/i.test(text) ? "sometimes" : /\b(no|not|can't|cannot|don't|dont|broken|closed|without)\b/i.test(text) ? "no" : "have";
      setAccess((x) => ({ ...x, [fam]: a }));
      setHint(`Set ${getFamily(fam).noun} to "${ACCESS.find(([k]) => k === a)![1]}".`);
      return;
    }
    note(text, "access");
    setHint("Noted. I'll keep that in mind when I suggest things.");
  };
  const typedTime = (text: string) => {
    const m = parseMinutes(text);
    if (m === null) { setHint("I didn't catch a time. Roughly how much a week, like 90 minutes or 2 hours?"); return; }
    const row = m < 60 ? TIME[0] : m <= 120 ? TIME[1] : m <= 180 ? TIME[2] : TIME[3];
    setUsual(row[0]);
    setPlan(row[2]);
    setHint(`About ${m >= 60 ? `${Math.round((m / 60) * 10) / 10} hr` : `${m} min`} a week, so I picked "${row[1]}".`);
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

  const finish = () => {
    dispatch({
      type: "completeOnboarding",
      profile: { ...DEFAULT_PROFILE, ...state.profile, enjoyed, access, usualTime: usual ?? "1to2", hasHealthCondition: health === "yes" || health === "skip", fitbitConnected: connected },
      plan,
    });
    onDone();
  };

  const results = query ? searchFamilies(query) : PICKABLE;
  const current = bouts[bout];

  return (
    <div className="onb">
      {step !== "welcome" && (
        <div className="onb-progress" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
          {ORDER.map((s, i) => <span key={s} className={i <= idx ? "on" : ""} />)}
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
            <button className="btn btn-ghost" onClick={() => go("welcome")}>Back</button>
          </div>
        </>
      )}

      {step === "health" && (
        <>
          <div className="grow">
            <h1>Anything we should know?</h1>
            <p className="lead">For example heart disease, high blood pressure, diabetes or pregnancy. If so, I'll skip vigorous suggestions and suggest checking with a clinician first.</p>
            <div className="choice">
              <button aria-pressed={health === "none"} onClick={() => setHealth("none")}><b>No health conditions</b></button>
              <button aria-pressed={health === "yes"} onClick={() => setHealth("yes")}><b>I have a condition</b><span>Moderate activity only for now</span></button>
              <button aria-pressed={health === "skip"} onClick={() => setHealth("skip")}><b>Prefer not to say</b><span>I'll play it safe with moderate activity</span></button>
            </div>
            <OtherInput placeholder="Other: describe it in your own words" onSubmit={typedHealth} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("path")} disabled={!health}>Continue</button>
            <button className="btn btn-ghost" onClick={() => go("fitbit")}>Back</button>
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
            <button className="btn btn-ghost" onClick={() => go("path")}>Back</button>
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
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => go("observing")}>Back</button>
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
            <button className="btn btn-primary btn-block" onClick={() => go("access")} disabled={enjoyed.length === 0}>{enjoyed.length ? "Continue" : "Pick at least one"}</button>
            <button className="btn btn-ghost" onClick={() => go(observed ? "confirm" : "path")}>Back</button>
          </div>
        </>
      )}

      {step === "access" && (
        <>
          <div className="grow">
            <h1>Which can you actually do this month?</h1>
            <p className="lead">I won't suggest anything you can't get to.</p>
            <ul className="access-list">
              {enjoyed.map((id) => {
                const f = getFamily(id);
                return (
                  <li key={id}>
                    <b><span className="dot" style={{ background: f.color }} /> {f.name}</b>
                    {f.needs && <span className="xs muted">{id === "basketball" ? "Is there a court near you?" : `Needs ${f.needs}`}</span>}
                    <div className="slot-row" role="radiogroup" aria-label={`Access to ${f.name}`}>
                      {ACCESS.map(([a, label]) => (
                        <button key={a} role="radio" aria-checked={(access[id] ?? "have") === a} className="slot" onClick={() => setAccess((x) => ({ ...x, [id]: a }))}>{label}</button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <OtherInput placeholder="Other: e.g. my bike is in the shop" onSubmit={typedAccess} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("time")}>Continue</button>
            <button className="btn btn-ghost" onClick={() => go("enjoy")}>Back</button>
          </div>
        </>
      )}

      {step === "time" && (
        <>
          <div className="grow">
            <h1>Most weeks, how much time do you have?</h1>
            <p className="lead">A rough guess is fine. Short blocks count.</p>
            <div className="choice">
              {TIME.map(([id, label, preset]) => (
                <button key={id} aria-pressed={usual === id} onClick={() => { setUsual(id); setPlan(preset); setHint(null); }}><b>{label}</b></button>
              ))}
            </div>
            <OtherInput placeholder="Other: e.g. about 90 minutes" onSubmit={typedTime} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={() => go("plan")} disabled={!usual}>Continue</button>
            <button className="btn btn-ghost" onClick={() => go("access")}>Back</button>
          </div>
        </>
      )}

      {step === "plan" && (
        <>
          <div className="grow">
            <h1>Plan this week</h1>
            <p className="lead">Mark the days you can't exercise at all as Off. The weekly goal stays the same; the other days share it.</p>
            <ul className="plan-grid">
              {plan.map((slot, i) => (
                <li key={i}>
                  <span className="small"><b>{DAY_NAMES_LONG[i].slice(0, 3)}</b></span>
                  <TimeOptions variant="slot" label={`${DAY_NAMES_LONG[i]} time`} value={slot}
                    onPick={(s) => setPlan((p) => p.map((x, j) => (j === i ? s : x)))} />
                </li>
              ))}
            </ul>
            <p className="xs muted" style={{ marginTop: 8 }}>0 min means desk moves only. The days with more time get more of the goal.</p>
            <OtherInput placeholder="Other: e.g. Thu off, Sat 45 min" onSubmit={typedPlan} hint={hint} />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-block" onClick={finish} disabled={plan.every((s) => s === "off")}>Start today</button>
            <button className="btn btn-ghost" onClick={() => go("time")}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}
