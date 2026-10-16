# Architecture, and how to add the LLM and database

## Today

```
Screens ──► useStore() ──► AppState (React reducer)
   │                          │
   │                          └─► repository (localStorage)        services/store.ts
   │
   ├─► ctx = buildAgentContext(state)                             services/context.ts
   │      MET-hours, daily targets, medals, goal offer            lib/met.ts, plan.ts, medals.ts, goal.ts
   │
   ├─► Today flow (check-in → pick → decline/questions → sync)    state/today.ts
   │      suggest() ranks options, verifySuggestion() checks them lib/suggest.ts, lib/verify.ts
   │
   └─► agent.reply(history, ctx) ──► MockAgent                     services/agent.ts
                                       picks a scripted reply      services/mockResponses.ts
                                       and streams it word by word
```

The workflow doc's backend is **two agents and a calculator**: the coach (user-facing) drafts a plan
and message, the calculator (plain code in `src/lib`) fills in every number, and a verifier agent
checks the draft against the guardrails before the user sees it. In this demo the coach is
scripted and the verifier's checks run in code (`verifySuggestion`); the demo panel shows them.

Key idea: **the LLM explains, the code calculates.** Guideline minutes and plan options are computed
deterministically from Fitbit data and MET values. The agent's job is to talk about them in a
personal, encouraging way, answer questions, and apply the guardrails. That keeps the numbers
correct and testable no matter which model we use.

## Step 1: Connect a real LLM

1. Add a small backend route, e.g. `POST /api/chat`, that receives
   `{ system, messages }` and forwards it to the LLM provider, streaming the text back.
   Options: a Vercel/Netlify function, a tiny Express or FastAPI server, or Supabase Edge Functions.
   **Keep the API key on the server.** Anything in the frontend is visible to users.
2. In `src/services/agent.ts`, change the last line to:
   ```ts
   export const agent: Agent = new HttpAgent("/api/chat");
   ```
   `HttpAgent` already sends `buildSystemPrompt(ctx)` plus the chat history.
3. Review the prompt in `src/services/prompts.ts`. The demo panel's *Show what the agent sees*
   button renders the exact prompt for the current state.
4. Keep `MockAgent` around for offline demos and tests (e.g. pick it with an env flag).

Ideas once a model is connected: let the coach call `suggest()` as a tool and write the card text,
run `VERIFIER_BRIEF` (prompts.ts) as the second agent, and parse free-text "Other" decline notes
into structured preferences.

## Step 2: Store user data in a database

Implement `UserRepository` in `src/services/store.ts` against your backend and swap the
`repository` export. A starting schema:

| Table | Columns |
|---|---|
| `users` | id, name, created_at |
| `profiles` | user_id, usual_time, has_health_condition, fitbit_connected, clinician_view_enabled, updated_at |
| `enjoyed_activities` | user_id, family_id, rank, access (`have` / `sometimes` / `no`) |
| `goals` | user_id, week_start, met_hours, set_by (`default` / `recap` / `clinician`) |
| `week_plans` | user_id, week_start, mon … sun (`off` / `short` / `medium` / `long`) |
| `sessions` | id, user_id, date, variant_id, compendium_code, met, duration_min, avg_hr, source, confirmed, band |
| `declines` | id, user_id, date, family_id, reason, note |
| `clinician_settings` | user_id, goal, no_vigorous, max_session_min, note, updated_at |
| `check_ins` | user_id, date, minutes, place, energy, mood |
| `chat_messages` | id, user_id, role, text, created_at |

`buildAgentContext` then reads from these rows instead of in-memory state, and `serializeContext`
turns them into the JSON block injected into the prompt. Move to per-week `date` fields (instead of
`dayIndex`) at this point.

## Step 3: Real Fitbit data

- **Research datasets** (Fitabase, PMData, LifeSnaps): write loaders that map each exercise row to a
  `Session` (`variantId` via a lookup table from the dataset's activity names to Compendium entries).
  `src/data/mockFitbit.ts` already uses the PMData-style shape.
- **Live data**: Fitbit Web API (OAuth on the backend), pulling activity logs and active zone
  minutes into the `sessions` table on sync.

## Guardrails to keep

- Only suggest activities from the user's enjoyed list and marked accessible (ranker enforces this; the verifier re-checks it; desk moves are the one exception).
- With a health flag or clinician limit: nothing at 6 MET or more, and suggest checking with a clinician first.
- Symptoms like chest pain or dizziness: stop and contact a clinician (see the `safety` script).
- Never let the model invent numbers; MET-hours come from the calculator and the verifier compares them.
