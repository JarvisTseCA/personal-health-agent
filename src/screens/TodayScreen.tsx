/**
 * Today: the daily loop from the workflow doc. The agent asks, the user taps.
 * Past turns read as a conversation; the live question or card sits at the
 * bottom, so there's always exactly one decision in front of the user.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WeekBars, WeekLegend } from "../components/WeekBar";
import { SettingsIcon } from "../components/Icons";
import { AiNotice } from "../components/AiNotice";
import { Flame, Trophy } from "../components/Rewards";
import { VideoCard } from "../components/VideoCard";
import { getFamily, getVariant } from "../lib/activities";
import { equipmentName } from "../lib/equipment";
import { movesFor } from "../lib/moves";
import { countsTowardGoal, fmt, fmtGoal, intensityOf } from "../lib/met";
import { DECLINE_LABEL, type DeclineReason, type Suggestion } from "../lib/suggest";
import { equipmentAt } from "../services/context";
import { useFitbitSync, useStore, useTypedAnswer } from "../state/store";
import { CHANGE_TIME_LABEL, CONFIRM_CHOICES, ENERGY_OPTIONS, hasHowTo, keepTimeLabel, MAX_PASSES, PLACE_OPTIONS, REMIND_OPTIONS, SETUP_GOAL_OPTIONS, SETUP_PLAN_DONE } from "../state/today";
import { TimeOptions } from "../components/TimeOptions";
import { SLOT_LABEL, SLOT_MINUTES } from "../lib/plan";
import type { Screen, TodayStep } from "../state/types";
import { OtherInput } from "../components/OtherInput";
import { UserMessage } from "../components/UserMessage";
import type { AppState } from "../state/types";
import { tableHeading } from "../lib/tableActivities";
import { PlanDays } from "../components/PlanDays";

/** What the Other box says at each step. Every step that asks something gets one. */
const OTHER_PLACEHOLDER: Partial<Record<TodayStep, string>> = {
  "setup-goal": "Other: e.g. 6",
  "setup-plan": "Other: e.g. Thu off, Sat 45 min",
  "time-confirm": "Other: e.g. 45 min today",
  time: "Other: e.g. 25 min, or an hour",
  place: "Other: e.g. at the park",
  energy: "Other: tell me how you feel",
  mood: "Other: any activity you have in mind",
  suggested: "Other: ask, or tell me why not",
  remind: "Other: e.g. at 5:30 pm",
  reminded: "Other: ask or change plans",
  reason: "Other: e.g. my knee is sore",
  accepted: "Other: ask or change plans",
  confirm: "Other: what was it?",
  "confirm-other": "Other: type the activity",
  nudge: "Other: type your answer",
  wrap: "Other: ask anything",
  own: "e.g. 40 min badminton",
  "own-minutes": "Other: e.g. 25",
  "own-confirm": "Something else? e.g. tennis",
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

/**
 * "Show me how", when the pick has a how-to video. The one-tap questions that used
 * to sit beside it (What's a MET?, Why this activity?, …) are gone from Today;
 * typed questions are still answered, and Chat has its own starters.
 */
function ShowHow() {
  const { state, dispatch } = useStore();
  if (!hasHowTo(state)) return null;
  return (
    <div className="ask-row">
      <button className="ask-chip ask-how" onClick={() => dispatch({ type: "showHow" })}>Show me how</button>
    </div>
  );
}

/** The circuit for a strength or interval pick, built from the equipment where the user is today. */
function Circuit({ s }: { s: Suggestion }) {
  const { state } = useStore();
  const here = equipmentAt(state, state.today.checkIn.place ?? "indoors_private") ?? [];
  const moves = movesFor(s.variantId, here);
  if (!moves.length) return null;
  const uses = [...new Set(moves.map((m) => m.uses).filter(Boolean) as string[])];
  return (
    <div className="circuit">
      <p className="xs muted">{uses.length ? `Your circuit with ${uses.map((u) => equipmentName(u).toLowerCase()).join(" and ")}` : "Your circuit, no equipment needed"}: repeat for the time</p>
      <ol>
        {moves.map((m) => (
          <li key={m.name}><span>{m.name}</span><span className="xs muted">{m.dose}</span></li>
        ))}
      </ol>
    </div>
  );
}

/** While the activity table's pick is on its way. */
function FindingCard() {
  return (
    <div className="pick lead finding" role="status">
      <p className="pick-kicker">From the activity table</p>
      <h2>Finding one for you…</h2>
      <p className="small muted">Picking from hundreds of activities that fit your time and where you are.</p>
    </div>
  );
}

/** With the backend, when no pick came back: say so and offer to ask again. */
function NoPickCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="pick lead finding" role="status">
      <p className="pick-kicker">From the backend</p>
      <h2>No suggestion came back</h2>
      <p className="small muted">The backend didn't answer, or nothing in the activity table fits right now.</p>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onRetry}>Try again</button>
    </div>
  );
}

function SuggestionCard({ s, lead }: { s: Suggestion; lead: boolean }) {
  const { ctx, dispatch } = useStore();
  const { family, variant } = getVariant(s.variantId);
  // A row of the activity table: its category above, its name (the description up to the effort level) as the title.
  const heading = tableHeading(s.variantId);
  const counts = countsTowardGoal(variant.met);
  const raw = ctx.todayTarget > 0 ? s.credit / ctx.todayTarget : 0;
  const share = Math.min(1, raw);

  if (!lead) {
    return (
      <div className="pick backup">
        <span className="dot" style={{ background: family.color }} />
        <div className="pick-what">
          <b>{s.pattern ? variant.label : `${s.durationMin} min ${family.noun}`}</b>
          <span className="xs muted">{s.pattern ?? heading ?? variant.label}{counts ? `, ${fmt(s.credit)} MET-hours` : ", light activity"}</span>
        </div>
        <button className="btn btn-quiet small-btn" onClick={() => dispatch({ type: "accept", suggestion: s })}>Do this instead</button>
      </div>
    );
  }

  return (
    <div className="pick lead" style={{ ["--accent" as string]: family.color }}>
      <div className="pick-head">
        <div>
          <p className="pick-kicker">{heading ?? family.name}</p>
          <h2>{s.pattern ? variant.label : heading ? `${s.durationMin} min, ${family.noun}` : `${s.durationMin} min, ${variant.label.toLowerCase()}`}</h2>
          {s.pattern && <p className="small muted">{s.pattern}</p>}
        </div>
        <div className="pick-credit">
          {counts ? <><span className="num">{fmt(s.credit)}</span><span className="xs">MET-hours</span></> : <span className="xs">Light</span>}
        </div>
      </div>
      {counts && ctx.todayTarget > 0 && (
        <div className="today-share" aria-label={`${Math.round(raw * 100)}% of today's target`}>
          <div className="bar"><span style={{ width: `${share * 100}%` }} /></div>
          <span className="xs muted">{raw >= 1.2 ? `${Math.round(raw * 100)}% of today's target` : share >= 1 ? "Covers today's target" : `${Math.round(share * 100)}% of today's ${fmt(ctx.todayTarget)}`}</span>
        </div>
      )}
      <ul className="reasons">
        {s.reasons.filter((r) => !(counts && ctx.todayTarget > 0 && /target/.test(r))).map((r) => <li key={r}>{r}</li>)}
        {!counts && <li>Light activity ({variant.met} MET): no goal credit for now</li>}
        {intensityOf(variant.met) === "vigorous" && <li>Vigorous: {variant.met} MET</li>}
      </ul>
      <Circuit s={s} />
    </div>
  );
}

export function TodayScreen({ go, openPrefs }: { go: (s: Screen) => void; openPrefs: () => void }) {
  const { state, ctx, dispatch } = useStore();
  const sync = useFitbitSync();
  const typed = useTypedAnswer();
  const demo = state.profile.fitbitLive ? "" : " (demo)";
  const t = state.today;
  const end = useRef<HTMLDivElement>(null);
  /** The answer whose actions row is open */
  const [selected, setSelected] = useState<string | null>(null);
  /** While editing an earlier answer: how to undo, and the old answer to start from */
  const [editing, setEditing] = useState<{ backup: AppState; count: number; text: string } | null>(null);

  // Keep the latest message in view. A new message scrolls there smoothly. When the feed gets
  // shorter (editing an earlier answer drops what came after it), jump there at once, before the
  // browser paints: a smooth scroll in a container whose content just shrank can leave the page
  // drawn at the old position while clicks land at the new one, so every button seems dead.
  const shown = useRef(t.entries.length);
  useLayoutEffect(() => {
    const shrank = t.entries.length < shown.current;
    shown.current = t.entries.length;
    const el = end.current;
    if (!el) return;
    if (!shrank) {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    const screen = el.closest(".screen");
    if (screen) screen.scrollTop = Math.max(0, screen.scrollHeight - screen.clientHeight);
    else el.scrollIntoView({ block: "end" });
  }, [t.entries.length, t.step, t.current?.showBackups]);

  // A new answer ends the edit: the conversation carries on from there.
  useEffect(() => {
    if (editing && t.entries.length !== editing.count) setEditing(null);
  }, [t.entries.length, editing]);

  const editFrom = (entryId: string, count: number, text: string) => {
    setSelected(null);
    setEditing({ backup: state, count, text });
    dispatch({ type: "editAnswer", entryId });
  };
  const cancelEdit = () => {
    if (editing) dispatch({ type: "hydrate", state: editing.backup });
    setEditing(null);
  };

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
        <WeekBars
          doneByDay={ctx.week.doneByDay} todayIndex={state.todayIndex} todayTarget={ctx.todayTarget} todayDone={ctx.todayDone}
          weekDone={ctx.week.done} goal={ctx.goal} todayOff={state.plan[state.todayIndex] === "off" && ctx.todayTarget === 0}
        />
        <div className="reward-strip">
          <button className="reward-stat" onClick={() => go("progress")} aria-label={`${ctx.streak.current} ${ctx.streak.current === 1 ? "day" : "days"} in a row. Open Progress`}>
            <Flame size={22} />
            <span><b className="num">{ctx.streak.current}</b><small>{ctx.streak.current === 1 ? "day" : "days"} in a row</small></span>
          </button>
          <button className="reward-stat" onClick={() => go("progress")} aria-label={ctx.trophy ? "This week's trophy earned. Open Progress" : `Trophy at ${fmtGoal(ctx.goal)} MET-hours. Open Progress`}>
            <Trophy size={22} earned={ctx.trophy} />
            <span>{ctx.trophy ? <><b>Earned</b><small>this week's trophy</small></> : <><b className="num">{fmt(ctx.left)}</b><small>to the trophy</small></>}</span>
          </button>
          <button className="reward-stat" onClick={() => go("progress")} aria-label={ctx.vo2 ? `VO2 max ${ctx.vo2.latest}. Open Progress` : "VO2 max: no estimate yet. Open Progress"}>
            <span className="vo2-chip">VO2</span>
            <span>{ctx.vo2 ? <><b className="num">{ctx.vo2.latest}</b><small>{ctx.vo2.change > 0 ? `up ${ctx.vo2.change} since ${ctx.vo2.series[0].label}` : "VO2 max"}</small></> : <><b>–</b><small>VO2 max soon</small></>}</span>
          </button>
        </div>
      </section>

      <div className="feed" aria-live="polite">
        <AiNotice />
        {t.entries.map((e) =>
          e.role === "trophy" ? (
            <div key={e.id} className="trophy-moment">
              <Trophy size={52} />
              <p>{e.text}</p>
            </div>
          ) : e.video ? (
            <div key={e.id} className="msg agent msg-video">
              <p>{e.text}</p>
              <VideoCard video={e.video} />
            </div>
          ) : e.role === "user" ? (
            <UserMessage
              key={e.id}
              text={e.text}
              at={e.at}
              selected={selected === e.id}
              onSelect={() => setSelected(selected === e.id ? null : e.id)}
              onEdit={e.rewind ? () => editFrom(e.id, e.rewind!.entryCount, e.text) : undefined}
            />
          ) : (
            <div key={e.id} className={`msg ${e.role}`}>{e.text}</div>
          ),
        )}

        {typed.pending && (
          <>
            <div className="msg user">{typed.pending}</div>
            <div className="msg agent"><span className="typing" aria-label="The agent is reading your answer"><i /><i /><i /></span></div>
          </>
        )}

        {editing && (
          <div className="edit-banner" role="status">
            <span><b>Editing your answer.</b> Pick again or change it below.</span>
            <button className="btn btn-quiet" onClick={cancelEdit}>Cancel</button>
          </div>
        )}

        {t.step === "setup-goal" && (
          <Bubbles label="Weekly goal">
            {SETUP_GOAL_OPTIONS.map(([label, to], i) => (
              <button key={label} className={`chip${i === 0 ? " chip-strong" : ""}`} onClick={() => dispatch({ type: "setupGoal", label, to })}>{label}</button>
            ))}
          </Bubbles>
        )}
        {t.step === "setup-plan" && (
          <div className="live setup-plan">
            <PlanDays plan={state.plan} onPick={(day, slot) => dispatch({ type: "setSlot", day, slot })} />
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={state.plan.every((d) => d === "off")} onClick={() => dispatch({ type: "setupPlanDone", label: SETUP_PLAN_DONE })}>{SETUP_PLAN_DONE}</button>
            </div>
          </div>
        )}
        {t.step === "time-confirm" && (
          <Bubbles label="Keep today's time">
            <button className="chip chip-strong" onClick={() => dispatch({ type: "confirmTime", keep: true })}>{keepTimeLabel(state)}</button>
            <button className="chip" onClick={() => dispatch({ type: "confirmTime", keep: false })}>{CHANGE_TIME_LABEL}</button>
          </Bubbles>
        )}
        {t.step === "time" && (
          <TimeOptions
            label="Time today"
            onPick={(s) => dispatch(s === "off" ? { type: "dayOff" } : { type: "time", label: SLOT_LABEL[s], minutes: SLOT_MINUTES[s], slot: s })}
          />
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

        {t.step === "suggested" && t.current?.pending && (
          <div className="live"><FindingCard /></div>
        )}
        {t.step === "suggested" && t.current?.failed && (
          <div className="live"><NoPickCard onRetry={() => dispatch({ type: "retrySuggestion" })} /></div>
        )}
        {t.step === "suggested" && t.current && !t.current.pending && !t.current.failed && (
          <div className="live">
            <SuggestionCard s={t.current.lead} lead />
            {t.current.why ? (
              <p className="why-line small muted">{t.current.why}</p>
            ) : t.current.whyPending ? (
              <p className="why-line why-loading small muted" role="status">Loading reasoning…</p>
            ) : null}
            <div className="btn-stack">
              <button className="btn btn-primary" onClick={() => dispatch({ type: "accept", suggestion: t.current!.lead })}>Let's start</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "remindLater" })}>Remind me later</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "another" })}>{(t.passed ?? 0) >= MAX_PASSES ? "None of these work" : "Give me another option"}</button>
            </div>
            {t.current.skipped && (
              <div className="skip-why">
                <Bubbles label="Why not the last option (optional)">
                  {REASONS.map((r) => <button key={r} className={`chip chip-small${r === "hurts" ? " chip-care" : ""}`} onClick={() => dispatch({ type: "skipReason", reason: r })}>{DECLINE_LABEL[r]}</button>)}
                </Bubbles>
              </div>
            )}
            <ShowHow />
          </div>
        )}

        {t.step === "remind" && (
          <Bubbles label="When to remind you">
            {REMIND_OPTIONS.map((w) => <button key={w} className="chip" onClick={() => dispatch({ type: "setReminder", when: w })}>{w}</button>)}
          </Bubbles>
        )}
        {t.step === "reminded" && t.current && (
          <div className="live">
            <div className="plan-ticket" style={{ ["--accent" as string]: getFamily(t.current.lead.familyId).color }}>
              <span className="xs muted">Reminder {t.reminder}</span>
              <b>{t.current.lead.pattern ? getVariant(t.current.lead.variantId).variant.label : `${t.current.lead.durationMin} min ${getFamily(t.current.lead.familyId).noun}`}</b>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => dispatch({ type: "accept", suggestion: t.current!.lead })}>Start now</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "reminderDue" })}>Remind me now (demo)</button>
            </div>
          </div>
        )}

        {t.step === "own-minutes" && (
          <Bubbles label="How many minutes">
            {[15, 30, 45, 60].map((m) => <button key={m} className="chip" onClick={() => dispatch({ type: "own", answer: { minutes: m } })}>{m} min</button>)}
          </Bubbles>
        )}
        {t.step === "own-confirm" && t.own && (
          <Bubbles label="Done or planned">
            <button className="chip chip-strong" onClick={() => dispatch({ type: "own", answer: "did" })}>I did it</button>
            <button className="chip" onClick={() => dispatch({ type: "own", answer: "plan" })}>It's my plan</button>
            {t.own.codes.slice(1).map((code) => {
              const row = state.tableActivities?.[code];
              return row ? <button key={code} className="chip" onClick={() => dispatch({ type: "own", answer: { code } })}>It's {row.label} ({fmt(row.met)} MET)</button> : null;
            })}
          </Bubbles>
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
              <button className="btn btn-primary" onClick={sync}>Sync Fitbit{demo}</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "decline" })}>Change of plans</button>
            </div>
            <ShowHow />
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
              <button className="chip" onClick={sync}>Sync another workout{demo}</button>
            </Bubbles>
          </div>
        )}
        {OTHER_PLACEHOLDER[t.step] && (t.step !== "confirm" || pending) && !typed.pending && (
          <OtherInput
            key={`${t.step}-${editing ? editing.count : ""}`}
            placeholder={OTHER_PLACEHOLDER[t.step]}
            label="Type your own answer"
            initial={editing?.text}
            onSubmit={(text) => void typed.submit(text)}
          />
        )}
        <div ref={end} />
      </div>
    </>
  );
}
