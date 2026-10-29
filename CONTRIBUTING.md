# Working in this repo

## Setup

```bash
git clone <repo url>
cd personal-health-agent
npm install
npm run dev
```

## Workflow

1. Pull the latest `main`: `git pull`
2. Create a branch for your change: `git checkout -b your-name/short-description`
3. Commit small, focused changes with clear messages.
4. Before pushing, run `npm test && npm run build`.
5. Push and open a pull request. Ask one teammate to review. CI runs the same checks.

## Where to make common changes

| I want to… | Edit |
|---|---|
| Change what the coach says on Today | `src/state/today.ts` (flow) and `src/services/answers.ts` (questions) |
| Change Chat-tab replies | `src/services/mockResponses.ts` |
| Change the goal, streak/trophy or target rules | `src/lib/goal.ts`, `src/lib/rewards.ts`, `src/lib/plan.ts` (add a test) |
| Add an activity or fix a MET value | `src/lib/activities.ts` (cite the Compendium code) |
| Change the demo scenarios or Fitbit data | `src/data/mockFitbit.ts` |
| Change colors, type, spacing | Tokens at the top of `src/styles.css` |
| Change a screen | `src/screens/` |
| Change how suggestions are picked | `src/lib/suggest.ts`, then add a test in `src/lib/lib.test.ts` |

## Conventions

- TypeScript, React function components, plain CSS with the tokens in `styles.css`.
- Keep math in `src/lib/` (no React there) and cover it with tests.
- Interface copy: plain words, sentence case, buttons say what they do ("Use this plan").
- No API keys or real personal health data in the repo. `.env` files are git-ignored.
