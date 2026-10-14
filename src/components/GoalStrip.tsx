import { getFamily, getVariant } from "../lib/activities";
import { WEEKLY_GOAL_MINUTES, type SessionWithCredit } from "../lib/guideline";
import type { PlannedSession } from "../lib/planner";

interface Props {
  done: SessionWithCredit[];
  planned?: PlannedSession[];
  goal?: number;
  compact?: boolean;
  highlightId?: string | null;
  showScale?: boolean;
}

/**
 * The week as one strip, measured in guideline minutes. Each workout is a
 * segment in its activity's color; vigorous segments are textured (they
 * count double, so they are twice as wide as their clock time). Planned
 * workouts appear hatched.
 */
export function GoalStrip({ done, planned = [], goal = WEEKLY_GOAL_MINUTES, compact, highlightId, showScale = true }: Props) {
  const doneTotal = done.reduce((a, s) => a + s.credit, 0);
  const plannedTotal = planned.reduce((a, s) => a + s.credit, 0);
  const scale = Math.max(goal, doneTotal + plannedTotal);
  const pct = (n: number) => `${(n / scale) * 100}%`;

  const label = `${doneTotal} of ${goal} guideline minutes done${plannedTotal ? `, ${plannedTotal} more planned` : ""}`;

  return (
    <div className="strip-wrap">
      <div className={`strip${compact ? " compact" : ""}`} role="img" aria-label={label}>
        {done.map((s) => (
          <div
            key={s.id}
            className={`seg ${s.intensity}${s.id === highlightId ? " new" : ""}`}
            style={{ flex: `0 0 ${pct(s.credit)}`, background: getFamily(s.familyId).color }}
            title={`${getVariant(s.variantId).family.name}: ${s.durationMin} min = ${s.credit} guideline min`}
          />
        ))}
        {planned.map((s, i) => (
          <div
            key={`p-${i}`}
            className="seg planned"
            style={{ flex: `0 0 ${pct(s.credit)}`, ["--seg-color" as string]: getFamily(s.familyId).color }}
          />
        ))}
      </div>
      {scale > goal && <div className="strip-over" style={{ left: pct(goal) }} aria-hidden />}
      {showScale && (
        <div className="strip-scale" aria-hidden>
          <span style={{ position: "absolute", left: 0 }}>0</span>
          <span style={{ position: "absolute", right: `${100 - (goal / scale) * 100}%`, whiteSpace: "nowrap" }}>{goal} min goal</span>
        </div>
      )}
    </div>
  );
}
