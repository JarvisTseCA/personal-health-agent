/**
 * Demo moment: "Tell us what you love doing. We'll show you how to make it count."
 * Built for a visitor at a demo table: pick activities, see how each one
 * counts, then compare three hypothetical weeks against the 7.5 MET-hour goal.
 */
import { useMemo, useState } from "react";
import { ChevronIcon } from "../components/Icons";
import { Trophy } from "../components/Rewards";
import { getFamily, getVariant, PICKABLE, type ActivityFamily, type ActivityVariant } from "../lib/activities";
import { creditFor, DAY_NAMES, fmt, formatDuration, GUIDELINE_GOAL, intensityOf, minutesFor } from "../lib/met";
import { useStore } from "../state/store";

const GOAL = GUIDELINE_GOAL;
const DEMO_TIME = 120; // "under two hours"

interface Block { familyId: string; variantId: string; durationMin: number; dayIndex: number; credit: number }
interface Schedule { key: string; title: string; blocks: Block[]; note: string }

const countable = (f: ActivityFamily) => f.variants.filter((v) => creditFor(v.met, 10) > 0).sort((a, b) => a.met - b.met);
const block = (f: ActivityFamily, v: ActivityVariant, durationMin: number, dayIndex: number): Block => ({ familyId: f.id, variantId: v.id, durationMin, dayIndex, credit: creditFor(v.met, durationMin) });

function summarize(blocks: Block[]): string {
  const groups = new Map<string, { n: number; d: number; noun: string }>();
  for (const b of blocks) {
    const k = `${b.variantId}:${b.durationMin}`;
    const g = groups.get(k) ?? { n: 0, d: b.durationMin, noun: getVariant(b.variantId).family.noun };
    g.n++;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => `${g.n > 1 ? `${g.n} × ` : ""}${g.d} min ${g.noun}`).join(" + ");
}

function buildSchedules(families: ActivityFamily[]): Schedule[] {
  const fs = families.filter((f) => countable(f).length);
  if (!fs.length) return [];
  const comfy = (f: ActivityFamily) => countable(f)[0];

  // Too little: two easy sessions, 40% of the goal.
  const each = minutesFor(comfy(fs[0]).met, (GOAL * 0.4) / 2);
  const tooLittle = [block(fs[0], comfy(fs[0]), each, 1), block(fs[1] ?? fs[0], comfy(fs[1] ?? fs[0]), minutesFor(comfy(fs[1] ?? fs[0]).met, (GOAL * 0.4) / 2), 5)];

  // Overdid it: every day, no rest, 240% of the goal.
  const over = Array.from({ length: 7 }, (_, d) => {
    const f = fs[d % fs.length];
    const v = countable(f).at(-1)!;
    return block(f, v, minutesFor(v.met, (GOAL * 2.4) / 7), d);
  });

  // With the agent: 30-minute blocks at a steady pace, alternating activities,
  // rest days between, stopping as soon as the goal is reached.
  const days = [1, 3, 5, 6, 0, 2, 4];
  const agent: Block[] = [];
  let left = GOAL;
  for (let i = 0; left > 1e-9 && i < days.length; i++) {
    const f = fs[i % fs.length];
    const vs = countable(f);
    const v = vs[Math.min(1, vs.length - 1)];
    const d = Math.min(30, minutesFor(v.met, left));
    const b = block(f, v, d, days[i]);
    agent.push(b);
    left -= b.credit;
  }
  agent.sort((a, b) => a.dayIndex - b.dayIndex);
  const agentClock = agent.reduce((a, b) => a + b.durationMin, 0);

  return [
    { key: "little", title: "Too little", blocks: tooLittle, note: "Easy pace, not enough of it" },
    { key: "over", title: "Overdid it", blocks: over, note: "Every day, no rest days" },
    { key: "agent", title: "With the agent", blocks: agent, note: agentClock <= DEMO_TIME ? `Under ${formatDuration(DEMO_TIME)}` : "Just enough" },
  ];
}

/** Which days of the week had a session, Monday to Sunday. */
function activeDays(blocks: Block[]): boolean[] {
  return DAY_NAMES.map((_, i) => blocks.some((b) => b.dayIndex === i));
}

export function ShowcaseScreen() {
  const { state } = useStore();
  const initial = state.profile.enjoyed.length ? state.profile.enjoyed.slice(0, 3) : ["cycling", "dancing"];
  const [picked, setPicked] = useState<string[]>(initial);
  const [open, setOpen] = useState(false);

  const families = picked.map(getFamily);
  const schedules = useMemo(() => buildSchedules(families), [picked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxCredit = Math.max(GOAL * 2.4, ...schedules.map((s) => s.blocks.reduce((a, x) => a + x.credit, 0)));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
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
        {PICKABLE.map((f) => {
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
                const c = creditFor(v.met, 30);
                return (
                  <li key={v.id}>
                    <span className="small"><b>{f.name}</b>, {v.label.toLowerCase()} <span className="muted">({v.met} MET, {intensityOf(v.met)})</span></span>
                    <span className="num" style={{ fontWeight: 700 }}>{fmt(c)}</span>
                    <div className="bar"><span style={{ width: `${(c / GOAL) * 100}%`, background: f.color }} /></div>
                  </li>
                );
              });
            })}
          </ul>
          <p className="xs muted" style={{ marginTop: 8 }}>MET-hours; the bar is the share of the 7.5 weekly goal.</p>
        </section>
      )}

      {schedules.length > 0 && (
        <section className="section">
          <h2>Three ways a week can go</h2>
          <p className="small muted" style={{ marginTop: -6, marginBottom: 12 }}>Goal: {GOAL} MET-hours. The dashed line marks it.</p>
          <div className="compare">
            {schedules.map((s) => {
              const credit = s.blocks.reduce((a, x) => a + x.credit, 0);
              const clock = s.blocks.reduce((a, x) => a + x.durationMin, 0);
              const pct = Math.round((credit / GOAL) * 100);
              const color = s.key === "agent" ? "var(--ink)" : s.key === "over" ? "#C2410C" : "var(--line-strong)";
              return (
                <div key={s.key} className={`col ${s.key === "agent" ? "agent" : ""}`}>
                  <h3>{s.title}</h3>
                  <div className="vstrip" aria-hidden>
                    <div className="fill" style={{ height: `${(credit / maxCredit) * 100}%`, background: color }} />
                    <div className="goal-line" style={{ bottom: `${(GOAL / maxCredit) * 100}%` }} />
                  </div>
                  <div className="pct">{pct}%</div>
                  <div className="mini-week" aria-label={`Active on ${activeDays(s.blocks).filter(Boolean).length} days${credit + 1e-9 >= GOAL ? ", trophy earned" : ""}`}>
                    <span className="mini-dots">{activeDays(s.blocks).map((on, i) => <i key={i} className={on ? "on" : ""} />)}</span>
                    {credit + 1e-9 >= GOAL && <Trophy size={16} />}
                  </div>
                  <div className="what">{formatDuration(clock)} total. {s.note}.</div>
                </div>
              );
            })}
          </div>

          {agentSchedule && agentSchedule.blocks.length > 0 && (
            <div className="expand">
              <button aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span>How the agent planned it</span>
                <ChevronIcon open={open} />
              </button>
              {open && (
                <div className="body">
                  <p style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginBottom: 10 }}>{summarize(agentSchedule.blocks)}</p>
                  <ul className="counts" style={{ gap: 8 }}>
                    {agentSchedule.blocks.map((b, i) => {
                      const { family, variant } = getVariant(b.variantId);
                      return (
                        <li key={i} style={{ gridTemplateColumns: "40px 1fr auto" }}>
                          <span className="small muted">{DAY_NAMES[b.dayIndex]}</span>
                          <span className="small">{b.durationMin} min {family.noun}, {variant.label.toLowerCase()}</span>
                          <span className="num small" style={{ fontWeight: 700 }}>+{fmt(b.credit)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="small muted" style={{ marginTop: 12 }}>
                    Only activities you picked, with rest days between, stopping right at the goal. Every active day turns gold once the goal is reached.
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
