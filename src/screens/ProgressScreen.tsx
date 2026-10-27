/**
 * Progress tab: one place to see how activity adds up.
 * Top to bottom: this week (total, streak, day-by-day plan and workouts),
 * last week's recap with the goal offer, earlier weeks, and the medal rules.
 */
import { useState } from "react";
import { TimeOptions } from "../components/TimeOptions";
import { WeekBars, WeekLegend } from "../components/WeekBar";
import { PlusIcon } from "../components/Icons";
import { MedalCoin, WeekCoins } from "../components/Medal";
import { OtherInput } from "../components/OtherInput";
import { getFamily, getVariant } from "../lib/activities";
import { parsePlanChanges } from "../lib/freeText";
import { RAISE_STEP } from "../lib/goal";
import { DAY_NAMES_LONG, fmt, fmtGoal } from "../lib/met";
import { SLOT_HINT, SLOT_LABEL, SLOT_MINUTES } from "../lib/plan";
import { useStore } from "../state/store";
import { groupWeeks, type Period, type PeriodView } from "../lib/periods";
import { weekStart } from "../services/context";
import { LogWorkoutSheet } from "./LogWorkoutSheet";

export function ProgressScreen() {
  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Progress</h1>
          <p className="sub">How your activity adds up, week by week</p>
        </div>
      </div>
      <ThisWeek />
      <LastWeek />
      <EarlierWeeks />
      <MedalRules />
    </>
  );
}

/** This week: total, streak, and the day-by-day plan (what used to be the Week tab). */
function ThisWeek() {
  const { state, ctx, dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [log, setLog] = useState(false);
  const t = state.todayIndex;
  const [hint, setHint] = useState<string | null>(null);
  const { streak } = ctx;

  const typedPlan = (text: string) => {
    const changes = parsePlanChanges(text);
    const days = Object.keys(changes).map(Number).filter((d) => d >= t);
    if (!days.length) {
      dispatch({ type: "addNote", text, where: "Progress: plan" });
      setHint('Noted. To change a day, try something like "Thursday off, Saturday 45 min".');
      return;
    }
    for (const d of days) dispatch({ type: "setSlot", day: d, slot: changes[d] });
    setHint(`Updated ${days.map((d) => `${DAY_NAMES_LONG[d]} to ${SLOT_LABEL[changes[d]]}`).join(", ")}. The rest of the goal is re-split.`);
  };

  const goalNote =
    ctx.goalBy === "clinician" ? "Set by your clinician"
    : ctx.steppingStone ? "A stepping stone back to the 7.5 guideline"
    : ctx.goal > 7.5 ? "Raised after strong weeks"
    : "The activity guideline: 150 min moderate or 75 vigorous";
  const reached = ctx.week.done + 1e-9 >= ctx.goal;

  return (
    <>
      <div className="pg-week-head">
        <h2>This week</h2>
        <p className="xs muted">{goalNote}</p>
      </div>

      <div className="hero-number">
        <span className="big num">{fmt(ctx.week.done)}</span>
        <span className="of">of {fmtGoal(ctx.goal)} MET-hours</span>
      </div>
      <div className="pg-bars">
        <WeekLegend />
        <WeekBars
          doneByDay={ctx.week.doneByDay} todayIndex={t} todayTarget={ctx.todayTarget} todayDone={ctx.todayDone}
          weekDone={ctx.week.done} goal={ctx.goal} todayOff={state.plan[t] === "off" && ctx.todayTarget === 0}
        />
      </div>

      <p className="pg-streak">
        {reached ? "Goal reached. Every medal this week turns gold." : `${Math.round((ctx.week.done / ctx.goal) * 100)}% done, ${fmt(ctx.left)} MET-hours to go.`}
        <span style={{ display: "block", marginTop: 4 }}>
          <b className="num">{streak.current}</b>{streak.current === 1 ? " day" : " days"} in a row
          <span className="muted"> · best {streak.best}</span>
          {streak.todayPending && <span className="xs muted">. Any activity today keeps it going.</span>}
        </span>
      </p>

      {ctx.unplanned > 0.05 && (
        <p className="note" style={{ marginTop: 16 }}>
          {fmt(ctx.unplanned)} MET-hours have no day left to go on. Add a day back to fit them in; the weekly goal stays the same.
        </p>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Day by day</h2>
          <button className={`btn small-btn ${editing ? "btn-primary" : "btn-quiet"}`} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Update my goals"}
          </button>
        </div>
        {editing && (
          <p className="small muted plan-help">
            Mark days you can't exercise as Off, and pick how much time you have on the others (0 min means desk moves only). What's left of the goal is split over the days by their time, so changing a day re-plans the rest.
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
                        {slot === "off" ? <span className="muted">Off</span> : SLOT_MINUTES[slot] === 0 && ctx.targets[i] === 0 && ctx.week.doneByDay[i] === 0 ? <span className="muted">Desk moves</span> : <><span className="num">{fmt(ctx.week.doneByDay[i])}</span><span className="muted"> of {fmt(ctx.targets[i])}</span></>}
                      </span>
                    )}
                  </div>
                  {editing && !past ? (
                    <div className="slot-pick">
                      <TimeOptions variant="slot" label={`${DAY_NAMES_LONG[i]} time`} value={slot} onPick={(s) => dispatch({ type: "setSlot", day: i, slot: s })} />
                      <span className="xs muted">
                        {slot === "off" ? "Day off: no target" : SLOT_MINUTES[slot] === 0 ? "Desk moves only: no target" : ctx.left <= 0 ? "Goal met" : `Target: ${fmt(ctx.targets[i])} MET-hours`}
                      </span>
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
                          <b>{s.customName ?? family.name}</b> {s.durationMin} min
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
        {editing && <OtherInput placeholder="Other: e.g. Thu off, Sat 45 min" onSubmit={typedPlan} hint={hint} />}
      </section>

      <button className="btn btn-quiet btn-block" style={{ marginTop: 8 }} onClick={() => setLog(true)}><PlusIcon />Log a workout Fitbit missed</button>
      <p className="xs muted" style={{ marginTop: 14 }}>
        MET-hours = MET value × minutes ÷ 60, with MET values from the 2024 Adult Compendium of Physical Activities. 7.5 MET-hours equals 150 minutes at 3 MET or 75 minutes at 6 MET.
      </p>
      {log && <LogWorkoutSheet onClose={() => setLog(false)} />}
    </>
  );
}

/** Last week's recap (what used to be the weekly recap sheet), with the goal offer. */
function LastWeek() {
  const { state, ctx, dispatch } = useStore();
  const last = ctx.past.at(-1);
  const offer = ctx.offer;
  const [hint, setHint] = useState<string | null>(null);

  /** A typed goal: a number sets it; "keep" keeps it; anything else is noted. */
  const typedGoal = (text: string) => {
    const n = text.match(/(\d+(?:\.\d+)?)/);
    if (n) {
      const to = Math.min(30, Math.max(1, parseFloat(n[1])));
      dispatch({ type: "acceptGoal", to });
      return;
    }
    if (/\b(keep|same|stay|no change)\b/i.test(text)) { dispatch({ type: "keepGoal" }); return; }
    dispatch({ type: "addNote", text, where: "Progress: goal" });
    setHint("Noted. Type a number of MET-hours to set your own goal, like 6.");
  };

  if (!last) {
    return (
      <section className="section">
        <h2>Last week</h2>
        <p className="small muted">Your first recap arrives on Sunday, after your first full week.</p>
      </section>
    );
  }

  const minutesBy = new Map<string, number>();
  for (const s of last.totals.sessions) minutesBy.set(s.familyId, (minutesBy.get(s.familyId) ?? 0) + s.durationMin);
  const top = [...minutesBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const activeDays = last.totals.activeByDay.filter(Boolean).length;
  const praise = last.gold
    ? `A gold week: ${Math.round((last.totals.done / last.goal) * 100)}% of your goal.`
    : activeDays >= 5
      ? `You moved on ${activeDays} days. That consistency is what builds the habit.`
      : "Every one of those MET-hours counted.";

  return (
    <section className="section">
      <h2>Last week</h2>
      <div className={`pg-card${last.gold ? " is-gold" : ""}`}>
        <div className="pg-card-head">
          <b>Week of {last.label}</b>
          <span className="small"><span className="num" style={{ fontWeight: 700 }}>{fmt(last.totals.done)}</span><span className="muted"> of {fmtGoal(last.goal)}</span></span>
        </div>
        <WeekCoins medals={last.medals} todayIndex={7} size={30} showToday={false} />
        <p className="small" style={{ marginTop: 10 }}>{praise}</p>
        {top && <p className="xs muted" style={{ marginTop: 2 }}>Most time on {getFamily(top[0]).noun}: {top[1]} min.</p>}
      </div>

      <div className={`goal-offer ${offer.kind}`} style={{ marginTop: 12 }}>
        {state.recapHandled ? (
          <>
            <b>Your goal this week: {fmtGoal(ctx.goal)} MET-hours</b>
            <p className="small muted">{ctx.steppingStone ? "A stepping stone; the guideline is still 7.5." : "Saved."}</p>
          </>
        ) : offer.kind === "keep" ? (
          <>
            <b>Keep your goal at {fmtGoal(offer.from)}</b>
            <p className="small muted">{offer.reason}</p>
          </>
        ) : (
          <>
            <b>{offer.kind === "raise" ? "Ready for more?" : "Want an easier goal for now?"}</b>
            <p className="small">{offer.reason} I'd suggest {fmtGoal(offer.to)} MET-hours{offer.kind === "lower" ? ", a stepping stone back to 7.5" : ""}.</p>
            <p className="xs muted">
              {offer.kind === "raise"
                ? `Rule: the lower of your last 2 weeks, rounded down to a multiple of ${RAISE_STEP}.`
                : "Rule: under half the goal 3 weeks in a row → half the goal."}
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => dispatch({ type: "acceptGoal", to: offer.to })}>Change to {fmtGoal(offer.to)}</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "keepGoal" })}>Keep {fmtGoal(offer.from)}</button>
            </div>
            <OtherInput placeholder="Other: e.g. make it 6" onSubmit={typedGoal} hint={hint} />
          </>
        )}
      </div>
    </section>
  );
}

const VIEWS: Array<[PeriodView, string]> = [["week", "Weekly"], ["month", "Monthly"], ["quarter", "Quarterly"]];
const WEEKS_SHOWN = 6;

/**
 * Earlier weeks, newest first, switchable between weeks, months and
 * 4-month periods. Weekly lists every week before last as a row of medals;
 * the other views roll all past weeks (last week included) into one card each.
 */
function EarlierWeeks() {
  const { ctx } = useStore();
  const [view, setView] = useState<PeriodView>("week");
  const [all, setAll] = useState(false);
  if (!ctx.past.length) return null;

  const weeks = ctx.past.slice(0, -1).reverse();
  const periods = view === "week" ? [] : groupWeeks(
    ctx.past.map((w) => ({ start: w.start, label: w.label, done: w.totals.done, goal: w.goal, medals: w.medals })),
    view,
    weekStart(0),
  );

  return (
    <section className="section">
      <h2>Earlier weeks</h2>
      <div className="seg-toggle three" role="group" aria-label="Group by">
        {VIEWS.map(([v, label]) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
        ))}
      </div>

      {view === "week" ? (
        weeks.length === 0 ? <p className="small muted" style={{ marginTop: 12 }}>Only last week so far; it's shown above.</p> : (
          <>
            <ul className="week-list" style={{ marginTop: 12 }}>
              {(all ? weeks : weeks.slice(0, WEEKS_SHOWN)).map((w) => (
                <li key={w.label} className={w.gold ? "is-gold" : undefined}>
                  <div className="week-list-head">
                    <b>Week of {w.label}</b>
                    <span className="small"><span className="num">{fmt(w.totals.done)}</span><span className="muted"> of {fmtGoal(w.goal)}</span></span>
                  </div>
                  <WeekCoins medals={w.medals} todayIndex={7} size={26} showToday={false} />
                </li>
              ))}
            </ul>
            {weeks.length > WEEKS_SHOWN && (
              <button className="btn btn-ghost btn-block" onClick={() => setAll((a) => !a)}>
                {all ? "Show fewer weeks" : `Show all ${weeks.length} weeks`}
              </button>
            )}
          </>
        )
      ) : (
        <ul className="week-list" style={{ marginTop: 12 }}>
          {periods.map((p) => <PeriodCard key={p.key} p={p} />)}
        </ul>
      )}
    </section>
  );
}

/** One month or 4-month period: total against the summed goals, gold weeks, a bar per week, medal counts. */
function PeriodCard({ p }: { p: Period }) {
  const allGold = p.goldWeeks === p.weeks.length;
  const top = Math.max(1.5, ...p.weeks.map((w) => (w.goal > 0 ? w.done / w.goal : 0)));
  const ordered = [...p.weeks].sort((a, b) => a.start.getTime() - b.start.getTime());
  return (
    <li className={allGold ? "is-gold" : undefined}>
      <div className="week-list-head">
        <b>{p.label}{p.partial && <span className="muted" style={{ fontWeight: 400 }}> · so far</span>}</b>
        <span className="small"><span className="num">{fmt(p.done)}</span><span className="muted"> of {fmtGoal(p.goal)}</span></span>
      </div>
      <p className="xs muted">
        {p.goldWeeks} of {p.weeks.length} {p.weeks.length === 1 ? "week" : "weeks"} gold · {p.activeDays} active {p.activeDays === 1 ? "day" : "days"}
      </p>
      <div className="period-bars" role="img" aria-label={ordered.map((w) => `Week of ${w.label}: ${fmt(w.done)} of ${fmtGoal(w.goal)}`).join("; ")}>
        {ordered.map((w) => (
          <span key={w.label} className={w.done + 1e-9 >= w.goal ? "met" : undefined} style={{ height: `${Math.max(6, (Math.min(w.done / w.goal, top) / top) * 100)}%` }} />
        ))}
        <i className="period-goal" style={{ bottom: `${(1 / top) * 100}%` }} aria-hidden />
      </div>
      <div className="period-medals">
        {(["gold", "silver", "bronze"] as const).map((m) => (
          <span key={m}><MedalCoin medal={m} size={20} /> <b className="num">{p.medals[m]}</b> <span className="xs muted">{m}</span></span>
        ))}
      </div>
    </li>
  );
}

function MedalRules() {
  return (
    <section className="section">
      <h2>How medals work</h2>
      <ul className="legend" style={{ marginTop: 0 }} aria-label="How medals work">
        <li><MedalCoin medal="bronze" size={30} /><div><b>Bronze</b><span>Any activity that day, light included</span></div></li>
        <li><MedalCoin medal="silver" size={30} /><div><b>Silver</b><span>The day's target reached</span></div></li>
        <li><MedalCoin medal="gold" size={30} /><div><b>Gold</b><span>Weekly goal reached: the whole week turns gold</span></div></li>
      </ul>
      <p className="xs muted" style={{ marginTop: 12 }}>A day with no activity ends the streak, even a planned day off.</p>
    </section>
  );
}
