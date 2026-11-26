/**
 * Phase 2: Today's suggestions from the activity table (POST /api/suggest/table), behind the
 * "Suggestions from" setting. The backend is faked here: each test hands the reducer functions
 * the reply the backend would send.
 */
import { describe, expect, it } from "vitest";
import { buildTableRequest, type BackendSuggestion } from "../services/backend";
import { buildSuggestInput } from "../services/context";
import { getVariant, settingOf } from "../lib/activities";
import { creditFor } from "../lib/met";
import { howTos } from "../lib/moves";
import type { Place, Suggestion } from "../lib/suggest";
import { codeOfTableId, registerTable, tableFamily, tableId, type TableActivity } from "../lib/tableActivities";
import { verifySuggestion } from "../lib/verify";
import { initialState, personaProfile } from "./store";
import * as T from "./today";
import type { AppState } from "./types";

const ROWS: Record<string, TableActivity> = {
  bike: { code: "01216", heading: "Bicycling", description: "Bicycling, stationary, 60 watts, light to moderate effort", label: "Bicycling, stationary, 60 watts", met: 5, places: ["gym"] },
  walk: { code: "17358", heading: "Walking", description: "Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade", label: "Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade", met: 4.8, places: ["gym", "home"] },
  run: { code: "12050", heading: "Running", description: "Running, 6-6.3 mph (10 min/mile)", label: "Running, 6-6.3 mph", met: 9.3, places: ["gym", "outside"] },
  trail: { code: "01003", heading: "Bicycling", description: "Bicycling, mountain, uphill, vigorous", label: "Bicycling, mountain, uphill", met: 14, places: ["outside"] },
};

function pick(row: TableActivity, minutes: number): Suggestion {
  const id = tableId(row.code);
  return { familyId: id, variantId: id, durationMin: minutes, met: row.met, credit: creditFor(row.met, minutes), rawMetHours: (row.met * minutes) / 60, reasons: ["Fits in 30 min"], score: 0.7 };
}

/** What fetchTableSuggestion returns for a reply with these rows. */
function reply(rows: TableActivity[], minutes = 20): BackendSuggestion {
  return {
    source: "mock", model: "mock", logId: 1, lead: pick(rows[0], minutes), backups: rows.slice(1).map((r) => pick(r, minutes)),
    jevRequest: {}, jevAnswers: {}, rows,
  };
}

function onboarded(source: "library" | "table" = "table"): AppState {
  let s = initialState("alex");
  s = { ...s, onboarded: true, profile: personaProfile(s), suggestSource: source };
  return T.startDay(s);
}

const LABEL: Record<Place, string> = { indoors_private: "Indoors, private", indoors_with_others: "Indoors, with others", outside: "Outside" };

function checkIn(s: AppState, place: Place = "indoors_with_others"): AppState {
  s = T.answerTime(s, "30 min", 30);
  s = T.answerPlace(s, LABEL[place], place);
  return T.answerEnergy(s, "Normal", "normal");
}

/** A check-in whose pick came back from the table. */
function withTablePick(place: Place = "indoors_with_others", rows = [ROWS.bike, ROWS.walk, ROWS.run]): AppState {
  const s = checkIn(onboarded(), place);
  return T.applyBackendSuggestion(s, s.today.current!.lead, reply(rows));
}

describe("suggestions from the activity table", () => {
  it("waits for the table's pick, then shows it", () => {
    const s = checkIn(onboarded());
    expect(s.today.current!.pending).toBe(true);

    const after = T.applyBackendSuggestion(s, s.today.current!.lead, reply([ROWS.bike, ROWS.walk, ROWS.run]));
    expect(after.today.current!.pending).toBe(false);
    expect(after.today.current!.lead.variantId).toBe("table-01216");
    expect(after.today.current!.backups.map((b) => b.variantId)).toEqual(["table-17358", "table-12050"]);
    expect(Object.keys(after.tableActivities!).sort()).toEqual(["01216", "12050", "17358"]);
  });

  it("shows the in-app pick when the backend fails or is too slow", () => {
    const s = checkIn(onboarded());
    const lead = s.today.current!.lead;
    const after = T.backendFailed(s, lead);
    expect(after.today.current!.pending).toBe(false);
    expect(after.today.current!.lead).toBe(lead);
    // A late answer for a pick the user has moved on from changes nothing.
    expect(T.backendFailed(after, lead)).toBe(after);
  });

  it("with the built-in list, nothing waits", () => {
    expect(checkIn(onboarded("library")).today.current!.pending).toBe(false);
  });

  it("a table row works wherever the app looks activities up", () => {
    const s = withTablePick();
    const { family, variant } = getVariant("table-01216");
    expect(family.name).toBe("Bicycling, stationary, 60 watts");
    expect(variant.met).toBe(5);
    expect(settingOf(family, variant)).toBe("indoor");
    expect(settingOf(tableFamily(ROWS.trail), tableFamily(ROWS.trail).variants[0])).toBe("outdoor");
    // MET-hours: the row's MET × minutes ÷ 60, from the calculator.
    expect(s.today.current!.lead.credit).toBeCloseTo(creditFor(5, 20));
    const accepted = T.accept(s, s.today.current!.lead);
    expect(accepted.today.entries.at(-1)!.text).toBe("Nice. 20 min of bicycling, stationary, 60 watts. I'll watch for it on your Fitbit and count it when it syncs.");
  });

  it("a reload keeps today's pick: the saved rows are registered again", () => {
    const s = withTablePick();
    const saved = JSON.parse(JSON.stringify(s)) as AppState;
    registerTable(Object.values(saved.tableActivities!));
    expect(getVariant(saved.today.current!.lead.variantId).family.name).toBe("Bicycling, stationary, 60 watts");
  });

  it("the verifier passes a table pick that fits", () => {
    const s = withTablePick();
    const checks = verifySuggestion(s.today.current!.lead, buildSuggestInput(s));
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("Show me how only where the library has a how-to for the same Compendium code", () => {
    expect(howTos("table-99999")).toEqual([]);
    registerTable([{ ...ROWS.bike, code: "02101", heading: "Conditioning Exercise", label: "Stretching, mild", description: "Stretching, mild", met: 2.3 }]);
    expect(howTos("table-02101")).toEqual(howTos("desk-stretch"));
  });
});

describe("the table request", () => {
  it("sends likes, dislikes and what applies everywhere, and no options", () => {
    let s = onboarded();
    s = { ...s, profile: { ...s.profile, categoryPrefs: { Running: "like", Dancing: "dislike" } } };
    const body = buildTableRequest(checkIn(s));
    expect(body).not.toHaveProperty("options");
    expect(body.liked_categories).toEqual(["Running"]);
    expect(body.exclude_headings).toEqual(["Dancing"]);
    expect(body.check_in.place).toBe("indoors_with_others");
    expect(body.durations.length).toBeGreaterThan(0);
    expect(body.indoor_only).toBe(false);
    expect(body.below_met).toBeNull();
  });

  it("each place learns only from what was accepted there", () => {
    const accepted = T.accept(withTablePick("indoors_with_others"), withTablePick("indoors_with_others").today.current!.lead);
    expect(accepted.profile.pickedCodes).toEqual({ indoors_with_others: ["01216"] });

    const again = (place: Place) => buildTableRequest(checkIn(T.startDay({ ...accepted, today: { ...accepted.today, dayKey: "" } }), place));
    expect(again("indoors_with_others").picked_codes).toEqual(["01216"]);
    expect(again("indoors_private").picked_codes).toEqual([]);
    expect(again("outside").picked_codes).toEqual([]);
  });

  it("before any feedback, the two indoor places send the same history", () => {
    const strip = (b: ReturnType<typeof buildTableRequest>) => ({ ...b, check_in: { ...b.check_in, place: "?" }, equipment_here: null });
    expect(strip(buildTableRequest(checkIn(onboarded(), "indoors_private")))).toEqual(strip(buildTableRequest(checkIn(onboarded(), "indoors_with_others"))));
  });

  it("a decline is saved with its place and only sent for that place", () => {
    let s = withTablePick("indoors_with_others");
    s = T.chooseReason(T.decline(s), "not-mood");
    expect(s.declines.at(-1)).toMatchObject({ familyId: "table-01216", reason: "not-mood", place: "indoors_with_others" });

    const here = buildTableRequest(s);
    expect(here.declines.some((d) => d.code === "01216" && d.reason === "not-mood")).toBe(true);
    const elsewhere = buildTableRequest(T.answerPlace(T.answerTime(T.startDay({ ...s, today: { ...s.today, dayKey: "" } }), "30 min", 30), "Outside", "outside"));
    expect(elsewhere.declines.some((d) => d.code === "01216")).toBe(false);
  });

  it("each decline reason reaches the request", () => {
    const after = (reason: Parameters<typeof T.chooseReason>[1]) => buildTableRequest(T.chooseReason(T.decline(withTablePick()), reason));

    // Ruled out for the rest of today; the decline (sent with its reason) keeps it down for the week.
    expect(after("not-mood").exclude_codes).toEqual(["01216"]);
    expect(after("no-access").exclude_codes).toEqual(["01216"]);
    expect(after("other").exclude_codes).toEqual(["01216"]);
    expect(after("recent").exclude_headings).toContain("Bicycling");
    expect(after("weather").indoor_only).toBe(true);
    expect(after("tired").below_met).not.toBeNull();
  });

  it("after all three table picks are passed over, the next request leaves them out", () => {
    let s = withTablePick();
    s = T.anotherOption(T.anotherOption(T.anotherOption(s)));
    expect(s.today.current!.pending).toBe(true); // waiting for a fresh set from the table
    expect(buildTableRequest(s).exclude_codes).toEqual(expect.arrayContaining(["01216", "17358", "12050"]));
  });

  it("recent workouts from the table carry their code", () => {
    let s = withTablePick();
    s = { ...s, sessions: [...s.sessions, { id: "x", variantId: "table-01216", durationMin: 20, dayIndex: s.todayIndex - 1, source: "fitbit", confirmed: true }] };
    const body = buildTableRequest(s);
    expect(body.recent.find((r) => r.family_id === "table-01216")).toMatchObject({ code: "01216", name: "Bicycling, stationary, 60 watts", days_ago: 1 });
    expect(body.recent.filter((r) => !r.family_id.startsWith("table-")).every((r) => r.code === null)).toBe(true);
    expect(codeOfTableId("table-01216")).toBe("01216");
  });
});
