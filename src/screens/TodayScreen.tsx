/**
 * Today: the daily loop from the workflow doc. The coach asks, the user taps.
 * Past turns read as a conversation; the live question or card sits at the
 * bottom, so there's always exactly one decision in front of the user.
 */
import { useEffect, useRef } from "react";
import { TodayBar, WeekBar, WeekLegend } from "../components/WeekBar";
import { SettingsIcon } from "../components/Icons";
import { MedalCoin, WeekCoins } from "../components/Medal";
import { getFamily, getVariant } from "../lib/activities";
import { countsTowardGoal, fmt, fmtGoal, intensityOf } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason, type Suggestion } from "../lib/suggest";
import { QUESTIONS, type QuestionId } from "../services/answers";
import { useStore } from "../state/store";
import { CONFIRM_CHOICES, ENERGY_OPTIONS, PLACE_OPTIONS, TIME_OPTIONS } from "../state/today";
import type { Screen, TodayStep } from "../state/types";
import { OtherInput } from "../components/OtherInput";

/** What the Other box says at each step. Every step that asks something gets one. */
const OTHER_PLACEHOLDER: Partial<Record<TodayStep, string>> = {
  time: "Other: e.g. 25 min, or an hour",
  place: "Other: e.g. at the gym",
  energy: "Other: tell me how you feel",
  mood: "Other: any activity you have in mind",
  suggested: "Other: ask or say anything",
  reason: "Other: e.g. my knee is sore",
  accepted: "Other: ask or change plans",
  confirm: "Other: what was it?",
  "confirm-other": "Other: type the activity",
  nudge: "Other: type your answer",
  wrap: "Other: ask the coach anything",
};

const REASONS: DeclineReason[] = ["no-time", "tired", "not-mood", "recent", "no-access", "weather", "hurts"];

function dateLabel(todayIndex: number): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const day = new Date(monday);
  day.setDate(monday.getDate() + todayIndex);
  return day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function Bubbles({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="bubbles" role="group" aria-label={label}>{children}</div>;
}

function Questions({ ids }: { ids: QuestionId[] }) {
  const { dispatch } = useStore();
  return (
    <div className="ask-row" role="group" aria-label="Ask the coach">
      {ids.map((q) => (
        <button key={q} className="ask-chip" onClick={() => dispatch({ type: "ask", q })}>{QUESTIONS[q]}</button>
      ))}
    </div>
  );
}

function SuggestionCard({ s, lead }: { s: Suggestion; lead: boolean }) {
  const { ctx, dispatch } = useStore();
  const { family, variant } = getVariant(s.variantId);
  const counts = countsTowardGoal(variant.met);
  const share = ctx.todayTarget > 0 ? Math.min(1, s.credit / ctx.todayTarget) : 0;

  if (!lead) {
    return (
      <div className="pick backup">
        <span className="dot" style={{ background: family.color }} />
        <div className="pick-what">
          <b>{s.pattern ? variant.label : `${s.durationMin} min ${family.noun}`}</b>
          <span className="xs muted">{s.pattern ?? variant.label}{counts ? `, ${fmt(s.credit)} MET-hours` : ", earns bronze"}</span>
        </div>
        <button className="btn btn-quiet small-btn" onClick={() => dispatch({ type: "accept", suggestion: s })}>Do this instead</button>
      </div>
    );
  }

  return (
    <div className="pick lead" style={{ ["--accent" as string]: family.color }}>
      <div className="pick-head">
        <div>
          <p className="pick-kicker">{family.name}</p>
          <h2>{s.pattern ? variant.label : `${s.durationMin} min, ${variant.label.toLowerCase()}`}</h2>
          {s.pattern && <p className="small muted">{s.pattern}</p>}
        </div>
        <div className="pick-credit">
          {counts ? <><span className="num">{fmt(s.credit)}</span><span className="xs">MET-hours</span></> : <MedalCoin medal="bronze" size={34} title="Earns bronze" />}
        </div>
      </div>
      {counts && ctx.todayTarget > 0 && (
        <div className="today-share" aria-label={`${Math.round(share * 100)}% of today's target`}>
          <div className="bar"><span style={{ width: `${share * 100}%` }} /></div>
          <span className="xs muted">{share >= 1 ? "Covers today's target" : `${Math.round(share * 100)}% of today's ${fmt(ctx.todayTarget)}`}</span>
        </div>
      )}
      <ul className="reasons">
        {s.reasons.filter((r) => !(counts && ctx.todayTarget > 0 && /target/.test(r))).map((r) => <li key={r}>{r}</li>)}
        {!counts && <li>Light activity ({variant.met} MET): a medal, not goal credit for now</li>}
        {intensityOf(variant.met) === "vigorous" && <li>Vigorous: {variant.met} MET</li>}
      </ul>
    </div>
  );
}

export function TodayScreen({ go, openPrefs }: { go: (s: Screen) => void; openPrefs: () => void }) {
  const { state, ctx, dispatch } = useStore();
  const t = state.today;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [t.entries.length, t.step, t.current?.showBackups]);

  const top3 = state.profile.enjoyed.slice(0, 3);
  const pending = t.pendingSessionId ? state.sessions.find((s) => s.id === t.pendingSessionId) : undefined;
  const pendingFamily = pending ? getVariant(pending.variantId).family.id : undefined;
  const altFamily = state.profile.enjoyed.find((id) => id !== pendingFamily);

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Today</h1>
          <p className="sub">{dateLabel(state.todayIndex)}</p>
        </div>
        <button className="icon-btn" aria-label="Preferences" onClick={openPrefs}><SettingsIcon /></button>
      </div>

      <section className="today-summary" aria-label="Progress">
        <WeekLegend />
        <WeekCoins medals={ctx.medals} todayIndex={state.todayIndex} plan={state.plan} />
        <div className="summary-lines">
          <div className="summary-line">
            <span className="k">This week</span>
            <WeekBar doneByDay={ctx.week.doneByDay} todayIndex={state.todayIndex} todayTarget={ctx.todayTarget} goal={ctx.goal} />
            <span className="v num">{fmt(ctx.week.done)}<small>/{fmtGoal(ctx.goal)}</small></span>
          </div>
          <div className="summary-line">
            <span className="k">Today</span>
            <TodayBar done={ctx.todayDone} target={ctx.todayTarget} />
            {state.plan[state.todayIndex] === "off" && ctx.todayTarget === 0
              ? <span className="v num">{fmt(ctx.todayDone)}<small> off</small></span>
              : <span className="v num">{fmt(ctx.todayDone)}<small>/{fmt(ctx.todayTarget)}</small></span>}
          </div>
        </div>
        <button className="streak" onClick={() => go("progress")}>
          <b className="num">{ctx.streak.current}</b>-day streak{ctx.streak.todayPending ? ", keep it going today" : ""}
        </button>
      </section>
      {(state.clinician.note.trim() || state.clinician.precautions?.trim()) && (
        <div className="clin-note">
          <b>From {state.clinician.name?.trim() || "your clinician"}:</b> {state.clinician.note}
          {state.clinician.precautions?.trim() && <p className="xs" style={{ marginTop: 4 }}><b>Precautions:</b> {state.clinician.precautions}</p>}
          {state.clinician.review && <p className="xs muted" style={{ marginTop: 4 }}>Goal review: {state.clinician.review.toLowerCase()}</p>}
        </div>
      )}

      <div className="feed" aria-live="polite">
        {t.entries.map((e) =>
          e.role === "medal" ? (
            <div key={e.id} className="medal-moment">
              <MedalCoin medal={e.medal!} size={56} />
              <p>{e.text}</p>
            </div>
          ) : (
            <div key={e.id} className={`msg ${e.role}`}>{e.text}</div>
          ),
        )}

        {t.step === "time" && (
          <Bubbles label="Time today">
            {TIME_OPTIONS.map(([label, m]) => <button key={label} className="chip" onClick={() => dispatch({ type: "time", label, minutes: m })}>{label}</button>)}
          </Bubbles>
        )}
        {t.step === "place" && (
          <Bubbles label="Where you'll exercise">
            {PLACE_OPTIONS.map(([label, p]) => <button key={p} className="chip" onClick={() => dispatch({ type: "place", label, place: p })}>{label}</button>)}
          </Bubbles>
        )}
        {t.step === "energy" && (
          <Bubbles label="How you feel">
            {ENERGY_OPTIONS.map(([label, e]) => <button key={e} className="chip" onClick={() => dispatch({ type: "energy", label, energy: e })}>{label}</button>)}
          </Bubbles>
        )}
        {t.step === "mood" && (
          <Bubbles label="In the mood for">
            {top3.map((id) => (
              <button key={id} className="chip" onClick={() => dispatch({ type: "mood", label: getFamily(id).name, mood: id })}>
                <span className="dot" style={{ background: getFamily(id).color }} />{getFamily(id).name}
              </button>
            ))}
            <button className="chip chip-strong" onClick={() => dispatch({ type: "mood", label: "Surprise me", mood: "surprise" })}>Surprise me</button>
          </Bubbles>
        )}

        {t.step === "suggested" && t.current && (
          <div className="live">
            <SuggestionCard s={t.current.lead} lead />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => dispatch({ type: "accept", suggestion: t.current!.lead })}>Let's do it</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "decline" })}>Not today</button>
            </div>
            {!t.current.showBackups && t.current.backups.length > 0 && (
              <button className="btn btn-ghost btn-block" onClick={() => dispatch({ type: "showBackups" })}>Show other options</button>
            )}
            {t.current.showBackups && t.current.backups.map((b) => <SuggestionCard key={b.variantId} s={b} lead={false} />)}
            {!t.current.desk && !t.boost && (
              <button className="link-btn" onClick={() => dispatch({ type: "wantMore" })}>I want more today</button>
            )}
            <Questions ids={["met", "why", "how"]} />
          </div>
        )}

        {t.step === "reason" && (
          <Bubbles label="Why not today">
            {REASONS.map((r) => <button key={r} className={`chip${r === "hurts" ? " chip-care" : ""}`} onClick={() => dispatch({ type: "reason", reason: r })}>{DECLINE_LABEL[r]}</button>)}
          </Bubbles>
        )}
        {t.step === "accepted" && t.accepted && (
          <div className="live">
            <div className="plan-ticket" style={{ ["--accent" as string]: getFamily(t.accepted.familyId).color }}>
              <span className="xs muted">Today's plan</span>
              <b>{t.accepted.pattern ? getVariant(t.accepted.variantId).variant.label : `${t.accepted.durationMin} min ${getFamily(t.accepted.familyId).noun}`}</b>
              <span className="small muted">Waiting for your Fitbit to sync</span>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => dispatch({ type: "sync" })}>Sync Fitbit (demo)</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "decline" })}>Change of plans</button>
            </div>
            <Questions ids={["how", "walking", "goal"]} />
          </div>
        )}

        {t.step === "confirm" && pending && (
          <Bubbles label="Confirm the workout">
            <button className="chip chip-strong" onClick={() => dispatch({ type: "confirm", answer: "yes" })}>Yes</button>
            {altFamily && <button className="chip" onClick={() => dispatch({ type: "confirm", answer: { familyId: altFamily } })}>It was {getFamily(altFamily).noun}</button>}
            <button className="chip" onClick={() => dispatch({ type: "confirm", answer: "other" })}>Other…</button>
            <button className="chip" onClick={() => dispatch({ type: "confirm", answer: "not-exercise" })}>Not exercise</button>
            <p className="xs muted bubbles-note">Until you confirm, it counts at {pending.band === "very" ? "6.0" : "3.0"} MET, the bottom of Fitbit's {pending.band === "very" ? "very active" : "fairly active"} band.</p>
          </Bubbles>
        )}
        {t.step === "confirm-other" && (
          <Bubbles label="What was it">
            {CONFIRM_CHOICES.map((f) => (
              <button key={f.id} className="chip" onClick={() => dispatch({ type: "confirm", answer: { familyId: f.id } })}>
                <span className="dot" style={{ background: f.color }} />{f.name}
              </button>
            ))}
          </Bubbles>
        )}

        {t.step === "nudge" && (
          <Bubbles label="Keep going">
            <button className="chip chip-strong" onClick={() => dispatch({ type: "keepGoing", yes: true })}>Keep going</button>
            <button className="chip" onClick={() => dispatch({ type: "keepGoing", yes: false })}>Done for today</button>
          </Bubbles>
        )}

        {t.step === "wrap" && (
          <div className="live">
            <Bubbles label="What next">
              <button className="chip" onClick={() => go("progress")}>See my progress</button>
              <button className="chip" onClick={() => dispatch({ type: "sync" })}>Sync another workout (demo)</button>
            </Bubbles>
            <Questions ids={["medals", "goal"]} />
          </div>
        )}
        {OTHER_PLACEHOLDER[t.step] && (t.step !== "confirm" || pending) && (
          <OtherInput key={t.step} placeholder={OTHER_PLACEHOLDER[t.step]} label="Type your own answer" onSubmit={(text) => dispatch({ type: "freeText", text })} />
        )}
        <div ref={end} />
      </div>
    </>
  );
}
