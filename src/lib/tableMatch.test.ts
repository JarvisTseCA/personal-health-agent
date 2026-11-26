import { describe, expect, it } from "vitest";
import { labelOf, matchTable } from "./tableMatch";

const top = (text: string) => matchTable(text)[0]?.row.code;

describe("matching a typed exercise to the activity table", () => {
  it("finds everyday names", () => {
    expect(top("played badminton for 40 min")).toBe("15030");
    expect(top("walked the dog")).toBe("17165");
    expect(top("swam laps")).toBe("18240");
    expect(top("spin class")).toBe("01270");
    expect(top("45 min elliptical")).toBe("02048");
    expect(top("went for a jog")).toBe("12020");
    expect(matchTable("lifted weights for an hour")[0].row.heading).toBe("Conditioning Exercise");
  });

  it("returns nothing for words that aren't in the table", () => {
    expect(matchTable("gardening")).toEqual([]);
    expect(matchTable("30 min")).toEqual([]);
  });

  it("only searches rows marked as exercise", () => {
    expect(matchTable("using crutches").map((m) => m.row.code)).not.toContain("17140");
  });

  it("labels as the backend does", () => {
    expect(labelOf("Badminton, social singles and doubles, general")).toBe("Badminton, social singles and doubles");
    expect(labelOf("Basketball, game (Taylor Code 490)")).toBe("Basketball, game");
  });
});

describe("an activity-table id nobody registered", () => {
  it("is found in the bundled table, so a saved pick still shows after a reload", async () => {
    const { getVariant } = await import("./activities");
    await import("./tableActivities");
    const { family, variant } = getVariant("table-02064");
    expect(variant.label).toBe("Home exercise");
    expect(variant.met).toBe(3.8);
    expect(family.name).toBe("Home exercise");
    expect(() => getVariant("table-99999")).toThrow("Unknown activity variant");
  });
});
