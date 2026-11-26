/**
 * Running the app with the backend: Memory remembers the user, the backend works out the
 * numbers, and the app shows them. This is the other of the app's two ways to run; without
 * the backend (the online demo) the store works as it always has and none of this is used.
 *
 * Opening:
 *    read Memory ─► it has this app's content ─► put the state back together (fromMemory.ts)
 *                └► it doesn't yet ─► put the app's content there once: an earlier save, or the
 *                                     demo persona with its weeks laid out back from this one
 *
 * Every step after that (a tap, an answer, a sync):
 *    1  run the step once, only to see what it changes
 *    2  tell the backend what changed (toMemory.ts); it stores it and works the numbers out again
 *    3  run the step for real, now with the new numbers, and show the result
 *
 * So what is on screen after a step, the sentences of the Today conversation included, is
 * built from the backend's numbers. A step that changes nothing the numbers come from (a
 * chat message, a decline) is shown at once and saved right after.
 *
 * Steps are taken one at a time, in the order they were asked for.
 *
 * A step that changes only what the screen holds (a toast closing, a sheet opening) is shown
 * and nothing is sent: Memory keeps neither.
 *
 * A chat reply arrives a few words at a time. Each piece is shown as it comes, and the reply is
 * saved once, by the step that finishes it. The Chat conversation has a group of its own in
 * Memory, one entry a message. A Memory from before that keeps it under "other": the first
 * open moves it over, once.
 *
 * When the backend doesn't answer:
 *  - a step that was already shown stays on screen, and what it changed goes out with the next
 *    step that tells the backend something and gets through;
 *  - a step that was waiting for numbers is not taken at all. The backend may have stored part
 *    of it before it stopped answering, so before the next step the app reads Memory again and
 *    takes back whatever is there that the screen doesn't show.
 */
import { mondayOf, type Memory, type Numbers, type OtherOfApp } from "../services/memoryTypes";
import { readMemory, readNumbers, replaceMemory, saveMemory, sendChanges } from "../services/memoryClient";
import { fromMemory } from "../services/fromMemory";
import { numbersAhead, numbersKey, showNumbers } from "../services/numbers";
import { memoryChanges, todayOf, toMemory } from "../services/toMemory";
import { registerTable } from "../lib/tableActivities";
import type { Action } from "./store";
import * as Today from "./today";
import type { AppState } from "./types";

export interface MemorySession {
  /** Take one step: tell the backend, then show it. */
  dispatch(action: Action): void;
  /** Resolves once every step asked for so far has been told to the backend. */
  settled(): Promise<void>;
  /** The app's today as a date, "2026-11-25" */
  today(state: AppState): string;
}

interface Opening {
  /** The store's reducer */
  reduce(state: AppState, action: Action): AppState;
  /** Put a state on screen */
  show(state: AppState): void;
  /** A fresh state: the demo persona */
  initial(): AppState;
  /** What the app saved before Memory was in use (the backend's old one-piece save, or this browser's), if anything */
  saved(): Promise<AppState | null>;
}

const NOT_SAVED = "The backend didn't answer, so that last step didn't go through. Is it still running?";

/** What only the screen holds. Memory keeps neither, so a change to them is nothing to tell the backend. */
const ON_SCREEN_ONLY: ReadonlyArray<keyof AppState> = ["toast", "overlay"];

/** True when a step changed nothing but what only the screen holds. */
function onlyTheScreenChanged(prev: AppState, next: AppState): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof AppState>;
  return [...keys].every((key) => ON_SCREEN_ONLY.includes(key) || prev[key] === next[key]);
}

/** Open the app from Memory. Throws when the backend can't be used; the store then runs without it. */
export async function openMemorySession(o: Opening): Promise<{ state: AppState; session: MemorySession }> {
  const monday = mondayOf(new Date());
  const memory = await readMemory(monday); // this week and the 26 before it; Memory keeps the rest
  const own = (memory.other as OtherOfApp).app;
  /** The Chat conversation is still under "other", from before it had a group of its own in Memory. */
  const chatUnderOther = (memory.other as OtherOfApp).chat !== undefined;

  let state: AppState | null = null;
  let numbers: Numbers | null = null;
  if (own?.version === 1) {
    // Opening the app today counts toward the streak: tell the backend, and get today's numbers back.
    const date = todayOf(own, monday);
    numbers = await saveMemory({ daily: { app_opens: [date] } }, date);
    if (numbers) {
      if (!memory.daily.app_opens.includes(date)) memory.daily.app_opens = [...memory.daily.app_opens, date].sort();
      const opened = fromMemory(memory, numbers, o.initial());
      if (opened) {
        showNumbers(opened.state, numbers);
        // A new week since the last visit: the Today conversation in Memory is last week's, so today starts fresh.
        state = opened.newWeek ? Today.startDay(opened.state) : opened.state;
      }
    }
  }
  if (!state || !numbers) {
    // The first time with Memory: bring over what the app has.
    state = (await o.saved()) ?? o.initial();
    registerTable(Object.values(state.tableActivities ?? {})); // an earlier save can hold picks from the activity table
    numbers = await replaceMemory(toMemory(state, monday), todayOf(state, monday));
    if (!numbers) throw new Error("The backend has no weekly goal and plan to work the numbers out from.");
    showNumbers(state, numbers);
    // The greeting was written before the backend's numbers were in: write it again with them.
    if (state.today.entries.length <= 1) state = Today.startDay(state);
  }
  // With the backend, suggestions come from the activity table, through Memory.
  state = { ...state, suggestSource: "table" };
  showNumbers(state, numbers);

  let current = state;
  /** What Memory holds, as far as the app knows. null: a step failed part-way, so it has to be read again. */
  let mem: Memory | null = toMemory(state, monday);
  // The app's own part as it is now (a fresh greeting, this week's Monday). A conversation still under
  // "other" moves to Memory's chat group here: saved there first, then taken out of "other".
  await saveMemory(chatUnderOther ? { chat: mem.chat, other: mem.other } : { other: mem.other });
  if (chatUnderOther) await sendChanges({ save: null, remove: [{ kind: "other", key: "chat" }] });

  /** What Memory holds, read again from the backend when the app can't be sure any more. */
  const held = async (): Promise<Memory> => {
    if (mem) return mem;
    const numbers = await readNumbers(todayOf(current, monday));
    const there = numbers && fromMemory(await readMemory(monday), numbers, o.initial());
    if (!there) throw new Error("Memory can't be read back.");
    // Laid out the way the app lays its own state out, so the two can be compared entry by entry.
    return toMemory(there.state, monday);
  };

  const step = async (action: Action) => {
    const prev = current;
    const mark = Today.idsMark();
    const draft = Today.withIds(mark, () => o.reduce(prev, action));
    if (draft === prev) return;
    if (onlyTheScreenChanged(prev, draft)) {
      // Closing the toast after a step that didn't go through is one of these: it closes, and stays closed.
      current = draft;
      o.show(draft);
      return;
    }
    const target = toMemory(draft, monday);
    // Another demo persona, Reset, or the first sync of a real Fitbit: Memory starts over with the new content.
    const startOver = prev.personaId !== draft.personaId || action.type === "reset" || (!prev.fitbitWeek && !!draft.fitbitWeek);

    if (!startOver && numbersKey(prev) === numbersKey(draft)) {
      current = draft;
      o.show(draft);
      // A reply the agent is still writing: on screen now, saved by the step that finishes it.
      if ((action.type === "addMessage" || action.type === "updateMessage") && action.unfinished) return;
      // If this doesn't get through, `mem` stays as it was and the next step sends this change too.
      const changes = memoryChanges(await held(), target, monday);
      if (changes.save || changes.remove.length) await sendChanges(changes);
      mem = target;
      return;
    }

    const date = todayOf(draft, monday);
    let after: Numbers | null;
    try {
      after = startOver ? await replaceMemory(target, date) : await sendChanges(memoryChanges(await held(), target, monday), date);
      if (!after) throw new Error("The backend has no weekly goal and plan to work the numbers out from.");
    } catch (e) {
      mem = null; // part of it may have been stored: read Memory again before the next step
      throw e;
    }
    mem = target;
    numbersAhead(draft, after);
    const done = Today.withIds(mark, () => o.reduce(prev, action));
    showNumbers(done, after);
    current = done;
    o.show(done);
    // What the step says differently now that it had the new numbers (a sentence, a trophy line).
    const said = toMemory(done, monday);
    const rest = memoryChanges(target, said, monday);
    if (rest.save || rest.remove.length) await sendChanges(rest);
    mem = said;
  };

  let queue: Promise<void> = Promise.resolve();
  const session: MemorySession = {
    dispatch(action) {
      queue = queue.then(() => step(action)).catch((e) => {
        console.warn("A step wasn't saved to the backend.", e);
        current = { ...current, toast: NOT_SAVED };
        o.show(current);
      });
    },
    settled: () => queue,
    today: (s) => todayOf(s, monday),
  };
  return { state, session };
}
