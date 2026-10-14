# Make It Count: Personal Health Agent (demo)

A mobile-style web app that helps a busy adult meet the weekly physical activity guideline
(150 min moderate, 75 min vigorous, or an equivalent mix) using only activities they enjoy,
in the time they actually have.

This is the **demo build**: every screen is interactive, Fitbit data is simulated, and the coach
answers from pre-written scripts. The code is organized so a real LLM and a database can be
plugged in later without rewriting the screens.

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
| `npm test` | Run the unit tests for the minute calculations and planner |
| `npm run typecheck` | TypeScript check only |

## What's in the demo

| Screen | What it shows (maps to the one-pager) |
|---|---|
| Onboarding | **Set the week**: free time, activities you enjoy, health condition, connect Fitbit |
| This week | **Check progress**: guideline minutes done vs. the 150 goal, day by day. *Sync Fitbit* adds a simulated workout and the plan **adapts** |
| Plan | **Offer options**: 2–3 concrete ways to close the gap using only your activities, marked if they don't fit your time |
| Coach | Chat with the agent (simulated, streams word by word). Includes the **guardrail** for health conditions and symptoms |
| Showcase | The **demo moment**: pick activities, see what 30 min of each is worth, compare *too little / overdid it / with the agent* |

**Demo controls** (right side on desktop): switch the simulated Fitbit data, pretend it's a different
day of the week, skip onboarding, reset, and show **what the agent sees**, the exact prompt a real LLM
would receive.

## How the numbers work

- Each activity maps to a MET value from the [2024 Adult Compendium of Physical Activities](https://pacompendium.com/adult-compendium/) (`src/lib/activities.ts`).
- Light (< 3 MET) counts 0×, moderate (3–5.9 MET) counts 1×, vigorous (≥ 6 MET) counts 2× (`src/lib/guideline.ts`).
- The planner (`src/lib/planner.ts`) is rule-based so the arithmetic is always right. It builds one
  option per favorite activity plus a mix, at the gentlest pace that fits your remaining time,
  in blocks of 30 min or less. With a reported health condition it only uses moderate activity.

The activity list is a small hand-picked subset of the Compendium; check values against the source
before using them for research.

## Project layout

```
src/
  lib/            Pure logic: activities + MET values, guideline math, planner (unit-tested)
  data/           Simulated Fitbit weeks (shaped like PMData exercise logs)
  services/
    agent.ts        Agent interface; MockAgent (today) and HttpAgent (example for later)
    mockResponses.ts  The pre-written coach script. Edit this to change demo answers
    context.ts      Builds the structured user context the agent sees
    prompts.ts      System prompt template for a real LLM
    store.ts        Persistence; localStorage today, swap for a database later
  state/          App state (React context + reducer) and shared types
  screens/        One file per screen / bottom sheet
  components/     Goal strip, icons, sheet, demo panel
docs/architecture.md   How to add the LLM and database
```

## Next steps

See [docs/architecture.md](docs/architecture.md) for the plan to connect a real LLM and a database,
and [CONTRIBUTING.md](CONTRIBUTING.md) for how we work in this repo.

## Disclaimer

Research prototype for demonstration only. Not medical advice.
