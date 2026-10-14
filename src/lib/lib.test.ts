import { describe, expect, it } from "vitest";
import { guidelineMinutes, intensityOf, summarizeWeek } from "./guideline";
import { buildPlanOptions } from "./planner";

describe("guideline minutes", () => {
  it("classifies intensity by MET", () => {
    expect(intensityOf(2.3)).toBe("light");
    expect(intensityOf(4.8)).toBe("moderate");
    expect(intensityOf(6.0)).toBe("vigorous");
  });

  it("counts vigorous minutes double and light minutes not at all", () => {
    expect(guidelineMinutes(4.3, 30)).toBe(30);
    expect(guidelineMinutes(9.0, 30)).toBe(60);
    expect(guidelineMinutes(2.3, 30)).toBe(0);
  });

  it("summarizes a week", () => {
    const w = summarizeWeek([
      { id: "a", variantId: "cycling-easy", durationMin: 25, dayIndex: 0, source: "fitbit" },
      { id: "b", variantId: "cycling-spin", durationMin: 30, dayIndex: 1, source: "fitbit" },
    ]);
    expect(w.doneMinutes).toBe(85);
    expect(w.remainingMinutes).toBe(65);
    expect(w.clockMinutesUsed).toBe(55);
  });
});

describe("planner", () => {
  const base = { remainingMinutes: 105, timeLeftMinutes: 75, familyIds: ["cycling", "dancing"], openDays: [2, 3, 4, 5, 6] };

  it("returns options that each cover the remaining gap", () => {
    const opts = buildPlanOptions(base);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.creditMinutes).toBeGreaterThanOrEqual(105);
  });

  it("only uses activities the user enjoys", () => {
    const opts = buildPlanOptions(base);
    for (const o of opts) for (const s of o.sessions) expect(["cycling", "dancing"]).toContain(s.familyId);
  });

  it("keeps blocks short", () => {
    for (const o of buildPlanOptions(base)) for (const s of o.sessions) expect(s.durationMin).toBeLessThanOrEqual(30);
  });

  it("avoids vigorous options when the user reports a health condition", () => {
    const opts = buildPlanOptions({ ...base, cautious: true, timeLeftMinutes: 200 });
    for (const o of opts) expect(o.hasVigorous).toBe(false);
  });

  it("returns nothing when the goal is already met", () => {
    expect(buildPlanOptions({ ...base, remainingMinutes: 0 })).toEqual([]);
  });
});
