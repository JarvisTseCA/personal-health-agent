import { fmt, fmtGoal } from "../lib/met";

interface Props {
  /** MET-hours earned on each day of the week (Mon = 0). */
  doneByDay: number[];
  todayIndex: number;
  todayTarget: number;
  goal: number;
}

/**
 * The week on the Today card, read left to right: what's done on past days
 * (green), then today (green for done, amber for what's left of today's
 * target), then what the coming days still need to cover (gray). Gaps
 * separate past, today and the coming days so today stands on its own.
 */
export function WeekBar({ doneByDay, todayIndex, todayTarget, goal }: Props) {
  const past = doneByDay.slice(0, todayIndex).reduce((a, b) => a + b, 0);
  const todayDone = doneByDay[todayIndex] ?? 0;
  const todayLeft = Math.max(0, todayTarget - todayDone);
  const upcoming = Math.max(0, goal - past - todayDone - todayLeft);

  const label =
    `${fmt(past)} MET-hours done on past days. Today: ${fmt(todayDone)} done, ${fmt(todayLeft)} left. ` +
    `${fmt(upcoming)} left for the coming days, of a ${fmtGoal(goal)} MET-hour goal.`;

  return (
    <div className="week-bar" role="img" aria-label={label}>
      {past > 0 && (
        // Every past day's MET-hours as one block: the week so far, not day by day.
        <div className="wb-group" style={{ flexGrow: past }}>
          <span className="wb-done" style={{ flexGrow: 1 }} />
        </div>
      )}
      {todayDone + todayLeft > 0 && (
        <div className="wb-group wb-today" style={{ flexGrow: todayDone + todayLeft }}>
          {todayDone > 0 && <span className="wb-done" style={{ flexGrow: todayDone }} />}
          {todayLeft > 0 && <span className="wb-left" style={{ flexGrow: todayLeft }} />}
        </div>
      )}
      {upcoming > 0 && <div className="wb-group wb-upcoming" style={{ flexGrow: upcoming }} />}
    </div>
  );
}

/** Today's target on its own: green for done, amber for what's left. */
export function TodayBar({ done, target }: { done: number; target: number }) {
  const left = Math.max(0, target - done);
  return (
    <div className="week-bar" role="img" aria-label={`${fmt(done)} of ${fmt(target)} MET-hours today, ${fmt(left)} left`}>
      <div className="wb-group" style={{ flexGrow: 1 }}>
        {done > 0 && <span className="wb-done" style={{ flexGrow: done }} />}
        {left > 0 && <span className="wb-left" style={{ flexGrow: left }} />}
        {done === 0 && left === 0 && <span className="wb-empty" style={{ flexGrow: 1 }} />}
      </div>
    </div>
  );
}

export function WeekLegend() {
  return (
    <ul className="wb-legend" aria-label="What the bar colors mean">
      <li><span className="wb-swatch wb-done" aria-hidden />Done</li>
      <li><span className="wb-swatch wb-left" aria-hidden />Left for today</li>
      <li><span className="wb-swatch wb-upcoming" aria-hidden />Upcoming days</li>
    </ul>
  );
}

interface BarsProps {
  doneByDay: number[];
  todayIndex: number;
  todayTarget: number;
  todayDone: number;
  weekDone: number;
  goal: number;
  /** Today is marked off with nothing left to do */
  todayOff: boolean;
}

/** The two bars as they appear on Today and Progress: this week, then today. */
export function WeekBars({ doneByDay, todayIndex, todayTarget, todayDone, weekDone, goal, todayOff }: BarsProps) {
  return (
    <div className="summary-lines">
      <div className="summary-line">
        <span className="k">This week</span>
        <WeekBar doneByDay={doneByDay} todayIndex={todayIndex} todayTarget={todayTarget} goal={goal} />
        <span className="v num">{fmt(weekDone)}<small>/{fmtGoal(goal)}</small></span>
      </div>
      <div className="summary-line">
        <span className="k">Today</span>
        <TodayBar done={todayDone} target={todayTarget} />
        {todayOff
          ? <span className="v num">{fmt(todayDone)}<small> off</small></span>
          : <span className="v num">{fmt(todayDone)}<small>/{fmt(todayTarget)}</small></span>}
      </div>
    </div>
  );
}
