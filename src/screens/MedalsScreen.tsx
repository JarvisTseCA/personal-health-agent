import { MedalCoin, WeekCoins } from "../components/Medal";
import { fmt, fmtGoal } from "../lib/met";
import { useStore } from "../state/store";

export function MedalsScreen() {
  const { state, ctx } = useStore();
  const { streak } = ctx;
  const weeks = [
    { key: "now", label: "This week", medals: ctx.medals, done: ctx.week.done, goal: ctx.goal, gold: ctx.week.done + 1e-9 >= ctx.goal, current: true },
    ...[...ctx.past].reverse().map((w, i) => ({ key: `w${i}`, label: `Week of ${w.label}`, medals: w.medals, done: w.totals.done, goal: w.goal, gold: w.gold, current: false })),
  ];

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Medals</h1>
          <p className="sub">Every day you move earns a medal</p>
        </div>
      </div>

      <section className="streak-hero" aria-label="Streak">
        <div>
          <span className="streak-big num">{streak.current}</span>
          <span className="streak-unit">{streak.current === 1 ? "day" : "days"} in a row</span>
        </div>
        <p className="small muted">
          {streak.todayPending
            ? "Today has no medal yet. Any activity, even a short walk, keeps the streak going."
            : "Today's medal is in."}{" "}
          Best: {streak.best} days.
        </p>
      </section>

      <ul className="legend" aria-label="How medals work">
        <li><MedalCoin medal="bronze" size={34} /><div><b>Bronze</b><span>Any activity that day, light included</span></div></li>
        <li><MedalCoin medal="silver" size={34} /><div><b>Silver</b><span>The day's target reached</span></div></li>
        <li><MedalCoin medal="gold" size={34} /><div><b>Gold</b><span>Weekly goal reached: the whole week turns gold</span></div></li>
      </ul>

      <section className="section">
        <h2>By week</h2>
        <ul className="week-list">
          {weeks.map((w) => (
            <li key={w.key} className={w.gold ? "is-gold" : undefined}>
              <div className="week-list-head">
                <b>{w.label}</b>
                <span className="small"><span className="num">{fmt(w.done)}</span><span className="muted"> of {fmtGoal(w.goal)} MET-hours</span></span>
              </div>
              <WeekCoins medals={w.medals} todayIndex={w.current ? state.todayIndex : 7} plan={w.current ? state.plan : undefined} size={32} showToday={w.current} />
            </li>
          ))}
        </ul>
        <p className="xs muted" style={{ marginTop: 12 }}>A day with no activity ends the streak, even a planned day off.</p>
      </section>
    </>
  );
}
