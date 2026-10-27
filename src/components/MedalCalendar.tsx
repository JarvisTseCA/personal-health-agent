import { DAY_NAMES_LONG, fmt, fmtGoal } from "../lib/met";
import { MEDAL_LABEL } from "../lib/medals";
import { weekMonth, type WeekIn } from "../lib/periods";
import { MedalCoin } from "./Medal";

interface Props {
  /** Oldest first: the calendar reads top to bottom */
  weeks: WeekIn[];
  /** Monthly view: day numbers in each cell, days outside this month dimmed */
  month?: { year: number; month: number };
  /** Quarterly view: a month name above each month's first week */
  monthLabels?: boolean;
  size?: number;
}

const EPS = 1e-9;
const HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const dayOf = (start: Date, i: number) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; };
const short = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Past weeks as a calendar: one row per week, Monday to Sunday, a medal for
 * each day with activity and an empty circle for each day without (a dash
 * on a planned day off). A week that reached its goal is highlighted gold.
 */
export function MedalCalendar({ weeks, month, monthLabels, size = 24 }: Props) {
  const dates = !!month;
  let lastMonth = "";
  return (
    <div className={`cal${dates ? " with-dates" : ""}`}>
      <div className="cal-head" aria-hidden>
        {!dates && <span className="cal-week" />}
        {HEAD.map((d) => <span key={d}>{d}</span>)}
        <span className="cal-total">MET-h</span>
      </div>
      <ol className="cal-rows">
        {weeks.map((w) => {
          const met = w.done + EPS >= w.goal;
          const m = weekMonth(w.start);
          const mKey = `${m.year}-${m.month}`;
          const header = monthLabels && mKey !== lastMonth
            ? new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: "long" })
            : null;
          lastMonth = mKey;
          const label = `Week of ${w.label}: ${fmt(w.done)} of ${fmtGoal(w.goal)} MET-hours${met ? ", goal reached" : ""}`;
          return (
            <li key={w.start.getTime()} className="cal-item">
              {header && <span className="cal-month">{header}</span>}
              <div className={`cal-row${met ? " is-gold" : ""}`} role="group" aria-label={label}>
                {!dates && <span className="cal-week">{w.label}</span>}
                {w.medals.map((medal, i) => {
                  const d = dayOf(w.start, i);
                  const outside = month && (d.getMonth() !== month.month || d.getFullYear() !== month.year);
                  const off = w.plan?.[i] === "off";
                  const what = medal === "none" ? (off ? "day off" : "no activity") : MEDAL_LABEL[medal].toLowerCase();
                  return (
                    <span key={i} className={`cal-day${outside ? " outside" : ""}`}>
                      <MedalCoin medal={medal} size={size} off={off} title={`${DAY_NAMES_LONG[i]} ${short(d)}: ${what}`} />
                      {dates && <i>{d.getDate()}</i>}
                    </span>
                  );
                })}
                <span className="cal-total num">{fmt(w.done)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CalendarKey() {
  return (
    <p className="cal-key xs muted">
      <span className="cal-key-gold" aria-hidden /> Weekly goal reached
      <span className="cal-key-sep" aria-hidden>·</span>
      <MedalCoin medal="none" size={14} title="Empty circle" /> No activity
      <span className="cal-key-sep" aria-hidden>·</span>
      <MedalCoin medal="none" size={14} off title="Circle with a dash" /> Day off
    </p>
  );
}
