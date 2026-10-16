# Make It Count: Personal Health Agent (demo)

A mobile-style web app that takes away decision fatigue for busy adults. Each day it hands the
user one workout that fits their time and the activities they enjoy, counts it in MET-hours toward
the weekly physical activity guideline, and rewards every day they move with a medal.

**Live demo:** https://jarvistseca.github.io/personal-health-agent/ (redeploys on every push to `main`)

This is the **demo build**: every screen is interactive, Fitbit data is simulated, and the coach
answers from pre-written scripts. It follows the team's *PHA App Workflow* doc. The code is organized
so a real LLM and a database can be plugged in later without rewriting the screens.

**Team:** Kate Tan (clinical informatics / CS), Sarah Danziger, MD (medicine / health),
Jarvis Tse (HCI / design / CS)

## Run it

Requires Node 18 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). On a laptop you'll see the app inside a
phone frame with demo controls beside it. On a phone (or a narrow window) the app fills the screen.
To try it on your phone, connect to the same Wi-Fi and open the "Network" URL Vite prints.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built app locally |
| `npm test` | Run the unit tests for the MET-hour math, targets, medals, goal rules, ranker and Today flow |
| `npm run typecheck` | TypeScript check only |

## What's in the demo

| Screen | What it shows (maps to the workflow doc) |
|---|---|
| Onboarding | **Observe first**: connect Fitbit, one health question, watch a week, then confirm what was detected, likes (ranked), access, usual time and the first weekly plan. *Set up now* skips the week |
| Today | **The daily loop**: check-in bubbles (time, place, energy, mood) → one pick + two backups → *Not today* with a reason → a new pick. Question chips (*What's a MET?*, *Why this?*, *How did you calculate this?*) at every step. *Sync Fitbit* logs the workout, asks to confirm if unsure, awards medals and nudges *keep going* |
| Week | Daily targets split by available time; **Change my week** marks days off at any point and re-splits what's left |
| Medals | Streak (a medal every day), bronze / silver / gold rules, every week's coins |
| Coach | Free-form questions, answered from scripts with the user's real numbers |
| Showcase | The **demo moment**: pick activities, see what 30 min is worth, compare *too little / overdid it / with the agent* |
| Weekly recap (sheet) | Last week's total and medals, plus the goal offer: raise, lower or keep |
| Preferences (sheet) | Ranked activities with access, what the coach remembers (declines), health flag, clinician view switch |
| Clinician view | Opened on the user's phone at a visit: weekly chart, activity mix, skip reasons, flags; sets goal, no-vigorous limit, max session, a note. Hand-back shows the user what changed |

**Typing is always an option.** Every question that offers buttons or bubbles also has an *Other* text box
below them. Typed answers are read into the same choices (`src/lib/freeText.ts`): "25 min", "at the gym",
"my knee is sore" (takes the safety path), "pickleball". Anything the app can't place is kept as a note the
coach remembers (shown in Preferences), and an activity outside the list keeps the user's name for it and counts
at the bottom of the effort band Fitbit measured.

**Demo controls** (right side on desktop): switch scenario (*Alex*, *On a roll* → goal raise, *Tough month*
→ goal cut, *Fresh start*), pretend it's a different day, restart today's check-in, simulate a Fitbit
sync, open the recap or clinician view, reset, and show the backend: the **verifier's checks** on the
current suggestion and the prompt the coach would receive.

## How the numbers work

- **MET-hours = MET × minutes ÷ 60**, with MET values from the [2024 Adult Compendium of Physical Activities](https://pacompendium.com/adult-compendium/) (`src/lib/activities.ts`).
- **Weekly goal: 7.5 MET-hours** = 150 min at 3 MET = 75 min at 6 MET. Only activity ≥ 3 MET counts by default (`LIGHT_COUNTS_TOWARD_GOAL` in `src/lib/met.ts`, an open clinical question). Unconfirmed Fitbit bouts count at 3.0 or 6.0 MET, the bottom of their band.
- **Daily targets** (`src/lib/plan.ts`): what's left, split over the remaining available days by their time. Off days never lower the weekly goal. Today's target is fixed at the start of the day.
- **Medals** (`src/lib/medals.ts`): bronze for any activity, silver for the day's target, gold for every medal once the weekly goal is met. The streak needs a medal every day.
- **Goal rules** (`src/lib/goal.ts`): raise to the lower of the last 2 weeks rounded down to a multiple of 2.5 (if higher); after 3 weeks under 50%, offer half. A clinician-set goal never changes automatically. `WEEKLY_UPPER_LIMIT` is `null` until the clinical question is answered.
- **Suggestions** (`src/lib/suggest.ts`): filter (enjoyed, accessible, fits time, safe) → score (preference, goal fit, variety, past declines, energy) → one lead and two backups of a different type. Every suggestion passes the checks in `src/lib/verify.ts`.

## Project layout

```
src/
  lib/            Pure logic, unit-tested: activities + MET values, MET-hours, daily targets,
                  medals, goal rules, suggestion ranker, verifier checks
  data/           Demo scenarios: 4 past weeks + this week each (shaped like PMData exercise logs)
  services/
    agent.ts        Agent interface; MockAgent (today) and HttpAgent (example for later)
    answers.ts      Grounded answers to the one-tap questions
    mockResponses.ts  The pre-written Coach-tab script. Edit this to change demo answers
    context.ts      Builds the structured user context the agent sees
    prompts.ts      Plain-English task briefs for the coach and verifier agents
    store.ts        Persistence; localStorage today, swap for a database later
  state/          App state (React context + reducer), the Today flow (today.ts), shared types
  screens/        One file per screen / bottom sheet
  components/     Medal coins, goal strip, icons, sheet, demo panel
docs/architecture.md   How to add the LLM and database
```

## Next steps

See [docs/architecture.md](docs/architecture.md) for the plan to connect a real LLM and a database,
and [CONTRIBUTING.md](CONTRIBUTING.md) for how we work in this repo.

## Disclaimer

Research prototype for demonstration only. Not medical advice.
