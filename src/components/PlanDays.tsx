/**
 * The weekly plan, one row per day with the time options (Off, 0, 5, 10, 30, 45+ min).
 * Used by onboarding's "Plan this week" and the Settings tab.
 */
import { DAY_NAMES_LONG } from "../lib/met";
import { SLOT_MINUTES, type DaySlot, type WeekPlan } from "../lib/plan";
import { TimeOptions } from "./TimeOptions";

export function PlanDays({ plan, onPick }: { plan: WeekPlan; onPick: (day: number, slot: DaySlot) => void }) {
  return (
    <ul className="plan-grid">
      {plan.map((slot, i) => (
        <li key={i}>
          <div className="plan-day">
            <b>{DAY_NAMES_LONG[i]}</b>
            {SLOT_MINUTES[slot] === 0 && <span className="xs muted">{slot === "off" ? "Day off" : "Desk moves only"}</span>}
          </div>
          <TimeOptions variant="slot" label={`${DAY_NAMES_LONG[i]} time`} value={slot} onPick={(s) => onPick(i, s)} />
        </li>
      ))}
    </ul>
  );
}
