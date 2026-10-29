import { DAY_NAMES_LONG, fmt, fmtGoal } from "../lib/met";
import type { WeekIn } from "../lib/periods";
import { trophyEarned } from "../lib/rewards";

/**
 * The app's two rewards, drawn the same way everywhere:
 *  the flame (days in a row the app was opened) and
 *  the trophy (a week that reached its goal).
 * Nothing here shows a miss: a day without a sign-in is just a quiet dot.
 */

export function Flame({ size = 20, lit = true, title }: { size?: number; lit?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={`flame${lit ? " lit" : ""}`}>
      <path
        d="M12.4 2.5c.4 3-1.1 4.6-2.6 6.2C8.2 10.4 6.5 12.2 6.5 15a5.5 5.5 0 0 0 11 0c0-2.1-.9-3.7-1.9-5-.3 1.2-.9 2.1-1.9 2.6.4-3.5-.3-7.3-1.3-10.1z"
        fill={lit ? "var(--flame)" : "none"}
        stroke={lit ? "var(--flame-deep)" : "var(--line-strong)"}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {lit && <path d="M12 21a2.8 2.8 0 0 1-2.8-2.8c0-1.6 1.2-2.5 2-3.5.3 1 .9 1.6 1.7 1.9.3-.4.5-.9.6-1.5.8.9 1.3 1.9 1.3 3.1A2.8 2.8 0 0 1 12 21z" fill="var(--flame-core)" />}
    </svg>
  );
}

export function Trophy({ size = 22, earned = true, title }: { size?: number; earned?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={`trophy${earned ? " earned" : ""}`}>
      <path d="M7.5 3.5h9v5.5a4.5 4.5 0 0 1-9 0z" fill={earned ? "var(--trophy)" : "none"} stroke={earned ? "var(--trophy-deep)" : "var(--line-strong)"} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.5 5.5H5a3 3 0 0 0 3.2 4.3M16.5 5.5H19a3 3 0 0 1-3.2 4.3" fill="none" stroke={earned ? "var(--trophy-deep)" : "var(--line-strong)"} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12 13.5v3.5" stroke={earned ? "var(--trophy-deep)" : "var(--line-strong)"} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8" y="17.5" width="8" height="3" rx="1" fill={earned ? "var(--trophy-deep)" : "none"} stroke={earned ? "none" : "var(--line-strong)"} strokeWidth="1.4" />
      {earned && <path d="M10 5.6a3 3 0 0 0 .2 3.4" stroke="#FFF3C4" strokeWidth="1.3" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

const HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const dayOf = (start: Date, i: number) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; };
const short = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Past weeks, one month at a time: a row per week. Each day the app was
 * opened shows a flame, and days in a row are joined into one band so
 * streaks read at a glance. Weeks that reached their goal end in a trophy.
 * Days the app wasn't opened are plain dots: nothing marks them as missed.
 */
export function RewardCalendar({ weeks, month }: { weeks: WeekIn[]; month: { year: number; month: number } }) {
  return (
    <div className="rcal">
      <div className="rcal-head" aria-hidden>
        {HEAD.map((d) => <span key={d}>{d}</span>)}
        <span className="rcal-total">MET-h</span>
      </div>
      <ol className="rcal-rows">
        {weeks.map((w) => {
          const won = trophyEarned(w.done, w.goal);
          const label = `Week of ${w.label}: opened the app on ${w.signIns.filter(Boolean).length} days, ${fmt(w.done)} of ${fmtGoal(w.goal)} MET-hours${won ? ", trophy earned" : ""}`;
          return (
            <li key={w.start.getTime()} className={`rcal-row${won ? " has-trophy" : ""}`} aria-label={label}>
              {w.signIns.map((on, i) => {
                const d = dayOf(w.start, i);
                const outside = d.getMonth() !== month.month || d.getFullYear() !== month.year;
                const prev = i > 0 && w.signIns[i - 1];
                const next = i < 6 && w.signIns[i + 1];
                const band = on ? (prev && next ? " band-mid" : prev ? " band-end" : next ? " band-start" : " band-solo") : "";
                return (
                  <span key={i} className={`rcal-day${band}${outside ? " outside" : ""}`} title={`${DAY_NAMES_LONG[i]} ${short(d)}${on ? ": opened the app" : ""}${w.active[i] ? ", active" : ""}`}>
                    {on ? <Flame size={16} /> : <i className="rcal-dot" aria-hidden />}
                    <em>{d.getDate()}</em>
                  </span>
                );
              })}
              <span className="rcal-total">
                {won && <Trophy size={18} title="Trophy" />}
                <span className="num">{fmt(w.done)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RewardKey() {
  return (
    <p className="rcal-key xs muted">
      <Flame size={14} /> Opened the app
      <span className="rcal-key-band" aria-hidden /> Days in a row
      <Trophy size={14} /> Weekly goal reached
    </p>
  );
}
