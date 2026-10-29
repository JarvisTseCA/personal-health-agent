import { describe, expect, it } from "vitest";
import { PERSONAS } from "../data/mockFitbit";
import { getFamily, getVariant, settingOf } from "./activities";
import { EQUIPMENT, parseEquipment, parseEquipmentFeedback } from "./equipment";
import { SAMPLE_PHOTO_SIZE, SAMPLE_PHOTOS } from "../data/samplePhotos";
import { howTos, movesFor } from "./moves";
import { goalOffer } from "./goal";
import { runsOf, streakOf, trophyEarned } from "./rewards";
import { creditFor, intensityOf, metHours, minutesFor, totalsFor, withCredit } from "./met";
import { dailyTargets, migratePlan, SLOT_ROWS, unplannedLeft, type WeekPlan } from "./plan";
import { slotForMinutes } from "./freeText";
import { afterDecline, challengePlan, suggest, type SuggestInput } from "./suggest";
import { verifySuggestion } from "./verify";
import { buildAgentContext } from "../services/context";
import { initialState, personaProfile } from "../state/store";

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
  const plan: WeekPlan = ["30", "off", "30", "off", "off", "45", "off"];

  it("splits the goal by time on each available day; off days get nothing", () => {
    const p: WeekPlan = ["30", "off", "30", "off", "off", "45", "off"];
    const t = dailyTargets(7.5, p, Array(7).fill(0), 0);
    close(t[0], (7.5 * 30) / 105);
    expect(t[1]).toBe(0);
    close(t[5], (7.5 * 45) / 105);
    close(t.reduce((a, b) => a + b, 0), 7.5);
  });

  it("re-divides what's left after a mid-week change (doc example: 4.5 left → 1.5 Fri, 3.0 Sat)", () => {
    // 3.0 done by Wednesday night, Thursday marked off, Friday 30 min, Saturday 60 min.
    const SIXTY = ["off", "off", "off", "off", "30", "45", "off"] as WeekPlan;
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
    const allOffButSun: WeekPlan = ["off", "off", "off", "off", "off", "off", "10"];
    close(dailyTargets(7.5, allOffButSun, Array(7).fill(0), 0)[6], 7.5);
  });

  it("reports what no remaining day can absorb (today and the rest of the week are off)", () => {
    const p: WeekPlan = ["30", "30", "off", "off", "off", "off", "off"];
    close(unplannedLeft(7.5, p, [1, 1, 0, 0, 0, 0, 0], 2), 5.5);
    expect(unplannedLeft(7.5, p, [1, 1, 0, 0, 0, 0, 0], 1)).toBe(0); // Tuesday still has time, so it takes the rest
  });
});

describe("streaks and trophies", () => {
  it("counts days in a row the app was opened, ending today", () => {
    expect(streakOf([true, true, true])).toEqual({ current: 3, best: 3 });
    expect(streakOf([true, true, false, true])).toEqual({ current: 1, best: 2 });
    expect(streakOf([false, false, true])).toEqual({ current: 1, best: 1 });
  });

  it("finds runs of days in a row for the calendar bands", () => {
    expect(runsOf([true, true, false, true, false, true, true])).toEqual([[0, 2], [3, 1], [5, 2]]);
    expect(runsOf([false, false, false, false, false, false, false])).toEqual([]);
  });

  it("earns a trophy when the week reaches its goal", () => {
    expect(trophyEarned(7.5, 7.5)).toBe(true);
    expect(trophyEarned(7.49, 7.5)).toBe(false);
  });

  it("each persona's streak matches its blurb on the demo's Wednesday", () => {
    const streak = (id: string) => {
      let st = initialState(id);
      st = { ...st, onboarded: true, profile: personaProfile(st) };
      return buildAgentContext(st).streak.current;
    };
    expect(streak("alex")).toBe(12);
    expect(streak("tough")).toBe(1);
    expect(streak("fresh")).toBe(1);
  });
});

describe("equipment", () => {
  it("reads equipment from typed text", () => {
    expect(parseEquipment("two dumbbells, a yoga mat and a spin bike").sort()).toEqual(["dumbbells", "stationary-bike", "yoga-mat"]);
    expect(parseEquipment("kettle bell + resistance bands").sort()).toEqual(["kettlebell", "resistance-bands"]);
    expect(parseEquipment("nothing really")).toEqual([]);
  });

  it("reads the user's feedback on the photo analysis", () => {
    expect(parseEquipmentFeedback("no kettlebell, but I also have a jump rope")).toEqual({ add: ["jump-rope"], remove: ["kettlebell"], confirmed: false });
    expect(parseEquipmentFeedback("you missed the pull-up bar")).toMatchObject({ add: ["pullup-bar"], remove: [] });
    expect(parseEquipmentFeedback("There's no bench and no rower").remove.sort()).toEqual(["bench", "rowing-machine"]);
    expect(parseEquipmentFeedback("I don't have a kettlebell and I have a treadmill")).toMatchObject({ add: ["treadmill"], remove: ["kettlebell"] });
    expect(parseEquipmentFeedback("that's not a resistance band, it's a jump rope")).toMatchObject({ add: ["jump-rope"], remove: ["resistance-bands"] });
    expect(parseEquipmentFeedback("Yes, that's right").confirmed).toBe(true);
    expect(parseEquipmentFeedback("the plant is fake")).toEqual({ add: [], remove: [], confirmed: false });
  });

  it("the sample photos' analysis uses real equipment ids and stays inside the picture", () => {
    const ids = new Set(EQUIPMENT.map((e) => e.id));
    for (const photo of Object.values(SAMPLE_PHOTOS)) {
      expect(photo.detections.length).toBeGreaterThan(2);
      for (const d of photo.detections) {
        expect(ids.has(d.id)).toBe(true);
        const [x, y, w, h] = d.box;
        expect(x >= 0 && y >= 0 && x + w <= SAMPLE_PHOTO_SIZE.w && y + h <= SAMPLE_PHOTO_SIZE.h).toBe(true);
      }
    }
  });

  it("only suggests equipment that's where the user is", () => {
    const input: SuggestInput = {
      enjoyed: ["strength", "rowing"], access: { strength: "have", rowing: "have" }, noVigorous: false, maxSessionMin: null,
      minutes: 30, place: "home", energy: "normal", mood: "surprise", needed: 1.5, boost: false, recent: [], declines: [], exclude: [],
      equipmentHere: ["yoga-mat"],
    };
    const r = suggest(input);
    expect(r.lead!.variantId).toMatch(/^strength-(bodyweight|hard)$/);
    expect([r.lead!, ...r.backups].some((x) => x.familyId === "rowing")).toBe(false);
    const gym = suggest({ ...input, place: "gym", equipmentHere: ["rowing-machine", "dumbbells"] });
    expect([gym.lead!, ...gym.backups].map((x) => x.familyId)).toContain("rowing");
  });

  it("at the gym, suggests indoor activities only", () => {
    const r = suggest({
      enjoyed: ["cycling", "walking"], access: { cycling: "have", walking: "have" }, noVigorous: false, maxSessionMin: null,
      minutes: 30, place: "gym", energy: "normal", mood: "surprise", needed: 1.5, boost: false, recent: [], declines: [], exclude: [],
      equipmentHere: ["stationary-bike", "treadmill"],
    });
    for (const x of [r.lead!, ...r.backups]) {
      const { family, variant } = getVariant(x.variantId);
      expect(settingOf(family, variant)).toBe("indoor");
    }
  });

  it("builds the circuit from what's there, with how-to videos", () => {
    expect(movesFor("strength-weights", ["dumbbells"])[0].name).toBe("Dumbbell goblet squat");
    expect(movesFor("strength-weights", ["resistance-bands"])[1].name).toBe("Resistance band row");
    expect(movesFor("strength-bodyweight")[0].video?.id).toBe("8uoaYwS6iFM");
    expect(howTos("cycling-spin")[0].what).toBe("setting up the bike");
    expect(howTos("walking-brisk")).toEqual([]);
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

  it("aims for today's target when normal, and 1.5× it when up for a challenge", () => {
    const target = 1.3;
    const normal = suggest({ ...base, minutes: 60, needed: target, target }).lead!;
    const hard = suggest({ ...base, minutes: 60, needed: target, target, energy: "challenge" }).lead!;
    expect(normal.credit + 1e-9).toBeGreaterThanOrEqual(target);
    expect(normal.credit).toBeLessThan(target * 1.5);
    expect(hard.credit + 1e-9).toBeGreaterThanOrEqual(target * 1.5);
  });

  it("counts what's already done today toward the 1.5× challenge", () => {
    // Target 1.3, 0.8 done: a challenge aims for 1.95 total, so 1.15 more.
    const hard = suggest({ ...base, minutes: 60, needed: 0.5, target: 1.3, energy: "challenge" }).lead!;
    expect(hard.credit + 1e-9).toBeGreaterThanOrEqual(1.15);
    expect(hard.reasons).toContain("Goes past today's target");
  });

  it("reaches a challenge with a harder pace, not a longer session", () => {
    for (const enjoyed of [["cycling"], ["dancing"], ["walking"], ["running"], ["strength"]]) {
      const input = { ...base, enjoyed, access: { [enjoyed[0]]: "have" as const }, needed: 1.3, target: 1.3 };
      const normal = suggest(input).lead!;
      const hard = suggest({ ...input, energy: "challenge" }).lead!;
      expect(hard.familyId).toBe(normal.familyId);
      expect(hard.met).toBeGreaterThan(normal.met);
      expect(hard.durationMin).toBeLessThanOrEqual(normal.durationMin);
      expect(hard.credit + 1e-9).toBeGreaterThanOrEqual(1.3 * 1.5);
    }
  });

  it("keeps the usual length and picks the gentlest pace that reaches 1.5×", () => {
    const dancing = getFamily("dancing").variants;
    const plan = challengePlan(dancing, [10, 15, 20, 25, 30], 1.3, 1.95)!;
    expect(plan.usualMin).toBe(20); // salsa (4.8 MET) needs 20 min for 1.3
    expect(plan.variant.id).toBe("dancing-ballroom"); // 6.0 MET × 20 min = 2.0, not nightclub (9.8)
    expect(plan.durationMin).toBe(20);
    expect(plan.longer).toBe(false);
  });

  it("only goes longer when no harder pace gets there", () => {
    const yoga = getFamily("yoga").variants; // power yoga (4.0) is the only pace that counts
    const plan = challengePlan(yoga, [10, 15, 20, 25, 30], 1.3, 1.95)!;
    expect(plan.variant.id).toBe("yoga-power");
    expect(plan.longer).toBe(true);
    expect(plan.durationMin).toBe(30);
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

describe("day options", () => {
  it("match Today's list, laid out as Off / 0, 5, 10, 30 / 45+", () => {
    expect(SLOT_ROWS).toEqual([["off"], ["0", "5", "10", "30"], ["45"]]);
  });

  it("convert plans saved as Short/Medium/Long", () => {
    expect(migratePlan(["short", "off", "medium", "long", "10", "0", "45"])).toEqual(["10", "off", "30", "45", "10", "0", "45"]);
  });

  it("round typed minutes down to an option", () => {
    expect([0, 3, 5, 15, 20, 30, 40, 60].map(slotForMinutes)).toEqual(["0", "0", "5", "10", "10", "30", "30", "45"]);
  });

  it("give 0-min days no target and split the goal by minutes", () => {
    const t = dailyTargets(7.5, ["0", "10", "30", "off", "5", "45", "0"], Array(7).fill(0), 0);
    expect(t[0]).toBe(0);
    expect(t[3]).toBe(0);
    expect(t[5] / t[1]).toBeCloseTo(4.5);
  });
});
