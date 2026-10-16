import { useState } from "react";
import { OtherInput } from "../components/OtherInput";
import { Sheet } from "../components/Sheet";
import { WeekCoins } from "../components/Medal";
import { getFamily } from "../lib/activities";
import { RAISE_STEP } from "../lib/goal";
import { fmt, fmtGoal } from "../lib/met";
import { useStore } from "../state/store";

export function RecapSheet({ onClose, onPlan }: { onClose: () => void; onPlan: () => void }) {
  const { state, ctx, dispatch } = useStore();
  const last = ctx.past.at(-1);
  const offer = ctx.offer;
  const [hint, setHint] = useState<string | null>(null);

  /** A typed goal: a number sets it; "keep" keeps it; anything else is noted. */
  const typedGoal = (text: string) => {
    const n = text.match(/(\d+(?:\.\d+)?)/);
    if (n) {
      const to = Math.min(30, Math.max(1, parseFloat(n[1])));
      dispatch({ type: "acceptGoal", to });
      return;
    }
    if (/\b(keep|same|stay|no change)\b/i.test(text)) { dispatch({ type: "keepGoal" }); return; }
    dispatch({ type: "addNote", text, where: "Recap: goal" });
    setHint("Noted. Type a number of MET-hours to set your own goal, like 6.");
  };

  if (!last) {
    return (
      <Sheet title="Weekly recap" onClose={onClose}>
        <h2>Weekly recap</h2>
        <p className="muted small" style={{ marginTop: 8 }}>Your first recap arrives on Sunday, after your first full week.</p>
        <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={onClose}>Done</button>
      </Sheet>
    );
  }

  const minutesBy = new Map<string, number>();
  for (const s of last.totals.sessions) minutesBy.set(s.familyId, (minutesBy.get(s.familyId) ?? 0) + s.durationMin);
  const top = [...minutesBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const activeDays = last.totals.activeByDay.filter(Boolean).length;
  const praise = last.gold
    ? `A gold week: ${fmt(last.totals.done)} MET-hours, ${Math.round((last.totals.done / last.goal) * 100)}% of your goal.`
    : activeDays >= 5
      ? `You moved on ${activeDays} days. That consistency is what builds the habit.`
      : `${fmt(last.totals.done)} MET-hours. Every one of those counted.`;

  return (
    <Sheet title="Weekly recap" onClose={onClose}>
      <h2>Last week</h2>
      <p className="muted small">Week of {last.label}</p>

      <div className="recap-number">
        <span className="big num">{fmt(last.totals.done)}</span>
        <span className="of">of {fmtGoal(last.goal)} MET-hours</span>
      </div>
      <WeekCoins medals={last.medals} todayIndex={7} size={32} showToday={false} />
      <p style={{ marginTop: 14 }}>{praise}</p>
      {top && <p className="small muted" style={{ marginTop: 4 }}>Most time on {getFamily(top[0]).noun}: {top[1]} min.</p>}

      <div className={`goal-offer ${offer.kind}`}>
        {state.recapHandled ? (
          <>
            <b>Your goal this week: {fmtGoal(ctx.goal)} MET-hours</b>
            <p className="small muted">{ctx.steppingStone ? "A stepping stone; the guideline is still 7.5." : "Saved."}</p>
          </>
        ) : offer.kind === "keep" ? (
          <>
            <b>Keep your goal at {fmtGoal(offer.from)} MET-hours</b>
            <p className="small muted">{offer.reason}</p>
          </>
        ) : (
          <>
            <b>{offer.kind === "raise" ? "Ready for more?" : "Want an easier goal for now?"}</b>
            <p className="small">{offer.reason} I'd suggest {fmtGoal(offer.to)} MET-hours{offer.kind === "lower" ? ", a stepping stone back to 7.5" : ""}.</p>
            <p className="xs muted">
              {offer.kind === "raise"
                ? `Rule: the lower of your last 2 weeks, rounded down to a multiple of ${RAISE_STEP}.`
                : "Rule: under half the goal 3 weeks in a row → half the goal."}
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => dispatch({ type: "acceptGoal", to: offer.to })}>Change to {fmtGoal(offer.to)}</button>
              <button className="btn btn-quiet" onClick={() => dispatch({ type: "keepGoal" })}>Keep {fmtGoal(offer.from)}</button>
            </div>
            <OtherInput placeholder="Other: e.g. make it 6" onSubmit={typedGoal} hint={hint} />
          </>
        )}
      </div>

      <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={onPlan} disabled={!state.recapHandled && offer.kind !== "keep"}>
        Plan this week
      </button>
    </Sheet>
  );
}
