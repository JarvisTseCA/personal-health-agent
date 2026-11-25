/**
 * Showing the backend's numbers (numbers.ts): by default the app works its own numbers out;
 * once numbers are held, the context, the Summary and the month view take them from there.
 * Each test changes a held value to one the app's own calculator could not produce, to show
 * what is on screen really comes from the held numbers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVITIES } from "../lib/activities";
import type { Session } from "../lib/met";
import type { DaySlot } from "../lib/plan";
import { initialState, personaProfile } from "../state/store";
import type { AppState } from "../state/types";
import { buildAgentContext, creditOf, ownContext, reachedToday } from "./context";
import type { Numbers } from "./memoryTypes";
import { numbersKey, numbersAhead, numbersFor, periodsFromNumbers, showNumbers, summaryFromNumbers } from "./numbers";
import { numbersLike } from "./numbers.testkit";
import { buildSummary } from "./summary";

const MONDAY = "2026-11-23";

afterEach(() => showNumbers(null, null));

function onboarded(): AppState {
  const s = initialState("alex");
  return { ...s, onboarded: true, profile: personaProfile(s) };
}

/** A state with its realistic numbers, and those numbers on screen. */
function held() {
  const state = onboarded();
  const n = numbersLike(state, MONDAY);
  showNumbers(state, n);
  return { state, n };
}

const aSession = (id: string, base: Session): Session => ({ ...base, id });

describe("by default, without the backend", () => {
  it("holds no numbers, and the context is the app's own", () => {
    const s = onboarded();
    expect(numbersFor(s)).toBeNull();
    const ctx = buildAgentContext(s);
    const own = ownContext(s);
    expect(ctx.streak).toEqual(own.streak);
    expect(ctx.trophies).toBe(own.trophies);
    expect(ctx.goal).toBe(own.goal);
    expect(ctx.todayTarget).toBe(own.todayTarget);
    expect(ctx.week.done).toBe(own.week.done);
    expect(ctx.past.map((w) => w.totals.done)).toEqual(own.past.map((w) => w.totals.done));
  });

  it("goes back to holding nothing after showNumbers(null, null)", () => {
    const { state } = held();
    expect(numbersFor(state)).not.toBeNull();
    showNumbers(null, null);
    expect(numbersFor(state)).toBeNull();
  });
});

describe("the context with numbers held", () => {
  it("takes streak, trophies, goal and the week from the held numbers", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const n: Numbers = {
      ...base,
      streak: { current: 99, best: 120 },
      trophy: !base.trophy,
      trophies: 42,
      this_week: { ...base.this_week, goal_met_hours: 6.25, done_met_hours: 5.5, done_by_day: [1, 2, 3, 4, 5, 6, 7], targets: [9, 8, 7, 6, 5, 4, 3], left_met_hours: 4.44, unplanned_met_hours: 3.33, active_days: [true, false, true, false, true, false, true], app_opens: [false, true, false, true, false, true, false] },
    };
    showNumbers(state, n);
    const ctx = buildAgentContext(state);
    expect(ctx.streak).toEqual({ current: 99, best: 120 });
    expect(ctx.trophy).toBe(n.trophy);
    expect(ctx.trophies).toBe(42);
    expect(ctx.goal).toBe(6.25);
    expect(ctx.steppingStone).toBe(true);
    expect(ctx.week.done).toBe(5.5);
    expect(ctx.week.doneByDay).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ctx.targets).toEqual([9, 8, 7, 6, 5, 4, 3]);
    expect(ctx.left).toBe(4.44);
    expect(ctx.unplanned).toBe(3.33);
    expect(ctx.activeDays).toEqual(n.this_week.active_days);
    expect(ctx.signIns).toEqual(n.this_week.app_opens);
  });

  it("takes today's target, done and needed, and the goal offer, from the held numbers", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const n: Numbers = {
      ...base,
      day: { ...base.day, name: "Someday", target_met_hours: 9.99, done_met_hours: 1.11, needed_met_hours: 8.88, reached: false },
      goal_offer: { kind: "raise", from: 7.5, to: 20, reason: "held" },
    };
    showNumbers(state, n);
    const ctx = buildAgentContext(state);
    expect(ctx.today).toBe("Someday");
    expect(ctx.todayTarget).toBe(9.99);
    expect(ctx.todayDone).toBe(1.11);
    expect(ctx.todayNeeded).toBe(8.88);
    expect(ctx.offer).toEqual({ kind: "raise", from: 7.5, to: 20, reason: "held" });
  });

  it("takes VO2 max from the held numbers, and none when they hold none", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    showNumbers(state, { ...base, vo2: { series: [{ month: "2026-10", ml_kg_min: 30 }, { month: "2026-11", ml_kg_min: 55 }], latest: 55, change: 25, peak_mets: 15.7 } });
    const vo2 = buildAgentContext(state).vo2;
    expect(vo2?.latest).toBe(55);
    expect(vo2?.change).toBe(25);
    expect(vo2?.peakMets).toBe(15.7);
    expect(vo2?.series.map((p) => p.value)).toEqual([30, 55]);

    showNumbers(state, { ...base, vo2: null });
    expect(buildAgentContext(state).vo2).toBeNull();
  });

  it("takes each past week's goal, done, sign-ins and trophy from the held numbers", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const i = base.past_weeks.length - 1;
    const past = base.past_weeks.map((w, k) => (k === i ? { ...w, goal_met_hours: 3.21, done_met_hours: 123, app_opens: [true, true, false, false, false, false, true], trophy: !w.trophy } : w));
    showNumbers(state, { ...base, past_weeks: past });
    const ctx = buildAgentContext(state);
    expect(ctx.past).toHaveLength(past.length);
    expect(ctx.past[i].goal).toBe(3.21);
    expect(ctx.past[i].totals.done).toBe(123);
    expect(ctx.past[i].signIns).toEqual([true, true, false, false, false, false, true]);
    expect(ctx.past[i].trophy).toBe(past[i].trophy);
    // The other weeks are as they were.
    expect(ctx.past[0].totals.done).toBe(base.past_weeks[0].done_met_hours);
    expect(ctx.past[i].start).toEqual(new Date(2026, 10, 16));
  });

  it("lists this week's sessions with the row's counted MET and MET-hours, and skips a row with no matching session", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const [first, second] = base.this_week.workouts;
    const stray = { ...first, id: "not-in-state", met_hours: 50 };
    const noId = { ...first, id: null, met_hours: 60 };
    const workouts = [{ ...first, counted_met: 3.3, met_hours: 7.77 }, stray, noId, second];
    showNumbers(state, { ...base, this_week: { ...base.this_week, workouts } });
    const sessions = buildAgentContext(state).week.sessions;
    expect(sessions.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(sessions[0].met).toBe(3.3);
    expect(sessions[0].credit).toBe(7.77);
    expect(sessions[1].credit).toBe(second.met_hours);
    // The rest of each session is the state's own.
    expect(sessions[0].durationMin).toBe(state.sessions.find((x) => x.id === first.id)?.durationMin);
  });

  it("says today is reached when the numbers do, even though target and done say otherwise", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const day = { ...base.day, target_met_hours: 5, done_met_hours: 0, needed_met_hours: 5 };
    showNumbers(state, { ...base, day: { ...day, reached: true } });
    expect(reachedToday(buildAgentContext(state))).toBe(true);
    showNumbers(state, { ...base, day: { ...day, target_met_hours: 1, done_met_hours: 4, needed_met_hours: 0, reached: false } });
    expect(reachedToday(buildAgentContext(state))).toBe(false);
  });

  it("works it out from target and done when no number says (the app's own context)", () => {
    expect(reachedToday({ todayTarget: 2, todayDone: 2 })).toBe(true);
    expect(reachedToday({ todayTarget: 0, todayDone: 0 })).toBe(false);
  });
});

describe("creditOf", () => {
  it("is the held row's MET-hours when numbers are held", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const [first] = base.this_week.workouts;
    showNumbers(state, { ...base, this_week: { ...base.this_week, workouts: [{ ...first, met_hours: 7.77 }, ...base.this_week.workouts.slice(1)] } });
    const session = state.sessions.find((x) => x.id === first.id)!;
    expect(creditOf(state, session)).toBe(7.77);
  });

  it("is the app's own credit when none are held", () => {
    const state = onboarded();
    const session = state.sessions[0];
    expect(creditOf(state, session)).toBe(ownContext(state).week.sessions.find((x) => x.id === session.id)!.credit);
  });

  it("is the app's own credit for a session the held numbers don't list", () => {
    const { state } = held();
    const extra = aSession("extra", state.sessions[0]);
    expect(creditOf(state, extra)).toBe(ownContext({ ...state, sessions: [extra] }).week.sessions[0].credit);
  });
});

describe("two sets of numbers", () => {
  function twoSets() {
    const before = onboarded();
    const after: AppState = { ...before, sessions: [...before.sessions, aSession("new-one", before.sessions[0])] };
    const base = numbersLike(before, MONDAY);
    const n1: Numbers = { ...base, trophies: 10 };
    const n2: Numbers = { ...base, trophies: 11 };
    return { before, after, n1, n2 };
  }

  it("gives the step's own state the new numbers and every other state the ones on screen", () => {
    const { before, after, n1, n2 } = twoSets();
    showNumbers(before, n1);
    numbersAhead(after, n2);
    expect(numbersFor(after)).toBe(n2);
    expect(numbersFor(before)).toBe(n1);
    expect(numbersFor({ ...before, goal: before.goal + 1 })).toBe(n1);
    expect(buildAgentContext(before).trophies).toBe(10);
    expect(buildAgentContext(after).trophies).toBe(11);
  });

  it("drops the numbers ahead when new numbers are shown", () => {
    const { before, after, n1, n2 } = twoSets();
    showNumbers(before, n1);
    numbersAhead(after, n2);
    showNumbers(after, n2);
    expect(numbersFor(after)).toBe(n2);
    expect(numbersFor(before)).toBe(n2);
    expect(numbersFor({ ...before, goal: before.goal + 1 })).toBe(n2);
  });

  it("gives nothing ahead while no numbers are shown", () => {
    const { after, n2 } = twoSets();
    numbersAhead(after, n2);
    expect(numbersFor(after)).toBeNull();
  });
});

describe("numbersKey", () => {
  const base = onboarded();

  it("is the same for states that differ only in chat, the Today conversation or the overlay", () => {
    const other: AppState = {
      ...base,
      chat: [{ id: "c1", role: "user", text: "hello" }],
      today: { ...base.today, entries: [{ id: "e1", role: "agent", text: "hi" }], boost: true },
      overlay: "prefs",
    };
    expect(numbersKey(other)).toBe(numbersKey(base));
  });

  it("changes with each thing the numbers are worked out from", () => {
    const flipped: DaySlot = base.plan[0] === "off" ? "30" : "off";
    const variants: Record<string, AppState> = {
      sessions: { ...base, sessions: [...base.sessions, aSession("more", base.sessions[0])] },
      goal: { ...base, goal: base.goal + 1 },
      plan: { ...base, plan: [flipped, ...base.plan.slice(1)] },
      signIns: { ...base, signIns: base.signIns.map((x, i) => (i === 0 ? !x : x)) },
      todayIndex: { ...base, todayIndex: base.todayIndex + 1 },
      vo2: { ...base, vo2: [...base.vo2, 99] },
      history: { ...base, history: base.history.slice(1) },
    };
    const keys = new Set([numbersKey(base)]);
    for (const [name, s] of Object.entries(variants)) {
      const k = numbersKey(s);
      expect(k, name).not.toBe(numbersKey(base));
      keys.add(k);
    }
    expect(keys.size).toBe(Object.keys(variants).length + 1);
  });

  it("changes when a week of history changes in place, not only when its length does", () => {
    const history = base.history.map((w, i) => (i === 0 ? { ...w, goal: w.goal + 1 } : w));
    expect(numbersKey({ ...base, history })).not.toBe(numbersKey(base));
  });
});

describe("the Summary with numbers held", () => {
  function summaryNumbers(): { state: AppState; n: Numbers } {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const n: Numbers = {
      ...base,
      summary: {
        ...base.summary,
        weeks: 3, avg_met_hours: 12.5, avg_brisk_min: 250, goal_weeks: 2, longest_gap: 9,
        intensity: { light: 11, moderate: 22, vigorous: 33 },
        mix: [{ activity_code: null, activity_name: ACTIVITIES[0].name, min_per_week: 77 }, { activity_code: null, activity_name: "Something Unlisted", min_per_week: 5 }],
      },
    };
    return { state, n };
  }

  it("takes the numbers from the held summary", () => {
    const { n } = summaryNumbers();
    const s = summaryFromNumbers(n);
    expect(s.weeks).toBe(3);
    expect(s.avgMetHours).toBe(12.5);
    expect(s.avgBriskMin).toBe(250);
    expect(s.goalWeeks).toBe(2);
    expect(s.longestGap).toBe(9);
    expect(s.intensity).toEqual({ light: 11, moderate: 22, vigorous: 33 });
    expect(s.calendar).toHaveLength(n.summary.calendar.length);
  });

  it("labels the chart's current week 'This week' and the others by their Monday", () => {
    const { n } = summaryNumbers();
    const chart = summaryFromNumbers(n).chart;
    const last = chart[chart.length - 1];
    expect(last.label).toBe("This week");
    expect(last.current).toBe(true);
    expect(chart.slice(0, -1).every((w) => !w.current && w.label !== "This week")).toBe(true);
    expect(chart[0].metHours).toBe(n.summary.chart[0].met_hours);
    const [y, m, d] = n.summary.chart[0].week_start.split("-").map(Number);
    expect(chart[0].label).toBe(new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });

  it("gives each mix entry its name and minutes, and a color", () => {
    const { n } = summaryNumbers();
    const mix = summaryFromNumbers(n).mix;
    expect(mix.map((m) => [m.name, m.min])).toEqual([[ACTIVITIES[0].name, 77], ["Something Unlisted", 5]]);
    expect(mix[0].color).toBe(ACTIVITIES[0].color);
    expect(typeof mix[1].color).toBe("string");
    expect(mix[1].color.length).toBeGreaterThan(0);
  });

  it("buildSummary uses the held numbers, and the app still writes the things to mention", () => {
    const { state, n } = summaryNumbers();
    showNumbers(state, n);
    const sum = buildSummary(buildAgentContext(state));
    expect(sum.weeks).toBe(3);
    expect(sum.avgMetHours).toBe(12.5);
    expect(sum.longestGap).toBe(9);
    expect(sum.mix[0].min).toBe(77);
    expect(sum.mention.some((m) => m.includes("9 days"))).toBe(true);
  });
});

describe("the month view with numbers held", () => {
  it("makes one period per held month, newest first, with the month's own totals", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const months = base.months.map((m, i) => (i === 0 ? { ...m, trophies: 17, best_streak: 88, app_open_days: 21, active_days: 19, done_met_hours: 456, goal_met_hours: 123, partial: !m.partial } : m));
    const n: Numbers = { ...base, months };
    showNumbers(state, n);
    const periods = periodsFromNumbers(buildAgentContext(state).past, n);

    expect(periods).toHaveLength(months.length);
    expect(periods.map((p) => p.key)).toEqual(months.map((m) => `${Number(m.month.slice(0, 4))}-${Number(m.month.slice(5)) - 1}`));
    const p = periods[0];
    expect(p).toMatchObject({ trophies: 17, bestStreak: 88, signInDays: 21, activeDays: 19, done: 456, goal: 123, partial: months[0].partial });
    expect(periods[1].trophies).toBe(months[1].trophies);
    expect(periods[1].partial).toBe(months[1].partial);
  });

  it("counts a '2026-11' month as month 10 of 2026, key '2026-10'", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const p = periodsFromNumbers(buildAgentContext(state).past, { ...base, months: [{ ...base.months[0], month: "2026-11" }] })[0];
    expect(p.year).toBe(2026);
    expect(p.month).toBe(10);
    expect(p.key).toBe("2026-10");
  });

  it("holds the matching past weeks in each month, with their trophy", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const i = base.past_weeks.length - 1;
    const past = base.past_weeks.map((w, k) => (k === i ? { ...w, trophy: !w.trophy, done_met_hours: 123 } : w));
    const n: Numbers = { ...base, past_weeks: past };
    showNumbers(state, n);
    const periods = periodsFromNumbers(buildAgentContext(state).past, n);

    const november = periods[0];
    expect(november.weeks).toHaveLength(base.months[0].week_starts.length);
    const lastWeek = november.weeks[november.weeks.length - 1];
    expect(lastWeek.trophy).toBe(past[i].trophy);
    expect(lastWeek.done).toBe(123);
    expect(lastWeek.start).toEqual(new Date(2026, 10, 16));
    expect(november.weeks.map((w) => w.trophy)).toEqual(base.months[0].week_starts.map((start) => past.find((w) => w.week_start === start)!.trophy));
  });

  it("leaves out a week the context doesn't have", () => {
    const state = onboarded();
    const base = numbersLike(state, MONDAY);
    const m = { ...base.months[0], week_starts: [...base.months[0].week_starts, "2030-01-07"] };
    const p = periodsFromNumbers(buildAgentContext(state).past, { ...base, months: [m] })[0];
    expect(p.weeks).toHaveLength(base.months[0].week_starts.length);
  });
});
