import { fmt } from "../lib/met";
import type { Vo2 } from "../services/context";

/**
 * The mission, in one card: the user's VO2 max (Fitbit's estimate) and its
 * monthly trend. VO2 max is measured in mL of oxygen per kg per minute; one
 * MET is 3.5 of those, so the same number also reads as peak METs, which
 * ties it to the MET-hours the app counts every week.
 */
export function Vo2Card({ vo2 }: { vo2: Vo2 | null }) {
  if (!vo2) {
    return (
      <section className="vo2-card" aria-label="VO2 max">
        <p className="vo2-kicker">Your VO2 max</p>
        <p className="small" style={{ marginTop: 6 }}>No estimate yet. Fitbit estimates VO2 max from outdoor runs with GPS on, and it can take a few runs.</p>
        <p className="xs muted" style={{ marginTop: 6 }}>Your weekly MET-hours are still the training that raises it.</p>
      </section>
    );
  }
  const vals = vo2.series.map((x) => x.value);
  const lo = Math.min(...vals) - 1;
  const hi = Math.max(...vals) + 1;
  const W = 150;
  const H = 46;
  const x = (i: number) => (vals.length === 1 ? W / 2 : 6 + (i * (W - 12)) / (vals.length - 1));
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const first = vo2.series[0];
  const change = vo2.change;
  const trend = vo2.series.length < 2 ? "First reading" : change > 0 ? `Up ${change} since ${first.label}` : change < 0 ? `${first.value} in ${first.label}` : `Steady since ${first.label}`;

  return (
    <section className="vo2-card" aria-label="VO2 max">
      <div className="vo2-top">
        <div>
          <p className="vo2-kicker">Your VO2 max</p>
          <p className="vo2-value"><span className="num">{vo2.latest}</span><span className="vo2-unit">mL/kg/min</span></p>
          <p className={`vo2-trend${change > 0 ? " up" : ""}`}>{trend}</p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="vo2-spark" role="img" aria-label={`Monthly estimates: ${vo2.series.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
          <path d={path} fill="none" stroke="var(--good)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === vals.length - 1 ? 3.6 : 2.2} fill={i === vals.length - 1 ? "var(--good)" : "var(--surface)"} stroke="var(--good)" strokeWidth="1.5" />)}
          <text x={x(0)} y={H - 1} fontSize="9" fill="var(--ink-3)" textAnchor="start">{first.label}</text>
          <text x={x(vals.length - 1)} y={H - 1} fontSize="9" fill="var(--ink-3)" textAnchor="end">{vo2.series.at(-1)!.label}</text>
        </svg>
      </div>
      <p className="xs muted vo2-note">
        About {fmt(vo2.peakMets)} METs at your peak (1 MET = 3.5 mL/kg/min). It rises over weeks to months of regular activity: your weekly MET-hours are that training. Fitbit's estimate, one reading a month; simulated in this demo.
      </p>
    </section>
  );
}
