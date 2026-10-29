# Architecture

## Today

```
Screens ──► useStore() ──► AppState (React reducer)
   │                          │
   │                          └─► repository                       services/store.ts
   │                                SQLite via the backend when it's running,
   │                                otherwise localStorage
   │
   ├─► ctx = buildAgentContext(state)                             services/context.ts
   │      MET-hours, daily targets, streak/trophies, goal offer   lib/met.ts, plan.ts, rewards.ts, goal.ts
   │
   ├─► Today flow (check-in → pick → decline/questions → sync)    state/today.ts
   │      suggest() shows the in-app ranker's pick right away     lib/suggest.ts
   │      the backend's Jev pick replaces it when it arrives      services/backend.ts → backend/
   │      verifySuggestion() checks whatever is shown             lib/verify.ts
   │
   └─► agent.reply(history, ctx) ──► MockAgent  (Chat tab)         services/agent.ts
                                       picks a scripted reply      services/mockResponses.ts
                                       and streams it word by word
```

The workflow doc's backend is **two agents and a calculator**: the coach (user-facing) makes the
plan, the calculator (plain code in `src/lib`) fills in every number, and a verifier checks the plan
against the guardrails before the user sees it. Today the coach's pick comes from Jev through the
Python backend, and the verifier's checks run in code (`verifySuggestion`); the demo panel shows them.

Key idea: **the model chooses, the code calculates.** Jev only picks from options the code has
already checked, and MET-hours are always computed from Compendium MET values in `src/lib`. That
keeps the numbers correct and testable no matter which model we use.

The backend is optional. Without it (for example on GitHub Pages) the app runs exactly as the demo
build: the in-app ranker picks, and data stays in the browser.

## Done: the suggestion backend (Jev)

A Python backend (FastAPI, SQLite) in `backend/`. It turns the user's check-in into a prompt for Jev,
TypeSafe AI's System One model, and turns Jev's multiple-choice answers into today's suggestion.

```
check-in variables ──► Call 1: which activity? ──► Call 2: how long? ──────► pick + 2 backups
(from the frontend)    1 question                  1 question per picked      (the frontend adds
                       → pick + 2 backups          activity → its minutes     MET-hours and shows it)
```

1. The frontend filters the options in code first: activities the user enjoys and can access, that
   fit today's time and are allowed by their health limits (`candidates()` in `src/lib/suggest.ts`).
2. It sends those options and the check-in variables (time, place, energy, mood, what's still needed
   today, recent workouts, recent declines) to `POST /api/suggest`.
3. **Call 1, which activity.** `prompt.py` builds a `state` describing the user's day and one Choice
   question whose options are today's allowed activities, so they change every day. Jev answers with
   a probability for every option; `suggest.py` takes the most likely activity as the pick and the
   next two (of a different type where possible) as backups.
4. **Call 2, how long.** One Choice question for each of those three activities, so each gets its own
   minutes. Each question names the activity's MET value, since how long it takes to cover today's
   target depends on it.
5. Both calls' prompts, Jev's answers and the result are logged together in SQLite for reviewing
   while tuning the prompt.

Jev only answers multiple-choice questions; it doesn't write text. The card wording comes from code.
Jev API reference: https://docs.typesafe.ai/api/system-one.md

### Run it

Requires Python 3.9 or newer. From the repo root:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then paste your Jev key into TYPESAFE_API_KEY
.venv/bin/uvicorn app.main:app --reload --port 8000
```

In a second terminal, from the repo root: `npm run dev`. Vite forwards `/api` to the backend. The
demo panel's **Backend** section says whether it's connected and whether Jev is live or mocked.
Without a key, a local mock returns answers in Jev's format, so the whole flow still runs.

Tests: `.venv/bin/python -m pytest` (from `backend/`).

### Files

| File | What it does |
|---|---|
| `backend/app/prompt.py` | Builds the prompts for both calls: `state` (the check-in variables), the activity question, and the duration questions. **Edit this to tune the prompt.** |
| `backend/app/jev.py` | Calls Jev with the API key; the mock used when there's no key |
| `backend/app/suggest.py` | After call 1, picks the activity and two backups; after call 2, gives each its own minutes and reasons |
| `backend/app/db.py` | SQLite: the app state, and a log of every prompt and answer |
| `backend/app/main.py` | The API routes |
| `backend/app/schemas.py` | Request and response shapes |
| `src/services/backend.ts` | The frontend side: builds the request, turns picks back into suggestions with MET-hours |

### API

| Route | |
|---|---|
| `POST /api/suggest` | Check-in variables and options in, pick and backups out (plus the prompt and Jev's answers) |
| `GET / PUT / DELETE /api/state` | Load, save, forget the app state |
| `GET /api/suggestions/log?limit=20` | Recent prompts and answers |
| `GET /api/health` | Is the backend up, and is Jev live or mocked? |

The database file is `backend/data/pha.db` (git-ignored). To look at recent prompts:
`sqlite3 backend/data/pha.db "select id, source, error from suggestion_log order by id desc limit 5"`.

## Next: store user data in proper tables

Today SQLite has two tables: `app_state` (the whole app state as one JSON document per user, the
same thing localStorage held) and `suggestion_log`. Once the team settles the schema, split the app
state into tables and update `backend/app/db.py` and the `UserRepository` in `src/services/store.ts`.
A starting draft:

| Table | Columns |
|---|---|
| `users` | id, name, created_at |
| `profiles` | user_id, usual_time, has_health_condition, fitbit_connected, clinician_view_enabled, updated_at |
| `enjoyed_activities` | user_id, family_id, rank, access (`have` / `sometimes` / `no`) |
| `goals` | user_id, week_start, met_hours, set_by (`default` / `recap`; only the user changes it) |
| `week_plans` | user_id, week_start, mon … sun (`off` / `0` / `5` / `10` / `30` / `45` minutes) |
| `sessions` | id, user_id, date, variant_id, compendium_code, met, duration_min, avg_hr, source, confirmed, band |
| `declines` | id, user_id, date, family_id, reason, note |
| `clinician_notes` | user_id, name, role, note, updated_at (context for the agent; sets nothing) |
| `equipment` | user_id, place (`home` / `gym`), equipment_id; plus a "no gym" flag on `profiles` |
| `sign_ins` | user_id, date (one row per day the app was opened; the streak is computed from these) |
| `vo2_max` | user_id, month, ml_kg_min, source (`fitbit`) |
| `check_ins` | user_id, date, minutes, place, energy, mood |
| `chat_messages` | id, user_id, role, text, created_at |

`buildAgentContext` then reads from these rows instead of in-memory state, and `serializeContext`
turns them into the JSON block injected into the prompt. Move to per-week `date` fields (instead of
`dayIndex`) at this point.

## Later: a chat model for the Chat tab

The Chat tab answers general questions in the user's own words. It's still scripted, and it needs a
model that writes text, so it will use a different model than Jev.

1. Add `POST /api/chat` to the same FastAPI backend. It receives `{ system, messages }`, forwards them
   to the chat model's provider and streams the text back. **Keep the API key on the server.**
   Anything in the frontend is visible to users.
2. In `src/services/agent.ts`, change the last line to:
   ```ts
   export const agent: Agent = new HttpAgent("/api/chat");
   ```
   `HttpAgent` already sends `buildSystemPrompt(ctx)` plus the chat history.
3. Review the prompt in `src/services/prompts.ts`. The demo panel's *What the coach sees* button
   renders the exact prompt for the current state.
4. Keep `MockAgent` around for offline demos and tests (e.g. pick it with an env flag).

Ideas once it's connected: run `VERIFIER_BRIEF` (prompts.ts) as a second agent that checks the
coach's replies, and parse free-text "Other" notes into structured preferences.

## Later: real Fitbit data

- **Research datasets** (Fitabase, PMData, LifeSnaps): write loaders that map each exercise row to a
  `Session` (`variantId` via a lookup table from the dataset's activity names to Compendium entries).
  `src/data/mockFitbit.ts` already uses the PMData-style shape.
- **Live data**: Fitbit Web API (OAuth on the backend), pulling activity logs and active zone
  minutes into the `sessions` table on sync.

## Guardrails to keep

- Only suggest activities from the user's enjoyed list and marked accessible (the code filters options before Jev sees them; the verifier re-checks; desk moves are the one exception).
- With a health flag: nothing at 6 MET or more, and suggest checking with a clinician first.
- Use `clinician_notes` as context when relevant; never treat them as a goal or a rule.
- Remind the user it's a machine learning model and can make mistakes (the app shows this at the top of every conversation).
- Never point out a missed day or a broken streak.
- Symptoms like chest pain or dizziness: stop and contact a clinician (see the `safety` script).
- Never let a model produce numbers; MET-hours come from the calculator and the verifier compares them.
