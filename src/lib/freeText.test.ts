import { describe, expect, it } from "vitest";
import { matchActivity, parseEnergy, parseMinutes, parsePlace, parsePlanChanges, parseReason, parseYesNo } from "./freeText";

describe("free text", () => {
  it("reads times", () => {
    expect(parseMinutes("25")).toBe(25);
    expect(parseMinutes("about 40 min")).toBe(40);
    expect(parseMinutes("an hour")).toBe(60);
    expect(parseMinutes("1.5 hrs")).toBe(90);
    expect(parseMinutes("1 hour 15 minutes")).toBe(75);
    expect(parseMinutes("half an hour")).toBe(30);
    expect(parseMinutes("no time today")).toBe(0);
    expect(parseMinutes("whenever")).toBeNull();
  });

  it("reads places, energy and yes/no", () => {
    expect(parsePlace("stuck at work")).toBe("office");
    expect(parsePlace("at the gym")).toBeNull();
    expect(parseEnergy("pretty tired")).toBe("low");
    expect(parseEnergy("feeling great")).toBe("challenge");
    expect(parseEnergy("fine")).toBe("normal");
    expect(parseYesNo("yeah sure")).toBe(true);
    expect(parseYesNo("nope")).toBe(false);
    expect(parseYesNo("what's a MET?")).toBeNull();
  });

  it("matches activities from casual words", () => {
    expect(matchActivity("I biked to work")).toBe("cycling");
    expect(matchActivity("salsa")).toBe("dancing");
    expect(matchActivity("shot some hoops")).toBe("basketball");
    expect(matchActivity("pickleball")).toBeNull();
  });

  it("maps pain to the safety reason first", () => {
    expect(parseReason("my knee is sore and it's raining")).toBe("hurts");
    expect(parseReason("it's pouring rain")).toBe("weather");
    expect(parseReason("swamped with meetings")).toBe("no-time");
    expect(parseReason("my cat needs me")).toBe("other");
  });

  it("reads plan changes", () => {
    expect(parsePlanChanges("Thursday off, Saturday long")).toEqual({ 3: "off", 5: "45" });
    expect(parsePlanChanges("Mon 5 min, Tue 30 min; Fri desk only")).toEqual({ 0: "5", 1: "30", 4: "0" });
    expect(parsePlanChanges("weekends 45+ min")).toEqual({ 5: "45", 6: "45" });
    expect(parsePlanChanges("weekends are busy")).toEqual({ 5: "off", 6: "off" });
    expect(parsePlanChanges("more time later")).toEqual({});
  });
});
