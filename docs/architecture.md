# Architecture, and how to add the LLM and database

## Today

```
Screens ──► useStore() ──► AppState (React reducer)
   │                          │
   │                          └─► repository (localStorage)        services/store.ts
   │
   ├─► ctx = buildAgentContext(state)                             services/context.ts
   │      week summary, time left, plan options (rule-based)      lib/guideline.ts, lib/planner.ts
   │
   └─► agent.reply(history, ctx) ──► MockAgent                     services/agent.ts
                                       picks a scripted reply      services/mockResponses.ts
                                       and streams it word by word
```

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

Ideas once a model is connected: generate the per-option explanations (`explainOption`), parse
free-text setup ("About 2 hours, and I like cycling and dancing") into a profile, and let the
model call the planner as a tool instead of receiving all options up front.

## Step 2: Store user data in a database

Implement `UserRepository` in `src/services/store.ts` against your backend and swap the
`repository` export. A starting schema:

| Table | Columns |
|---|---|
| `users` | id, name, created_at |
| `profiles` | user_id, weekly_time_min, has_health_condition, fitbit_connected, updated_at |
| `enjoyed_activities` | user_id, family_id, rank |
| `sessions` | id, user_id, date, variant_id, compendium_code, met, duration_min, avg_hr, source (`fitbit` / `manual`) |
| `weekly_plans` | id, user_id, week_start, kind, chosen_at |
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

- Only suggest activities from the user's enjoyed list (planner enforces this; the prompt repeats it).
- With a reported health condition: moderate only, and suggest checking with a clinician before vigorous activity.
- Symptoms like chest pain or dizziness: stop and contact a clinician (see the `safety` script).
- Never let the model invent minutes; it must use the provided numbers.
