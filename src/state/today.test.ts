import { describe, expect, it } from "vitest";
import { buildSuggestRequest, type BackendSuggestion } from "../services/backend";
import { buildAgentContext, equipmentAt, reachedToday, serializeContext, TYPICAL_GYM } from "../services/context";
import { initialState, personaProfile } from "./store";
import * as T from "./today";
import { applyClinicianTurn } from "../services/clinicianChat";
import { isHidden } from "./screens";
import type { AppState } from "./types";
import { getVariant, settingOf } from "../lib/activities";
import { migratePlace, type Place } from "../lib/suggest";

function onboarded(persona = "alex"): AppState {
  let s = initialState(persona);
  s = { ...s, onboarded: true, profile: personaProfile(s) };
  return T.startDay(s);
}

function checkIn(s: AppState, minutes = 30, place: Place = "indoors_private"): AppState {
  s = T.answerTime(s, `${minutes} min`, minutes);
  if (minutes === 0) return s;
  s = T.answerPlace(s, T.PLACE_OPTIONS.find(([, p]) => p === place)![0], place);
  return T.answerEnergy(s, "Normal", "normal");
}

describe("today flow", () => {
  it("offers three places: indoors private, indoors with others (gym included), outside", () => {
    expect(T.PLACE_OPTIONS.map(([label]) => label)).toEqual(["Indoors, private", "Indoors, with others", "Outside"]);
    const s = T.answerTime(onboarded(), "30 min", 30);
    expect(s.today.step).toBe("place");
    expect(s.today.entries.at(-1)!.text).toBe("Where will you be exercising?");
  });

  it("asks again when a typed place is none of the three", () => {
    let s = T.answerTime(onboarded(), "30 min", 30);
    s = T.freeText(s, "at the airport");
    expect(s.today.step).toBe("place");
    expect(s.today.entries.at(-1)!.text).toBe(T.PLACE_AGAIN);
    s = T.freeText(s, "my hotel room");
    expect(s.today.checkIn.place).toBe("indoors_private");
    expect(s.today.step).toBe("energy");
  });

  it("indoors, nothing outdoor is suggested", () => {
    for (const place of ["indoors_private", "indoors_with_others"] as Place[]) {
      const c = checkIn(onboarded(), 30, place).today.current!;
      for (const x of [c.lead!, ...c.backups]) {
        const { family, variant } = getVariant(x.variantId);
        expect(settingOf(family, variant), x.variantId).not.toBe("outdoor");
      }
    }
  });

  it("indoors with others assumes a typical gym's equipment", () => {
    const s = onboarded();
    const withGear = { ...s, profile: { ...s.profile, equipment: { home: [], gym: null } } };
    expect(equipmentAt(withGear, "indoors_with_others")).toEqual(TYPICAL_GYM);
    expect(equipmentAt(withGear, "indoors_private")).toEqual([]);
  });

  it("reads places saved before the three places", () => {
    expect(migratePlace("home")).toBe("indoors_private");
    expect(migratePlace("gym")).toBe("indoors_with_others");
    expect(migratePlace("office")).toBe("indoors_with_others");
    expect(migratePlace("outside")).toBe("outside");
    expect(migratePlace("other")).toBeUndefined();
  });

  it("check-in leads to one pick, with liked activities in the mix", () => {
    const s = checkIn(onboarded(), 30, "outside");
    expect(s.today.step).toBe("suggested");
    const c = s.today.current!;
    // Alex cycled yesterday and walked two days ago, so a new activity can lead; a liked one stays among the options.
    expect([c.lead, ...c.backups].some((x) => s.profile.enjoyed.includes(x.familyId))).toBe(true);
  });

  it("a new user with no likes and no equipment still gets a real suggestion", () => {
    let s = initialState("alex");
    s = T.startDay({ ...s, onboarded: true, profile: { ...personaProfile(s), enjoyed: [], access: {}, equipment: undefined } });
    s = checkIn(s);
    expect(s.today.step).toBe("suggested");
    expect(s.today.current!.desk).toBeFalsy();
  });

  it("today counts as complete only on a day with a target, once it's met", () => {
    expect(reachedToday({ todayTarget: 1.2, todayDone: 1.2 })).toBe(true);
    expect(reachedToday({ todayTarget: 1.2, todayDone: 1.19 })).toBe(false);
    expect(reachedToday({ todayTarget: 0, todayDone: 0 })).toBe(false);
    expect(reachedToday({ todayTarget: 0, todayDone: 2 })).toBe(false);
  });

  it("sends category likes to the backend and leaves disliked categories out", () => {
    let s = onboarded();
    s = { ...s, profile: { ...s.profile, categoryPrefs: { Walking: "like", Bicycling: "dislike" } } };
    s = T.answerTime(s, "30 min", 30); s = T.answerPlace(s, "Outside", "outside"); s = T.answerEnergy(s, "Normal", "normal");
    const body = buildSuggestRequest(s);
    expect(body.liked_categories).toEqual(["Walking"]);
    expect(body.options.every((o) => o.category !== "Bicycling")).toBe(true);
    expect(body.options.some((o) => o.category === "Walking")).toBe(true);
    const user = serializeContext(buildAgentContext(s)).user;
    expect(user.categories_they_like).toEqual(["Walking"]);
    expect(user.categories_they_dislike).toEqual(["Bicycling"]);
  });

  it("while Summary is hidden, Chat points to Preferences instead of the Summary tab", () => {
    expect(isHidden("summary")).toBe(true);
    const s = applyClinicianTurn(onboarded(), "My doctor said keep it moderate for now");
    expect(s.chat.at(-1)!.text).not.toMatch(/Summary tab/);
    expect(s.chat.at(-1)!.text).toMatch(/Preferences/);
  });

  it("a gym with nothing listed counts as a typical gym, even on saves that said no gym", () => {
    let s = initialState("fresh");
    s = { ...s, onboarded: true, profile: personaProfile(s) };
    expect(s.profile.equipment?.gym).toBeNull();
    expect(equipmentAt(s, "indoors_with_others")).toEqual(TYPICAL_GYM);
    expect(serializeContext(buildAgentContext(s)).user.equipment_at_gym).toContain("Treadmill");
  });

  it("accepting a suggestion adds it to the user's likes, once", () => {
    let s = initialState("alex");
    s = T.startDay({ ...s, onboarded: true, profile: { ...personaProfile(s), enjoyed: [], access: {} } });
    s = checkIn(s);
    const lead = s.today.current!.lead;
    s = T.accept(s, lead);
    expect(s.profile.enjoyed).toEqual([lead.familyId]);
    expect(s.profile.access[lead.familyId]).toBe("have");
    expect(T.accept(s, lead).profile.enjoyed).toEqual([lead.familyId]);
  });

  it("0 minutes skips straight to desk moves", () => {
    const s = checkIn(onboarded(), 0);
    expect(s.today.current!.desk).toBe(true);
  });

  it("accept → sync logs the planned workout and credits it", () => {
    let s = checkIn(onboarded());
    s = T.accept(s, s.today.current!.lead);
    s = T.sync(s);
    const ctx = buildAgentContext(s);
    expect(ctx.week.activeByDay[s.todayIndex]).toBe(true);
    expect(s.today.entries.some((e) => e.role === "agent" && e.text.startsWith("+"))).toBe(true);
  });

  it("reaching the weekly goal earns the trophy, once", () => {
    let s = onboarded("roll");
    s = { ...s, goal: buildAgentContext(s).week.done + 0.5 };
    s = checkIn(T.startDay(s));
    s = T.accept(s, s.today.current!.lead);
    s = T.sync(s);
    expect(buildAgentContext(s).trophy).toBe(true);
    expect(s.today.entries.filter((e) => e.role === "trophy").length).toBe(1);
  });

  it("greets the streak and never mentions a missed day", () => {
    const alex = onboarded("alex");
    expect(alex.today.entries[0].text).toMatch(/^Day 12 in a row/);
    const tough = onboarded("tough");
    expect(tough.today.entries[0].text).toMatch(/^Welcome back\./);
    expect(tough.today.entries.map((e) => e.text).join(" ")).not.toMatch(/miss|lost|broke|why/i);
  });

  it("at the gym, offers equipment there and a how-to video", () => {
    let s = onboarded("roll");
    s = T.answerTime(s, "30 min", 30);
    s = T.answerPlace(s, "Indoors, with others", "indoors_with_others");
    s = T.answerEnergy(s, "Normal", "normal");
    expect(s.today.step).toBe("suggested");
    const v = T.videoExample(s);
    const last = v.today.entries.at(-1)!;
    expect(last.video?.id).toBeTruthy();
    expect(v.today.entries.at(-2)!.text).toBe("Show me how");
  });

  it("clinician feedback from Chat keeps picks moderate and favors strength, without changing the goal", () => {
    let s = onboarded("roll");
    s = applyClinicianTurn(s, "My doctor said keep it moderate for now and add two strength days a week");
    expect(s.clinician.entries.length).toBe(1);
    expect(s.chat.at(-1)!.text).toMatch(/moderate activity/);
    s = checkIn(T.startDay(s), 45);
    const picks = [s.today.current!.lead, ...s.today.current!.backups];
    expect(picks.every((p) => p.met < 6)).toBe(true);
    expect(s.today.current!.lead.familyId).toBe("strength");
    expect(s.today.current!.lead.reasons[0]).toBe("Your clinician suggested it");
    expect(s.goal).toBe(7.5);
  });

  it("an unplanned sync asks to confirm, and counts conservatively until then", () => {
    let s = checkIn(onboarded());
    s = T.sync(s);
    expect(s.today.step).toBe("confirm");
    const pending = s.sessions.find((x) => x.id === s.today.pendingSessionId)!;
    expect(pending.confirmed).toBe(false);
    s = T.confirm(s, "not-exercise");
    expect(s.sessions.some((x) => x.id === pending.id)).toBe(false);
  });

  it("'not in the mood' rules the activity out today and is remembered", () => {
    let s = checkIn(onboarded());
    const first = s.today.current!.lead.familyId;
    s = T.decline(s);
    s = T.chooseReason(s, "not-mood");
    expect(s.today.current!.lead.familyId).not.toBe(first);
    expect(s.declines.at(-1)).toMatchObject({ familyId: first, reason: "not-mood" });
  });

  it("'can't access it' marks the activity unavailable", () => {
    let s = checkIn(onboarded());
    const first = s.today.current!.lead.familyId;
    s = T.chooseReason(T.decline(s), "no-access");
    expect(s.profile.access[first]).toBe("no");
  });

  it("'something hurts' sets the health flag and offers only gentle options", () => {
    let s = checkIn(onboarded());
    s = T.chooseReason(T.decline(s), "hurts");
    expect(s.profile.hasHealthCondition).toBe(true);
    expect(s.painReports).toBe(1);
    expect(s.today.current!.lead.met).toBeLessThan(3);
  });

  it("nudges to keep going when a workout gets partway to the target", () => {
    let s = checkIn(onboarded("tough"), 20);
    s = T.accept(s, s.today.current!.lead);
    s = T.sync(s);
    const ctx = buildAgentContext(s);
    if (ctx.todayDone < ctx.todayTarget && ctx.todayDone >= ctx.todayTarget / 2) {
      expect(s.today.step).toBe("nudge");
      s = T.keepGoing(s, true);
      expect(buildAgentContext(s).todayDone + 1e-9).toBeGreaterThanOrEqual(ctx.todayTarget);
    } else {
      expect(s.today.step).toBe("wrap");
    }
  });

  it("accepts typed answers at every check-in step", () => {
    let s = onboarded();
    s = T.freeText(s, "about 25 minutes");
    expect(s.today.checkIn.minutes).toBe(25);
    s = T.freeText(s, "at the gym");
    expect(s.today.checkIn.place).toBe("indoors_with_others");
    s = T.freeText(s, "kind of tired");
    expect(s.today.checkIn.energy).toBe("low");
    expect(s.today.step).toBe("suggested");
  });

  it("asks how you feel with two buttons, then goes straight to one pick", () => {
    expect(T.ENERGY_OPTIONS.map(([, e]) => e)).toEqual(["challenge", "normal"]);
    let s = T.answerPlace(T.answerTime(onboarded(), "30 min", 30), "Indoors, private", "indoors_private");
    expect(s.today.entries.at(-1)?.text).toBe("How do you feel?");
    s = T.answerEnergy(s, "Normal", "normal");
    expect(s.today.step).toBe("suggested");
    expect(s.today.entries.some((e) => /mood for/.test(e.text))).toBe(false);
  });

  it("'Give me another option' swaps the pick without asking why, then brings a fresh set", () => {
    let s = checkIn(onboarded());
    const first = [s.today.current!.lead, ...s.today.current!.backups].map((x) => x.familyId);
    const declinesBefore = s.declines.length;
    s = T.anotherOption(s);
    expect(s.today.step).toBe("suggested");
    expect(s.today.current!.lead.familyId).toBe(first[1]);
    expect(s.today.current!.skipped!.familyId).toBe(first[0]); // the user may say why, optionally
    expect(s.declines.length).toBe(declinesBefore);
    s = T.anotherOption(T.anotherOption(s)); // past both backups
    expect(s.today.entries.at(-1)!.text).toBe("Here are some different ones.");
    const next = [s.today.current!.lead, ...s.today.current!.backups].map((x) => x.familyId);
    expect(next.some((f) => first.includes(f))).toBe(false);
    expect(s.declines.length).toBe(declinesBefore);
  });

  it("the optional reason after 'another option' counts as a decline of the option passed over", () => {
    let s = T.anotherOption(checkIn(onboarded()));
    const passed = s.today.current!.skipped!;
    s = T.skipReason(s, "weather");
    expect(s.declines.at(-1)).toMatchObject({ familyId: passed.familyId, reason: "weather" });
    expect(s.today.constraint?.indoorOnly).toBe(true);
    expect(s.today.current!.skipped).toBeUndefined();
  });

  it("'another option' ends after at most six options and asks what's in the way", () => {
    let s = checkIn(onboarded());
    let presses = 0;
    while (s.today.step === "suggested" && presses < 10) { s = T.anotherOption(s); presses++; }
    expect(presses).toBeLessThanOrEqual(T.MAX_PASSES + 1);
    expect(s.today.step).toBe("reason");
    expect(s.today.entries.at(-1)!.text).toMatch(/What's getting in the way\? I'll adjust from there\.$/);
    s = T.chooseReason(s, "no-time");
    expect(s.today.step).toBe("suggested");
    expect(T.anotherOption(s).today.step).toBe("suggested"); // a reason starts the count again
  });

  it("the sixth option's button asks what's in the way instead of offering a seventh", () => {
    let s = checkIn(onboarded());
    s = { ...s, today: { ...s.today, passed: T.MAX_PASSES } };
    const sixth = s.today.current!.lead;
    s = T.anotherOption(s);
    expect(s.today.entries.at(-2)!.text).toBe("None of these work");
    expect(s.today.entries.at(-1)!.text).toBe("That's 6 options. What's getting in the way? I'll adjust from there.");
    expect(s.today.step).toBe("reason");
    s = T.chooseReason(s, "not-mood");
    expect(s.declines.at(-1)).toMatchObject({ familyId: sixth.familyId, reason: "not-mood" });
    expect(s.today.passed).toBe(0);
  });

  it("'Remind me later' asks when, sets the reminder, and brings the pick back", () => {
    let s = checkIn(onboarded());
    const pick = s.today.current!.lead;
    s = T.remindLater(s);
    expect(s.today.step).toBe("remind");
    expect(s.today.entries.at(-1)?.text).toBe("Sure. When should I remind you?");
    s = T.setReminder(s, "In 1 hour");
    expect(s.today.step).toBe("reminded");
    expect(s.today.reminder).toBe("in 1 hour");
    expect(s.today.entries.at(-1)?.text).toMatch(/^Got it. I'll remind you in 1 hour about/);
    s = T.reminderDue(s);
    expect(s.today.step).toBe("suggested");
    expect(s.today.current!.lead).toBe(pick);
  });

  it("a typed reminder time reads naturally", () => {
    let s = T.freeText(T.remindLater(checkIn(onboarded())), "5:30 pm");
    expect(s.today.reminder).toBe("at 5:30 pm");
    s = T.freeText(T.remindLater(checkIn(onboarded())), "after dinner");
    expect(s.today.reminder).toBe("after dinner");
  });

  it("a typed decline reason that mentions pain takes the safety path", () => {
    let s = checkIn(onboarded());
    s = T.decline(s);
    s = T.freeText(s, "my back is killing me");
    expect(s.profile.hasHealthCondition).toBe(true);
    expect(s.declines.at(-1)).toMatchObject({ reason: "hurts", note: "my back is killing me" });
  });

  it("a typed question on the suggestion card gets an answer and keeps the card", () => {
    let s = checkIn(onboarded());
    s = T.freeText(s, "what's a MET?");
    expect(s.today.step).toBe("suggested");
    expect(s.today.entries.at(-1)?.text).toMatch(/MET measures/);
  });

  it("a typed activity that isn't in the list is kept by name and counted conservatively", () => {
    let s = checkIn(onboarded());
    s = T.sync(s);
    const pending = s.today.pendingSessionId!;
    s = T.freeText(s, "pickleball");
    const sess = s.sessions.find((x) => x.id === pending)!;
    expect(sess.customName).toBe("Pickleball");
    expect(sess.confirmed).toBe(true);
    expect(["other-fairly", "other-very"]).toContain(sess.variantId);
  });
});

describe("backend (Jev) suggestions", () => {
  const fromJev = (s: AppState): BackendSuggestion => {
    const [lead, ...backups] = [s.today.current!.lead, ...s.today.current!.backups].reverse();
    return { source: "mock", model: "mock", logId: 1, lead, backups, jevRequest: {}, jevAnswers: {} };
  };

  it("sends only the options that pass the hard filters, and the check-in variables", () => {
    const s = checkIn(onboarded(), 30);
    const body = buildSuggestRequest(s);
    expect(body.check_in.minutes).toBe(30);
    expect(body.durations.every((d) => d <= 30)).toBe(true);
    expect(body.options.every((o) => s.profile.access[o.family_id] !== "no")).toBe(true);
    // Every activity is an option now, not only the liked ones.
    expect(body.options.some((o) => !s.profile.enjoyed.includes(o.family_id))).toBe(true);
  });

  it("swaps in the backend's pick while the ranker's is still showing", () => {
    const s = checkIn(onboarded());
    const r = fromJev(s);
    const next = T.applyBackendSuggestion(s, s.today.current!.lead, r);
    expect(next.today.current!.lead).toBe(r.lead);
    expect(next.today.current!.source).toBe("mock");
  });

  it("drops a late answer once the user has moved on", () => {
    const s = checkIn(onboarded());
    const r = fromJev(s);
    const accepted = T.accept(s, s.today.current!.lead);
    expect(T.applyBackendSuggestion(accepted, s.today.current!.lead, r)).toBe(accepted);
  });
});

describe("editing an earlier answer", () => {
  // The store runs withRewind after every action; do the same here.
  const step = (s: AppState, f: (x: AppState) => AppState) => T.withRewind(s, f(s));

  it("every answer gets a time and a way back to its question", () => {
    let s = onboarded();
    s = step(s, (x) => T.answerTime(x, "30 min", 30));
    s = step(s, (x) => T.answerPlace(x, "Indoors, private", "indoors_private"));
    const answers = s.today.entries.filter((e) => e.role === "user");
    expect(answers.map((e) => e.text)).toEqual(["30 min", "Indoors, private"]);
    for (const a of answers) {
      expect(a.at).toBeTypeOf("number");
      expect(a.rewind).toBeDefined();
    }
  });

  it("the pencil goes back to that question and drops what came after", () => {
    let s = onboarded();
    s = step(s, (x) => T.answerTime(x, "30 min", 30));
    s = step(s, (x) => T.answerPlace(x, "Indoors, private", "indoors_private"));
    s = step(s, (x) => T.answerEnergy(x, "Normal", "normal"));
    expect(s.today.step).toBe("suggested");
    const time = s.today.entries.find((e) => e.text === "30 min")!;
    const back = T.editAnswer(s, time.id);
    expect(back.today.step).toBe("time-confirm");
    expect(back.today.entries).toHaveLength(1); // just the coach's opening question
    expect(back.today.checkIn.minutes).toBeUndefined();
    // A new answer carries on from there.
    const redone = step(back, (x) => T.answerTime(x, "10 min", 10));
    expect(redone.today.checkIn.minutes).toBe(10);
    expect(redone.today.entries.at(-1)?.text).toBe("Where will you be exercising?");
  });

  it("going back also undoes what that answer changed", () => {
    let s = checkIn(onboarded());
    s = step(s, (x) => T.decline(x));
    s = step(s, (x) => T.chooseReason(x, "hurts"));
    expect(s.profile.hasHealthCondition).toBe(true);
    const hurts = s.today.entries.find((e) => e.role === "user" && e.text === "Something hurts")!;
    const back = T.editAnswer(s, hurts.id);
    expect(back.today.step).toBe("reason");
    expect(back.profile.hasHealthCondition).toBe(false);
    expect(back.painReports).toBe(0);
    expect(back.declines.length).toBe(s.declines.length - 1);
  });
});

describe("Off at the time question", () => {
  it("makes today a day off and moves its target to the other days", () => {
    const s0 = onboarded();
    const before = buildAgentContext(s0);
    expect(before.todayTarget).toBeGreaterThan(0);
    const s = T.withRewind(s0, T.takeDayOff(s0));
    expect(s.plan[s.todayIndex]).toBe("off");
    expect(s.today.step).toBe("wrap");
    const after = buildAgentContext(s);
    expect(after.todayTarget).toBe(0);
    const later = (c: typeof after) => c.targets.slice(s.todayIndex + 1).reduce((a, b) => a + b, 0);
    expect(later(after)).toBeGreaterThan(later(before));
    // Editing the answer puts the day back.
    const off = s.today.entries.find((e) => e.role === "user" && e.text === "Off")!;
    expect(T.editAnswer(s, off.id).plan[s.todayIndex]).toBe(s0.plan[s0.todayIndex]);
  });

  it("understands a typed day off", () => {
    for (const text of ["I'm sick today", "taking the day off", "rest day"]) {
      const s = T.freeText(onboarded(), text);
      expect(s.plan[s.todayIndex]).toBe("off");
    }
  });
});

it("a typed 'can't, my bike is broken' on a pick rules that activity out", () => {
  let s = T.answerTime(onboarded(), "30 min", 30);
  s = T.answerEnergy(T.answerPlace(s, "Indoors, private", "indoors_private"), "Normal", "normal");
  const fam = s.today.current!.lead.familyId;
  s = T.freeText(s, "can't, my bike is broken");
  expect(s.profile.access[fam]).toBe("no");
});

describe("confirming today's time", () => {
  // Alex's plan: Wednesday (the demo's today) is 30 min.
  it("names the weekly plan as the source and invites more", () => {
    const s = onboarded();
    expect(s.today.step).toBe("time-confirm");
    expect(s.today.entries[0].text).toMatch(/Your weekly plan has 30 min for today\. Keep it, or do you want to exercise more or less\?$/);
  });

  it("the buttons say what they do", () => {
    expect(T.keepTimeLabel(onboarded())).toBe("Keep 30 min");
    expect(T.CHANGE_TIME_LABEL).toBe("Pick a different time");
  });

  it("Keep 30 min keeps the planned time and moves on to place", () => {
    const s = T.confirmTime(onboarded(), true);
    expect(s.today.entries.find((e) => e.role === "user")?.text).toBe("Keep 30 min");
    expect(s.today.checkIn.minutes).toBe(30);
    expect(s.today.step).toBe("place");
    expect(s.plan).toEqual(onboarded().plan);
  });

  it("Pick a different time opens the time list; a new pick replaces today's time and re-splits the week", () => {
    const start = onboarded();
    let s = T.confirmTime(start, false);
    expect(s.today.step).toBe("time");
    expect(s.today.entries.at(-1)?.text).toBe("How much time do you have today?");
    s = T.answerTime(s, "45+ min", 45, "45");
    expect(s.plan[s.todayIndex]).toBe("45");
    expect(buildAgentContext(s).todayTarget).toBeGreaterThan(buildAgentContext(start).todayTarget);
    expect(s.today.entries.some((e) => /changed today's exercise block on your calendar to 45 min/.test(e.text))).toBe(true);
    expect(s.today.step).toBe("place");
  });

  it("names the calendar when the user edited today's block there", () => {
    const s0 = onboarded();
    const s = T.startDay({ ...s0, plan: s0.plan.map((x, i) => (i === s0.todayIndex ? "10" : x)), planSource: s0.planSource.map((x, i) => (i === s0.todayIndex ? "calendar" : x)) });
    expect(s.today.entries[0].text).toMatch(/You changed today's exercise block on your calendar to 10 min\. Keep it/);
    expect(T.confirmTime(s, true).today.checkIn.minutes).toBe(10);
  });

  it("an off day still asks whether there's any time, without a plan to confirm", () => {
    const s0 = onboarded();
    const s = T.startDay({ ...s0, plan: s0.plan.map((x, i) => (i === s0.todayIndex ? "off" : x)) });
    expect(s.today.step).toBe("time");
    expect(s.today.entries[0].text).toMatch(/Today is marked off/);
  });

  it("typed answers: yes, no, 'more' and minutes", () => {
    const s = onboarded();
    expect(T.freeText(s, "yes please").today.checkIn.minutes).toBe(30);
    expect(T.freeText(s, "no").today.step).toBe("time");
    expect(T.freeText(s, "I want more today").today.step).toBe("time");
    expect(T.freeText(s, "25 min").today.checkIn.minutes).toBe(25);
  });
});
