import { DAY_NAMES } from "../lib/met";
import { MEDAL_LABEL, type Medal } from "../lib/medals";

const FILL: Record<Exclude<Medal, "none">, { face: string; rim: string; shine: string }> = {
  bronze: { face: "#B97A4A", rim: "#8A5530", shine: "#E3B48C" },
  silver: { face: "#A7AFC0", rim: "#737C90", shine: "#E4E8F0" },
  gold: { face: "#D9A624", rim: "#A87A0C", shine: "#F7DC8A" },
};

interface Props {
  medal: Medal;
  size?: number;
  /** Today with no medal yet: a dashed ring instead of an empty slot */
  pending?: boolean;
  /** A day that hasn't happened yet */
  future?: boolean;
  /** Planned off */
  off?: boolean;
  title?: string;
}

/** A coin: the one reward shape in the app. */
export function MedalCoin({ medal, size = 28, pending, future, off, title }: Props) {
  const label = title ?? (medal === "none" ? (pending ? "Today, no medal yet" : future ? "Coming up" : off ? "Off day, no activity" : "No activity") : MEDAL_LABEL[medal]);
  if (medal === "none") {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={label} className={`coin empty${pending ? " pending" : ""}`}>
        <circle cx="14" cy="14" r="11.5" fill="none" stroke={pending ? "var(--ink)" : "var(--line-strong)"} strokeWidth="1.5" strokeDasharray={pending ? "3 3" : future ? "1 3" : undefined} />
        {off && <path d="M9.5 14h9" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" />}
      </svg>
    );
  }
  const c = FILL[medal];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={label} className={`coin ${medal}`}>
      <circle cx="14" cy="14" r="13" fill={c.rim} />
      <circle cx="14" cy="14" r="10.5" fill={c.face} />
      <path d="M8 11a7 7 0 0 1 8-4.6" stroke={c.shine} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {medal === "gold" && <path d="M14 8.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill={c.shine} />}
      {medal === "silver" && <path d="M10 14.2l2.8 2.8 5.4-5.6" stroke={c.shine} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {medal === "bronze" && <circle cx="14" cy="14" r="2.6" fill={c.shine} />}
    </svg>
  );
}

/** Seven coins, Monday to Sunday, with day initials. */
export function WeekCoins({ medals, todayIndex, plan, size = 30, showToday = true }: { medals: Medal[]; todayIndex: number; plan?: string[]; size?: number; showToday?: boolean }) {
  return (
    <ol className="week-coins" aria-label="Medals this week">
      {medals.map((m, i) => (
        <li key={i} className={showToday && i === todayIndex ? "is-today" : undefined}>
          <MedalCoin medal={m} size={size} pending={showToday && i === todayIndex && m === "none"} future={i > todayIndex} off={plan?.[i] === "off"} />
          <span>{showToday && i === todayIndex ? "Today" : DAY_NAMES[i].slice(0, 2)}</span>
        </li>
      ))}
    </ol>
  );
}
