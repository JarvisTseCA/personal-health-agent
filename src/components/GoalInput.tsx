/**
 * The weekly MET-hour goal, in Settings and onboarding's "Plan this week": − / + by 0.5, or type a
 * number. Beside it, who set it and when (and for the agent's offers, why): see lib/goalNote.ts.
 */
import { useEffect, useId, useState } from "react";
import { clampGoal } from "../lib/goalNote";
import { fmtGoal } from "../lib/met";

interface Props {
  goal: number;
  note: string;
  onChange: (to: number) => void;
}

export function GoalInput({ goal, note, onChange }: Props) {
  const id = useId();
  const [text, setText] = useState(fmtGoal(goal));
  useEffect(() => setText(fmtGoal(goal)), [goal]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && clampGoal(n) !== goal) onChange(clampGoal(n));
    else setText(fmtGoal(goal));
  };
  const minutes = Math.round((goal / 3) * 60);
  return (
    <div className="goal-input">
      <div className="goal-row">
        <button className="step-btn" aria-label="Lower the goal by 0.5" disabled={goal <= 1} onClick={() => onChange(clampGoal(goal - 0.5))}>−</button>
        <label className="sr-only" htmlFor={id}>Weekly goal in MET-hours</label>
        <input
          id={id} className="goal-number num" inputMode="decimal" value={text}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        <button className="step-btn" aria-label="Raise the goal by 0.5" disabled={goal >= 30} onClick={() => onChange(clampGoal(goal + 0.5))}>+</button>
        <span className="small">MET-hours a week</span>
      </div>
      <p className="xs muted goal-equiv">About {minutes} min of moderate activity (3 MET), or half that if vigorous.</p>
      <p className="small goal-note" role="status">{note}</p>
    </div>
  );
}
