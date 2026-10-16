import { getFamily, getVariant } from "../lib/activities";
import { fmt, fmtGoal, type SessionWithCredit } from "../lib/met";

export interface StripPlanned {
  familyId: string;
  credit: number;
}

interface Props {
  done: SessionWithCredit[];
  planned?: StripPlanned[];
  goal: number;
  compact?: boolean;
  highlightId?: string | null;
  showScale?: boolean;
}

/**
 * The week as one strip, measured in MET-hours. Each workout is a segment in
 * its activity's color, as wide as the MET-hours it earned, so a vigorous
 * half hour is visibly bigger than an easy one. Unconfirmed Fitbit bouts are
 * hatched until the user confirms them; planned work is outlined.
 */
export function GoalStrip({ done, planned = [], goal, compact, highlightId, showScale = true }: Props) {
  const counted = done.filter((s) => s.credit > 0);
  const doneTotal = counted.reduce((a, s) => a + s.credit, 0);
  const plannedTotal = planned.reduce((a, s) => a + s.credit, 0);
  const scale = Math.max(goal, doneTotal + plannedTotal);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const label = `${fmt(doneTotal)} of ${fmtGoal(goal)} MET-hours done${plannedTotal ? `, ${fmt(plannedTotal)} planned` : ""}`;

  return (
    <div className="strip-wrap">
      <div className={`strip${compact ? " compact" : ""}`} role="img" aria-label={label}>
        {counted.map((s) => (
          <div
            key={s.id}
            className={`seg ${s.intensity}${s.confirmed ? "" : " unconfirmed"}${s.id === highlightId ? " new" : ""}`}
            style={{ flex: `0 0 ${pct(s.credit)}`, background: s.confirmed ? getFamily(s.familyId).color : undefined, ["--seg-color" as string]: getFamily(s.familyId).color }}
            title={`${getVariant(s.variantId).family.name}: ${s.durationMin} min = ${fmt(s.credit)} MET-hours${s.confirmed ? "" : " (unconfirmed)"}`}
          />
        ))}
        {planned.map((s, i) => (
          <div key={`p-${i}`} className="seg planned" style={{ flex: `0 0 ${pct(s.credit)}`, ["--seg-color" as string]: getFamily(s.familyId).color }} />
        ))}
      </div>
      {scale > goal && <div className="strip-over" style={{ left: pct(goal) }} aria-hidden />}
      {showScale && (
        <div className="strip-scale" aria-hidden>
          <span style={{ position: "absolute", left: 0 }}>0</span>
          <span style={{ position: "absolute", right: `${100 - (goal / scale) * 100}%`, whiteSpace: "nowrap" }}>{fmtGoal(goal)} MET-hour goal</span>
        </div>
      )}
    </div>
  );
}
