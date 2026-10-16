import { describe, expect, it } from "vitest";
import { PERSONAS } from "../data/mockFitbit";
import { getVariant, settingOf } from "./activities";
import { goalOffer } from "./goal";
import { streakOf, weekMedals } from "./medals";
import { creditFor, intensityOf, metHours, minutesFor, totalsFor, withCredit } from "./met";
import { dailyTargets, unplannedLeft, type WeekPlan } from "./plan";
import { afterDecline, suggest, type SuggestInput } from "./suggest";
import { verifySuggestion } from "./verify";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("MET-hours", () => {
  it("matches the guideline: 150 min at 3 MET = 75 min at 6 MET = 7.5", () => {
    close(metHours(3, 150), 7.5);
    close(metHours(6, 75), 7.5);
  });

  it("classifies intensity and leaves light activity out of the goal", () => {
    expect(intensityOf(2.3)).toBe("light");
    expect(intensityOf(4.8)).toBe("moderate");
    expect(intensityOf(6)).toBe("vigorous");
    expect(creditFor(2.3, 30)).toBe(0);
    close(creditFor(6, 30), 3);
  });

  it("counts unconfirmed Fitbit bouts at the bottom of their band", () => {
    const s = withCredit({ id: "x", variantId: "cycling-commute", durationMin: 30, dayIndex: 0, source: "fitbit", confirmed: false, band: "very" });
    close(s.credit, 3); // 6.0 MET, not the guessed 6.8
  });

  it("rounds minutes up to 5", () => {
    expect(minutesFor(6, 1.5)).toBe(15);
    expect(minutesFor(4.3, 1.9)).toBe(30);
  });
});

describe("daily targets", () => {
  const plan: WeekPlan = ["medium", "off", "medium", "off", "off", "long", "off"];

  it("splits the goal by time on each available day; off days get nothing", () => {
    const p: WeekPlan = ["medium", "off", "medium", "off", "off", "long", "off"];
    const t = dailyTargets(7.5, p, Array(7).fill(0), 0);
    close(t[0], (7.5 * 30) / 105);
    expect(t[1]).toBe(0);
    close(t[5], (7.5 * 45) / 105);
    close(t.reduce((a, b) => a + b, 0), 7.5);
  });

  it("re-divides what's left after a mid-week change (doc example: 4.5 left → 1.5 Fri, 3.0 Sat)", () => {
    // 3.0 done by Wednesday night, Thursday marked off, Friday 30 min, Saturday 60 min.
    const SIXTY = ["off", "off", "off", "off", "medium", "long", "off"] as WeekPlan;
    const done = [1, 1, 1, 0, 0, 0, 0];
    const t = dailyTargets(7.5, SIXTY, done, 2);
    // "Long" is 45 min in the app, so the split is 1.8 / 2.7 rather than the doc's 30/60 example.
    close(t[4] + t[5], 4.5);
    close(t[4] / t[5], 30 / 45);
    expect(t[3]).toBe(0);
  });

  it("extra effort today lowers later days but not today's own target", () => {
    const before = dailyTargets(7.5, plan, [0, 0, 0, 0, 0, 0, 0], 2);
    const after = dailyTargets(7.5, plan, [0, 0, 5, 0, 0, 0, 0], 2); // today's target is 3.0; 5 beats it
    close(after[2], before[2]);
    expect(after[5]).toBeLessThan(before[5]);
  });

  it("never lowers the weekly goal because of off days", () => {
    const allOffButSun: WeekPlan = ["off", "off", "off", "off", "off", "off", "short"];
    close(dailyTargets(7.5, allOffButSun, Array(7).fill(0), 0)[6], 7.5);
  });

  it("reports what no remaining day can absorb (today and the rest of the week are off)", () => {
    const p: WeekPlan = ["medium", "medium", "off", "off", "off", "off", "off"];
    close(unplannedLeft(7.5, p, [1, 1, 0, 0, 0, 0, 0], 2), 5.5);
    expect(unplannedLeft(7.5, p, [1, 1, 0, 0, 0, 0, 0], 1)).toBe(0); // Tuesday still has time, so it takes the rest
  });
});

describe("medals and streaks", () => {
  it("bronze for any activity, silver for hitting the day's target", () => {
    const m = weekMedals([true, true, false, false, false, false, false], [0, 2, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1.5], 2, 7.5);
    expect(m.slice(0, 3)).toEqual(["bronze", "silver", "none"]);
  });

  it("turns every medal that week gold once the weekly goal is met", () => {
    const m = weekMedals([true, true, false, true, false, false, false], [0.5, 4, 0, 3.5, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1], 8, 7.5);
    expect(m.filter((x) => x === "gold").length).toBe(3);
    expect(m[2]).toBe("none");
  });

  it("needs a medal every day; today is pending until it ends", () => {
    expect(streakOf(["bronze", "silver", "none"]).current).toBe(2);
    expect(streakOf(["bronze", "silver", "none"]).todayPending).toBe(true);
    expect(streakOf(["bronze", "none", "gold"]).current).toBe(1);
    expect(streakOf(["gold", "gold", "none", "bronze"]).best).toBe(2);
  });
});

describe("goal adjustment", () => {
  it("raises to the lower of the last 2 weeks, rounded down to 2.5 (doc: 11.0 and 10.3 → 10)", () => {
    expect(goalOffer(7.5, [11.0, 10.3])).toMatchObject({ kind: "raise", to: 10 });
  });

  it("keeps the goal when the rounded value isn't higher (doc: 9.2 and 8.4 → 7.5)", () => {
    expect(goalOffer(7.5, [9.2, 8.4]).kind).toBe("keep");
  });

  it("halves after 3 weeks under 50% (doc: 3.0, 2.6, 3.4 → 3.75)", () => {
    expect(goalOffer(7.5, [3.0, 2.6, 3.4])).toMatchObject({ kind: "lower", to: 3.75 });
    expect(goalOffer(7.5, [3.0, 4.0, 3.4]).kind).toBe("keep");
  });

  it("applies the same rules below 7.5 (doc: 3.75 with 6.1 and 5.4 → 5)", () => {
    expect(goalOffer(3.75, [6.1, 5.4])).toMatchObject({ kind: "raise", to: 5 });
  });

  it("never changes a clinician-set goal", () => {
    expect(goalOffer(7.5, [3, 2, 3], true).kind).toBe("keep");
  });

  it("each demo persona triggers the offer its blurb promises", () => {
    const totals = (id: string) => PERSONAS.find((p) => p.id === id)!.history.map((w) => totalsFor(w.sessions).done);
    expect(goalOffer(7.5, totals("alex")).kind).toBe("keep");
    expect(goalOffer(7.5, totals("roll"))).toMatchObject({ kind: "raise", to: 10 });
    expect(goalOffer(7.5, totals("tough"))).toMatchObject({ kind: "lower", to: 3.75 });
  });
});

describe("suggestions", () => {
  const base: SuggestInput = {
    enjoyed: ["cycling", "dancing", "walking"],
    access: { cycling: "have", dancing: "have", walking: "have" },
    noVigorous: false, maxSessionMin: null, minutes: 30, place: "home", energy: "normal", mood: "surprise",
    needed: 1.9, boost: false, recent: [], declines: [], exclude: [],
  };

  it("only suggests enjoyed, accessible activities that fit the time", () => {
    const r = suggest({ ...base, access: { ...base.access, cycling: "no" } });
    for (const s of [r.lead!, ...r.backups]) {
      expect(["dancing", "walking"]).toContain(s.familyId);
      expect(s.durationMin).toBeLessThanOrEqual(30);
    }
  });

  it("gives backups of a different type when it can", () => {
    const r = suggest(base);
    expect(r.backups.length).toBe(2);
    expect(r.backups[0].familyId).not.toBe(r.lead!.familyId);
  });

  it("avoids yesterday's activity", () => {
    const r = suggest({ ...base, recent: [{ familyId: "cycling", daysAgo: 1, dayName: "Tue" }] });
    expect(r.lead!.familyId).not.toBe("cycling");
  });

  it("offers desk moves when there's no time", () => {
    const r = suggest({ ...base, minutes: 0, place: "office" });
    expect(r.desk).toBe(true);
    expect(r.lead!.familyId).toBe("desk");
  });

  it("never suggests vigorous activity with a health flag", () => {
    const r = suggest({ ...base, noVigorous: true, energy: "challenge", minutes: 60, needed: 4 });
    for (const s of [r.lead!, ...r.backups]) expect(s.met).toBeLessThan(6);
  });

  it("goes indoors after a weather decline and lighter after 'too tired'", () => {
    const first = suggest(base).lead!;
    const indoor = suggest({ ...base, constraint: afterDecline("weather", first).constraint });
    const { family, variant } = getVariant(indoor.lead!.variantId);
    expect(settingOf(family, variant)).toBe("indoor");
    const lighter = suggest({ ...base, constraint: afterDecline("tired", first).constraint });
    expect(lighter.lead!.met).toBeLessThan(first.met);
  });

  it("passes every verifier check", () => {
    const r = suggest(base);
    expect(verifySuggestion(r.lead!, base).every((c) => c.ok)).toBe(true);
  });
});
