import { SLOT_HINT, SLOT_LABEL, SLOT_ROWS, type DaySlot } from "../lib/plan";

interface Props {
  /** Accessible name for the group, e.g. "Time today" */
  label: string;
  onPick: (slot: DaySlot) => void;
  /** The current choice, for pickers that keep one (Progress, onboarding) */
  value?: DaySlot;
  /** "chip": Today's answer bubbles, right-aligned. "slot": a day's picker, left-aligned. */
  variant?: "chip" | "slot";
}

/**
 * The time options, laid out the same everywhere:
 *   Off
 *   0 min  5 min  10 min  30 min
 *   45+ min
 */
export function TimeOptions({ label, onPick, value, variant = "chip" }: Props) {
  const picker = value !== undefined;
  return (
    <div className={`opt-rows is-${variant}`} role={picker ? "radiogroup" : "group"} aria-label={label}>
      {SLOT_ROWS.map((row) => (
        <div className="opt-row" key={row.join()}>
          {row.map((s) => (
            <button
              key={s}
              type="button"
              className={variant}
              role={picker ? "radio" : undefined}
              aria-checked={picker ? value === s : undefined}
              title={SLOT_HINT[s]}
              onClick={() => onPick(s)}
            >
              {SLOT_LABEL[s]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
