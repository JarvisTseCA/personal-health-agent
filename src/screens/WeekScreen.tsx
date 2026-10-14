import { useEffect, useState } from "react";
import { GoalStrip } from "../components/GoalStrip";
import { PlusIcon, SettingsIcon, SyncIcon } from "../components/Icons";
import { getVariant } from "../lib/activities";
import { DAY_NAMES, formatDuration } from "../lib/guideline";
import { useStore } from "../state/store";
import type { Screen } from "../state/types";
import { LogWorkoutSheet } from "./LogWorkoutSheet";
import { SettingsSheet } from "./SettingsSheet";

function weekLabel(todayIndex: number): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const day = new Date(monday);
  day.setDate(monday.getDate() + todayIndex);
  return day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function WeekScreen({ go }: { go: (s: Screen) => void }) {
  const { state, dispatch, ctx } = useStore();
  const [sheet, setSheet] = useState<null | "log" | "settings">(null);
  const [toast, setToast] = useState<{ text: string; undoId?: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [prevCount, setPrevCount] = useState(state.sessions.length);

  const { week } = ctx;
  const plan = ctx.chosenPlan;
  const planned = plan?.sessions ?? [];

  // When a workout is added, highlight it and say what changed.
  useEffect(() => {
    if (state.sessions.length > prevCount) {
      const s = week.sessions[week.sessions.length - 1];
      const { family } = getVariant(s.variantId);
      setHighlight(s.id);
      setToast({
        text: `${family.name}, ${s.durationMin} min added: +${s.credit} guideline min.${plan || ctx.options.length ? " Plan updated." : ""}`,
        undoId: s.id,
      });
      const t = setTimeout(() => setToast(null), 5000);
      setPrevCount(state.sessions.length);
      return () => clearTimeout(t);
    }
    setPrevCount(state.sessions.length);
  }, [state.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const gapMessage = (() => {
    if (week.remainingMinutes === 0) return `Goal met with ${week.doneMinutes} guideline minutes. Anything more this week is a bonus, and rest counts too.`;
    if (plan) {
      const next = plan.sessions.find((s) => s.dayIndex >= state.todayIndex);
      if (next) {
        const { family, variant } = getVariant(next.variantId);
        return `You're on the "${plan.title}" plan. Next: ${next.durationMin} min of ${family.noun} (${variant.label.toLowerCase()}) ${next.dayIndex === state.todayIndex ? "today" : `on ${DAY_NAMES[next.dayIndex]}`}.`;
      }
    }
    const best = ctx.options.find((o) => o.fits);
    if (best) return `You can close the ${week.remainingMinutes}-minute gap in ${formatDuration(best.clockMinutes)} of ${ctx.enjoyedNames.slice(0, 2).join(" and ")}. I found ${ctx.options.length} ways to do it.`;
    if (ctx.options.length) return `Your free time is tight this week. I found ways to get as close as possible.`;
    return "Add activities you enjoy in settings and I'll plan around them.";
  })();

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>This week</h1>
          <p className="sub">{weekLabel(state.todayIndex)}</p>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={() => setSheet("settings")}><SettingsIcon /></button>
      </div>

      <div className="hero-number">
        <span className="big num">{week.doneMinutes}</span>
        <span className="of">of 150 guideline min</span>
      </div>
      <GoalStrip done={week.sessions} planned={planned} highlightId={highlight} />

      <div className="facts">
        <div className="fact"><div className="v">{week.remainingMinutes} min</div><div className="k">left to earn</div></div>
        <div className="fact"><div className="v">{formatDuration(ctx.timeLeftMinutes)}</div><div className="k">of your free time left</div></div>
      </div>

      <div className="agent-card">
        <div className="agent-avatar" aria-hidden><i /></div>
        <div>
          <p>{gapMessage}</p>
          <div className="btn-row" style={{ gap: 8 }}>
            {week.remainingMinutes > 0 && (
              <button className="btn btn-primary" style={{ minHeight: 40, fontSize: 14 }} onClick={() => go("plan")}>
                {plan ? "Change plan" : "See options"}
              </button>
            )}
            <button className="btn btn-quiet" style={{ minHeight: 40, fontSize: 14 }} onClick={() => go("coach")}>Ask a question</button>
          </div>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-quiet" onClick={() => dispatch({ type: "syncFitbit" })}><SyncIcon className="i" />Sync Fitbit</button>
        <button className="btn btn-quiet" onClick={() => setSheet("log")}><PlusIcon />Log workout</button>
      </div>

      <section className="section">
        <h2>Day by day</h2>
        <ul className="days">
          {DAY_NAMES.map((d, i) => {
            const doneHere = week.sessions.filter((s) => s.dayIndex === i);
            const plannedHere = i >= state.todayIndex ? planned.filter((s) => s.dayIndex === i) : [];
            const cls = i === state.todayIndex ? "today" : i < state.todayIndex ? "past" : "";
            return (
              <li key={d} className={`day ${cls}`}>
                <div className="day-name">{i === state.todayIndex ? "Today" : d}</div>
                <div className="day-items">
                  {doneHere.map((s) => {
                    const { family, variant } = getVariant(s.variantId);
                    return (
                      <div className="item" key={s.id}>
                        <span className="dot" style={{ background: family.color }} />
                        <div className="what">
                          <b>{family.name}</b> {s.durationMin} min
                          <div className="meta">{variant.label}, {variant.met} MET{s.avgHeartRate ? `, avg ${s.avgHeartRate} bpm` : ""}{s.source === "fitbit" ? ", from Fitbit" : ""}</div>
                        </div>
                        {s.intensity === "vigorous" && <span className="tag x2">×2</span>}
                        <span className="credit">+{s.credit}</span>
                      </div>
                    );
                  })}
                  {plannedHere.map((s, k) => {
                    const { family, variant } = getVariant(s.variantId);
                    return (
                      <div className="item planned" key={`p${k}`}>
                        <span className="dot" />
                        <div className="what">
                          {family.name} {s.durationMin} min
                          <div className="meta">Planned, {variant.label.toLowerCase()}</div>
                        </div>
                        <span className="credit">+{s.credit}</span>
                      </div>
                    );
                  })}
                  {doneHere.length + plannedHere.length === 0 && (
                    <span className="day-empty">{i < state.todayIndex ? "Rest day" : i === state.todayIndex ? "Nothing yet" : "Open"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undoId && (
            <button onClick={() => { dispatch({ type: "removeSession", id: toast.undoId! }); setToast(null); }}>Undo</button>
          )}
        </div>
      )}
      {sheet === "log" && <LogWorkoutSheet onClose={() => setSheet(null)} />}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} />}
    </>
  );
}
