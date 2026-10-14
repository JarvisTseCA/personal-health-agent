/**
 * Demo moment: "Tell us what you love doing. We'll show you how to make it count."
 * Built for a visitor at a demo table: pick activities, see how each one
 * counts, then compare three hypothetical weeks.
 */
import { useMemo, useState } from "react";
import { ChevronIcon } from "../components/Icons";
import { ACTIVITIES, getFamily, getVariant, type ActivityFamily, type ActivityVariant } from "../lib/activities";
import { DAY_NAMES, formatDuration, guidelineMinutes, intensityOf, multiplierOf, WEEKLY_GOAL_MINUTES } from "../lib/guideline";
import { buildPlanOptions, type PlannedSession } from "../lib/planner";
import { useStore } from "../state/store";

const GOAL = WEEKLY_GOAL_MINUTES;
const DEMO_TIME = 120; // "under two hours"
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Schedule {
  key: string;
  title: string;
  sessions: PlannedSession[];
  note: string;
}

const countable = (f: ActivityFamily) => f.variants.filter((v) => multiplierOf(v.met) > 0).sort((a, b) => a.met - b.met);

function session(f: ActivityFamily, v: ActivityVariant, durationMin: number, dayIndex: number): PlannedSession {
  return { familyId: f.id, variantId: v.id, durationMin, dayIndex, credit: guidelineMinutes(v.met, durationMin) };
}

function summarize(sessions: PlannedSession[]): string {
  const groups = new Map<string, { n: number; d: number; noun: string }>();
  for (const s of sessions) {
    const k = `${s.variantId}:${s.durationMin}`;
    const g = groups.get(k) ?? { n: 0, d: s.durationMin, noun: getVariant(s.variantId).family.noun };
    g.n++;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => `${g.n > 1 ? `${g.n} × ` : ""}${g.d} min ${g.noun}`).join(" + ");
}

function buildSchedules(families: ActivityFamily[]): Schedule[] {
  const fs = families.filter((f) => countable(f).length);
  if (!fs.length) return [];
  const comfy = (f: ActivityFamily) => countable(f)[0];

  // Too little: two sessions at an easy pace, 40% of the goal.
  const fav = fs[0];
  const lowTarget = GOAL * 0.4;
  const lowEach = Math.round(lowTarget / 2 / multiplierOf(comfy(fav).met) / 5) * 5;
  const tooLittle = [session(fav, comfy(fav), lowEach, 1), session(fs[1] ?? fav, comfy(fs[1] ?? fav), lowEach, 5)];

  // Overdid it: every day, no rest, 240% of the goal.
  const highTarget = GOAL * 2.4;
  const over: PlannedSession[] = [];
  let acc = 0;
  for (let d = 0; d < 7; d++) {
    const f = fs[d % fs.length];
    const v = comfy(f);
    const m = multiplierOf(v.met);
    const want = d === 6 ? highTarget - acc : highTarget / 7;
    const dur = Math.max(5, Math.round(want / m / 5) * 5);
    const s = session(f, v, dur, d);
    acc += s.credit;
    over.push(s);
  }

  // With the agent: an option that fits in under two hours. Prefer the mix,
  // so the visitor sees more than one of their activities used.
  const options = buildPlanOptions({ remainingMinutes: GOAL, timeLeftMinutes: DEMO_TIME, familyIds: fs.map((f) => f.id), openDays: ALL_DAYS });
  const best = [...options].sort(
    (a, b) => Number(b.fits) - Number(a.fits) || Number(b.kind === "mix") - Number(a.kind === "mix") || a.clockMinutes - b.clockMinutes,
  )[0];

  return [
    { key: "little", title: "Too little", sessions: tooLittle, note: "Easy pace, not enough of it" },
    { key: "over", title: "Overdid it", sessions: over, note: "Every day, no rest days" },
    { key: "agent", title: "With the agent", sessions: best?.sessions ?? [], note: best?.fits ? `Under ${formatDuration(DEMO_TIME)}` : "As close as the time allows" },
  ];
}

export function ShowcaseScreen() {
  const { state } = useStore();
  const initial = state.profile.enjoyedFamilyIds.length ? state.profile.enjoyedFamilyIds.slice(0, 3) : ["cycling", "dancing"];
  const [picked, setPicked] = useState<string[]>(initial);
  const [open, setOpen] = useState(false);

  const families = picked.map(getFamily);
  const schedules = useMemo(() => buildSchedules(families), [picked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxCredit = Math.max(GOAL * 2.4, ...schedules.map((s) => s.sessions.reduce((a, x) => a + x.credit, 0)));

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));

  const agentSchedule = schedules.find((s) => s.key === "agent");

  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Tell us what you love doing</h1>
          <p className="sub">We'll show you how to make it count. Pick two or three.</p>
        </div>
      </div>

      <div className="chips">
        {ACTIVITIES.map((f) => {
          const order = picked.indexOf(f.id);
          return (
            <button key={f.id} className="chip" aria-pressed={order >= 0} onClick={() => toggle(f.id)}>
              {order >= 0 ? <span className="order">{order + 1}</span> : <span className="dot" style={{ background: f.color }} />}
              {f.name}
            </button>
          );
        })}
      </div>

      {families.length > 0 && (
        <section className="section">
          <h2>What 30 minutes is worth</h2>
          <ul className="counts">
            {families.flatMap((f) => {
              const vs = countable(f);
              const shown = vs.length > 1 ? [vs[0], vs[vs.length - 1]] : vs;
              return shown.map((v) => {
                const c = guidelineMinutes(v.met, 30);
                return (
                  <li key={v.id}>
                    <span className="small"><b>{f.name}</b>, {v.label.toLowerCase()} <span className="muted">({v.met} MET, {intensityOf(v.met)})</span></span>
                    <span className="num" style={{ fontWeight: 700 }}>{c} min</span>
                    <div className="bar"><span style={{ width: `${(c / 60) * 100}%`, background: f.color }} /></div>
                  </li>
                );
              });
            })}
          </ul>
        </section>
      )}

      {schedules.length > 0 && (
        <section className="section">
          <h2>Three ways a week can go</h2>
          <p className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>Goal: {GOAL} guideline minutes. Dashed line marks the goal.</p>
          <div className="compare">
            {schedules.map((s) => {
              const credit = s.sessions.reduce((a, x) => a + x.credit, 0);
              const clock = s.sessions.reduce((a, x) => a + x.durationMin, 0);
              const pct = Math.round((credit / GOAL) * 100);
              const days = new Set(s.sessions.map((x) => x.dayIndex));
              const color = s.key === "agent" ? "var(--ink)" : s.key === "over" ? "#C2410C" : "var(--line-strong)";
              return (
                <div key={s.key} className={`col ${s.key === "agent" ? "agent" : ""}`}>
                  <h3>{s.title}</h3>
                  <div className="vstrip" aria-hidden>
                    <div className="fill" style={{ height: `${(credit / maxCredit) * 100}%`, background: color }} />
                    <div className="goal-line" style={{ bottom: `${(GOAL / maxCredit) * 100}%` }} />
                  </div>
                  <div className="pct">{pct}%</div>
                  <div className="week-dots" aria-label={`${days.size} active days`}>
                    {DAY_NAMES.map((d, i) => <span key={d} style={days.has(i) ? { background: color } : undefined} />)}
                  </div>
                  <div className="what">{formatDuration(clock)} total. {s.note}.</div>
                </div>
              );
            })}
          </div>

          {agentSchedule && agentSchedule.sessions.length > 0 && (
            <div className="expand">
              <button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span>How the agent planned it</span>
                <ChevronIcon open={open} />
              </button>
              {open && (
                <div className="body">
                  <p style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginBottom: 10 }}>{summarize(agentSchedule.sessions)}</p>
                  <ul className="counts" style={{ gap: 8 }}>
                    {agentSchedule.sessions.map((s, i) => {
                      const { family, variant } = getVariant(s.variantId);
                      return (
                        <li key={i} style={{ gridTemplateColumns: "40px 1fr auto" }}>
                          <span className="small muted">{DAY_NAMES[s.dayIndex]}</span>
                          <span className="small">{s.durationMin} min {family.noun}, {variant.label.toLowerCase()}</span>
                          <span className="num small" style={{ fontWeight: 700 }}>+{s.credit}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="small muted" style={{ marginTop: 12 }}>
                    Only activities you picked, in short blocks with rest days between. Vigorous minutes count double, which is how it fits in less time.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

