/**
 * Summary tab: the user's activity at a glance, readable by the user (who
 * may have low health literacy) and useful to their clinician at a visit.
 *
 * Each card leads with one plain sentence and a simple picture, using words
 * and units people already know (minutes, days, "breathing faster but can
 * still talk"). *Details* adds the clinical form of the same numbers
 * (MET-hours, percent of the guideline, MET bands) for the clinician.
 *
 * Feedback from the clinician comes back through Chat: the user tells the
 * agent what the clinician said, and it's listed at the bottom of this page.
 * There's no hand-over mode: the user shows this page and stays in charge.
 */
import { useState, type ReactNode } from "react";
import { Trophy } from "../components/Rewards";
import { fmt, fmtGoal } from "../lib/met";
import { buildSummary, GUIDELINE_MIN, type Summary, type SummaryWeek } from "../services/summary";
import { useStore } from "../state/store";
import type { Screen } from "../state/types";

const HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Card({ title, lead, children, detail, details }: { title: string; lead: ReactNode; children?: ReactNode; detail?: ReactNode; details: boolean }) {
  return (
    <section className="sum-card">
      <h2>{title}</h2>
      <p className="sum-lead">{lead}</p>
      {children}
      {details && detail && <p className="sum-detail">{detail}</p>}
    </section>
  );
}

export function SummaryScreen({ go }: { go: (s: Screen) => void }) {
  const { state, ctx, dispatch } = useStore();
  const [details, setDetails] = useState(false);
  const sum = buildSummary(ctx);
  const addFeedback = () => {
    dispatch({ type: "clinicianChat", text: "Add feedback from my clinician" });
    go("chat");
  };

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Summary</h1>
          <p className="sub">Your activity at a glance. You can show this page to your clinician at a visit.</p>
        </div>
      </div>
      <div className="seg-toggle sum-toggle" role="group" aria-label="How much detail">
        <button aria-pressed={!details} onClick={() => setDetails(false)}>Simple</button>
        <button aria-pressed={details} onClick={() => setDetails(true)}>Details for clinicians</button>
      </div>

      {sum.weeks === 0 ? (
        <section className="sum-card">
          <h2>Your summary starts next week</h2>
          <p className="sum-lead">After your first full week, this page shows how much you move, how often and how hard. So far this week: about {Math.round((ctx.week.done / 3) * 60)} minutes of brisk activity.</p>
        </section>
      ) : (
        <>
          <HowMuch sum={sum} details={details} />
          <WeekByWeek sum={sum} details={details} />
          <HowOften sum={sum} details={details} />
          <HowHard sum={sum} details={details} />
          <WhatYouDo sum={sum} details={details} />
        </>
      )}
      <Fitness details={details} />
      <Mention sum={sum} details={details} />

      <section className="sum-card sum-feedback">
        <h2>From your clinician</h2>
        {state.clinician.entries.length === 0 ? (
          <p className="sum-lead">After a visit, tell the agent what your clinician said. It will use their advice when it suggests workouts.</p>
        ) : (
          <>
            <ul className="sum-notes">
              {state.clinician.entries.map((n) => (
                <li key={n.id}>
                  <div>
                    <p>"{n.text}"</p>
                    <span className="xs muted">Saved {new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </div>
                  <button className="btn btn-ghost small-btn" onClick={() => dispatch({ type: "forgetClinicianNote", id: n.id })} aria-label={`Remove note: ${n.text}`}>Remove</button>
                </li>
              ))}
            </ul>
            {(ctx.guidance.moderateOnly || ctx.guidance.strength) && (
              <ul className="sum-applied">
                {ctx.guidance.moderateOnly && <li>The agent is keeping your workouts moderate.</li>}
                {ctx.guidance.strength && <li>The agent is suggesting strength training more often.</li>}
              </ul>
            )}
          </>
        )}
        <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={addFeedback}>Add feedback from your clinician</button>
        <p className="xs muted" style={{ marginTop: 8 }}>This opens Chat. Your goal stays yours to set; change it on Progress if you decide to.</p>
      </section>
    </>
  );
}

function HowMuch({ sum, details }: { sum: Summary; details: boolean }) {
  const v = sum.avgBriskMin;
  const max = Math.max(GUIDELINE_MIN * 1.6, sum.goalMin * 1.2, v * 1.12);
  const pos = (m: number) => `${Math.min(100, (m / max) * 100)}%`;
  const meaning = v >= GUIDELINE_MIN
    ? `That's more than the recommended ${GUIDELINE_MIN} minutes. Great work.`
    : v >= GUIDELINE_MIN * 0.75
      ? `That's close to the recommended ${GUIDELINE_MIN} minutes.`
      : `That's a start toward the recommended ${GUIDELINE_MIN} minutes. Every minute counts.`;
  return (
    <Card
      title="How much you move"
      details={details}
      lead={<>On average, about <b>{v} minutes</b> of brisk activity a week. {meaning}</>}
      detail={<>Mean of the last {plural(sum.weeks, "full week")}: <b>{fmt(sum.avgMetHours)} MET-hours/week</b>, {Math.round(sum.pctOfGuideline * 100)}% of the 7.5 MET-hour guideline (150 min at 3 MET or 75 min at 6 MET). Brisk minutes = MET-hours ÷ 3 × 60, so vigorous minutes count about double.</>}
    >
      <div className="sum-gauge" role="img" aria-label={`${v} minutes a week; recommended ${GUIDELINE_MIN}`}>
        <div className="sum-gauge-track"><span className={v >= GUIDELINE_MIN ? "good" : ""} style={{ width: pos(v) }} /></div>
        <span className="sum-gauge-mark" style={{ left: pos(GUIDELINE_MIN) }}><i />Recommended {GUIDELINE_MIN}</span>
        {sum.goalMin !== GUIDELINE_MIN && <span className="sum-gauge-mark goal" style={{ left: pos(sum.goalMin) }}><i />Your goal {sum.goalMin}</span>}
      </div>
    </Card>
  );
}

function WeekByWeek({ sum, details }: { sum: Summary; details: boolean }) {
  const weeks = sum.chart;
  const max = Math.max(...weeks.map((w) => Math.max(w.briskMin, w.goalMin)), 1) * 1.15;
  const W = 330;
  const H = 150;
  const base = 118;
  const bw = 34;
  const step = (W - 20) / weeks.length;
  const y = (m: number) => base - (m / max) * 96;
  const value = (w: SummaryWeek) => (details ? fmt(w.metHours) : String(w.briskMin));
  return (
    <Card
      title="Week by week"
      details={details}
      lead={<>You reached your goal in <b>{sum.goalWeeks} of the last {plural(sum.weeks, "week")}</b>.</>}
      detail={<>Bars: {details ? "MET-hours" : "brisk minutes"} per week. Dashed line: that week's goal ({weeks.map((w) => fmtGoal(w.goal)).filter((g, i, a) => a.indexOf(g) === i).join(" / ")} MET-hours). Green bars met it; this week is still in progress.</>}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="sum-chart" role="img" aria-label={weeks.map((w) => `${w.label}: ${w.briskMin} minutes${w.reached ? ", goal reached" : ""}`).join("; ")}>
        {weeks.map((w, i) => {
          const x = 14 + i * step + (step - bw) / 2;
          const top = y(w.briskMin);
          const gy = y(w.goalMin);
          return (
            <g key={w.label}>
              <rect x={x} y={top} width={bw} height={Math.max(2, base - top)} rx="6"
                fill={w.reached ? "var(--good)" : "var(--sum-bar)"} opacity={w.current ? 0.55 : 1} />
              <line x1={x - 6} x2={x + bw + 6} y1={gy} y2={gy} stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="4 3" />
              {w.reached && !w.current && <g transform={`translate(${x + bw / 2 - 7} ${Math.min(top, gy) - 20})`}><Trophy size={14} /></g>}
              {/* The value sits inside the bar, clear of the goal line; above it only when the bar is too short */}
              {base - top >= 22
                ? <text x={x + bw / 2} y={top + 15} textAnchor="middle" fontSize="11" fontWeight="700" fill={w.reached && !w.current ? "#fff" : "var(--ink)"}>{value(w)}</text>
                : <text x={x + bw / 2} y={top - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">{value(w)}</text>}
              <text x={x + bw / 2} y={base + 16} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{w.current ? "Now" : w.label}</text>
            </g>
          );
        })}
      </svg>
      <p className="sum-key xs"><span className="sw good" /> Reached goal <span className="sw" /> Not yet <span className="sw dash" /> Goal</p>
    </Card>
  );
}

function HowOften({ sum, details }: { sum: Summary; details: boolean }) {
  const days = Math.round(sum.avgActiveDays);
  return (
    <Card
      title="How often you move"
      details={details}
      lead={<>You were active on about <b>{plural(days, "day")} a week</b>.</>}
      detail={<>Active day = at least one recorded workout (Fitbit or logged). Mean {fmt(sum.avgActiveDays)} days/week over {plural(sum.weeks, "week")}. Longest stretch without activity in the record: {plural(sum.longestGap, "day")}.</>}
    >
      <div className="sum-cal" role="img" aria-label={sum.calendar.map((w) => `Week of ${w.label}: active ${w.days.filter(Boolean).length} days`).join("; ")}>
        <span />{HEAD.map((d) => <span key={d} className="sum-cal-h">{d}</span>)}
        {sum.calendar.map((w) => (
          <div key={w.label} className="sum-cal-row">
            <span className="sum-cal-w">{w.label}</span>
            {w.days.map((a, i) => <span key={i} className={`sum-dot${a ? " on" : ""}`} />)}
          </div>
        ))}
      </div>
      <p className="sum-key xs"><span className="sw dot on" /> Active <span className="sw dot" /> Rest day</p>
    </Card>
  );
}

function HowHard({ sum, details }: { sum: Summary; details: boolean }) {
  const { light, moderate, vigorous } = sum.intensity;
  const total = Math.max(1, light + moderate + vigorous);
  const most = moderate >= vigorous && moderate >= light ? "moderate" : vigorous >= light ? "vigorous" : "light";
  const rows: Array<[string, number, string, string, string]> = [
    ["Light", light, "light", "Easy, like a slow walk or stretching", "under 3 MET"],
    ["Moderate", moderate, "moderate", "Breathing faster, but you can still talk", "3 to 5.9 MET"],
    ["Vigorous", vigorous, "vigorous", "Hard to say more than a few words", "6 MET or more"],
  ];
  return (
    <Card
      title="How hard you work"
      details={details}
      lead={<>Most of your activity is <b>{most}</b>.</>}
      detail={<>Weekly mean minutes by intensity, from the 2024 Adult Compendium MET values: light under 3 MET, moderate 3 to 5.9, vigorous 6 or more. {fmt((vigorous / total) * 100)}% of active minutes were vigorous.</>}
    >
      <div className="sum-stack" role="img" aria-label={rows.map(([n, m]) => `${n}: ${m} minutes a week`).join("; ")}>
        {rows.map(([n, m, cls]) => m > 0 && <span key={n} className={cls} style={{ flexGrow: m }} />)}
      </div>
      <ul className="sum-legend">
        {rows.map(([n, m, cls, plain, met]) => (
          <li key={n}>
            <span className={`sw ${cls}`} />
            <div><span><b>{n}</b> <span className="muted">· {m} min a week</span></span><span className="xs muted">{plain}{details ? ` (${met})` : ""}</span></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WhatYouDo({ sum, details }: { sum: Summary; details: boolean }) {
  const max = Math.max(...sum.mix.map((m) => m.min), 1);
  const top = sum.mix[0];
  return (
    <Card
      title="What you do"
      details={details}
      lead={top ? <>Your main activity is <b>{top.name.toLowerCase()}</b>.</> : "No workouts recorded yet."}
      detail={<>Weekly mean minutes per activity over {plural(sum.weeks, "week")}, from Fitbit and manual logs. Unconfirmed Fitbit bouts count at the bottom of their band (3.0 or 6.0 MET).</>}
    >
      <ul className="counts">
        {sum.mix.map((m) => (
          <li key={m.name}>
            <span className="small">{m.name}</span>
            <span className="small num">{m.min} min a week</span>
            <div className="bar"><span style={{ width: `${(m.min / max) * 100}%`, background: m.color }} /></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Fitness({ details }: { details: boolean }) {
  const { ctx } = useStore();
  const v = ctx.vo2;
  if (!v) {
    return (
      <Card title="Heart and lung fitness" details={details}
        lead="No reading yet. Your Fitbit estimates this from outdoor runs with GPS turned on."
        detail="VO2 max (Fitbit's cardio fitness estimate), mL/kg/min. Not available without qualifying runs." />
    );
  }
  const vals = v.series.map((p) => p.value);
  const lo = Math.min(...vals) - 1.5;
  const hi = Math.max(...vals) + 1.5;
  const W = 330;
  const H = 110;
  const x = (i: number) => 22 + (i * (W - 44)) / Math.max(1, vals.length - 1);
  const yy = (val: number) => 80 - ((val - lo) / (hi - lo)) * 64;
  const trend = v.series.length < 2 ? "This is your first reading." : v.change > 0 ? `Yours went up ${v.change} ${v.change === 1 ? "point" : "points"} since ${v.series[0].label}.` : v.change < 0 ? `It's ${-v.change} lower than in ${v.series[0].label}; regular activity helps bring it back up.` : `It's held steady since ${v.series[0].label}.`;
  return (
    <Card
      title="Heart and lung fitness"
      details={details}
      lead={<>Your fitness score is <b>{v.latest}</b>. Higher is better. {trend}</>}
      detail={<>VO2 max, Fitbit's estimate (from outdoor runs with GPS and resting heart rate): <b>{v.latest} mL/kg/min</b>, about {fmt(v.peakMets)} METs at peak (1 MET = 3.5 mL/kg/min). One reading a month. Simulated in this demo.</>}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="sum-chart" role="img" aria-label={`Fitness score by month: ${v.series.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        <path d={vals.map((val, i) => `${i ? "L" : "M"}${x(i)} ${yy(val)}`).join(" ")} fill="none" stroke="var(--good)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((val, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={yy(val)} r={i === vals.length - 1 ? 5 : 3.5} fill={i === vals.length - 1 ? "var(--good)" : "var(--surface)"} stroke="var(--good)" strokeWidth="2" />
            <text x={x(i)} y={yy(val) - 9} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink)">{val}</text>
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{v.series[i].label}</text>
          </g>
        ))}
      </svg>
    </Card>
  );
}

function Mention({ sum, details }: { sum: Summary; details: boolean }) {
  return (
    <Card
      title="Worth mentioning to your clinician"
      details={details}
      lead={sum.mention.length ? "These might be useful to talk about at your next visit:" : "Nothing stands out. You can still show them this page."}
      detail="From the user's own entries: the health question at sign-up, typed notes, “something hurts” reports and skip reasons."
    >
      {sum.mention.length > 0 && <ul className="sum-mention">{sum.mention.map((m) => <li key={m}>{m}</li>)}</ul>}
    </Card>
  );
}
