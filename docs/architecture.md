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
   │      check-in confirms today's planned time and its source:  lib/plan.ts (DaySource)
   │      the weekly plan, or the user's edited calendar block
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
Without a key, a local mock returns answers in Jev's format, so the whole flow still runs. The Chat
route has its own key, `OPENAI_API_KEY`; see the Chat section below.

**Check that Jev is live.** Open http://localhost:8000/api/health in a browser while the backend
runs:

```json
{"ok": true, "jev": "live", "model": "jev-latest", "chat_writer": "ChatGPT gpt-6-luna"}
```

- `"jev": "live"`: suggestions come from the real Jev. `"model"` is the Jev model the backend asks for (`JEV_MODEL`); it shows even when mocked.
- `"jev": "mock"`: no `TYPESAFE_API_KEY` was found, so a local mock answers instead. Check the line
  in `backend/.env`, then stop and restart the backend; it reads `.env` only when it starts.
- `"chat_writer"`: the model that writes Chat replies, or `"placeholder"` without `OPENAI_API_KEY`.
- No page at all: the backend isn't running, and the app uses its own ranker.

In the app, the demo panel's **Backend** section says the same, and once a pick arrives, "Current
pick from: Jev" (or "mock Jev", or "in-app ranker"). **Jev prompt** there shows what was sent to Jev
and its answers. The backend's terminal also prints each Jev call and how long it took. On the
hosted backend, use the same check at `https://<your service>/api/health`
([testing-and-hosting.md](testing-and-hosting.md)).

Tests: `.venv/bin/python -m pytest` (from `backend/`). They never call Jev or ChatGPT, with or without keys in `.env`.

### Files

| File | What it does |
|---|---|
| `backend/app/prompt.py` | Builds the prompts for both calls: `state` (the check-in variables), the activity question, and the duration questions. **Edit this to tune the prompt.** The prompts for `/api/suggest/table` are at the bottom of the file. |
| `backend/app/jev.py` | Calls Jev with the API key; the mock used when there's no key |
| `backend/app/suggest.py` | After call 1, picks the activity and two backups; after call 2, gives each its own minutes and reasons |
| `backend/app/activities.py` | The activity table: copies the CSV into SQLite when the backend starts, and picks the rows that fit a user today |
| `backend/app/chat_rules.py` | Chat, check 1: reads the urgent keywords and tells whether a message matches one |
| `backend/app/chat_gate.py` | Chat, check 2: the three yes/no questions for Jev, the thresholds, and the mock used when there's no key. **Edit this to tune the questions.** |
| `backend/app/chat_replies.py` | Chat: reads the three fixed replies |
| `backend/app/chat_prompt.py` | Chat: builds the system prompt for the model that writes |
| `backend/app/chat_writer.py` | Chat: calls ChatGPT with the API key and passes its reply on piece by piece; a placeholder when there's no key |
| `backend/chat_content/` | The wording of the Chat route, editable without code: `urgent_keywords.csv`, `fixed_replies.csv`, `chat_brief.txt` |
| `backend/app/db.py` | SQLite: the app state, a log of every prompt and answer, and the activity table |
| `backend/app/main.py` | The API routes |
| `backend/app/schemas.py` | Request and response shapes |
| `src/services/backend.ts` | The frontend side: builds the request, turns picks back into suggestions with MET-hours |

### API

| Route | |
|---|---|
| `POST /api/suggest` | Check-in variables and options in, pick and backups out (plus the prompt and Jev's answers) |
| `POST /api/suggest/table` | The same, with the options taken from the activity table (next section). Not used by the app yet |
| `GET /api/activities` | The activity table. `?place=gym`, `?heading=Bicycling` (repeatable) and `?recommended=false` narrow or widen it |
| `POST /api/chat` | A Chat message in, the reply out as streamed plain text (see the Chat section). Not used by the app yet |
| `GET / PUT / DELETE /api/state` | Load, save, forget the app state |
| `GET /api/suggestions/log?limit=20` | Recent prompts and answers |
| `GET /api/health` | Is the backend up, is Jev live or mocked, and what writes Chat replies? |

The database file is `backend/data/pha.db` (git-ignored). To look at recent prompts:
`sqlite3 backend/data/pha.db "select id, source, error from suggestion_log order by id desc limit 5"`.

## Done: suggestions from the activity table (in the app behind a setting)

By default the app picks from its own small activity library (`src/lib/activities.ts`) and calls
`POST /api/suggest` (above). With the setting `VITE_SUGGEST_SOURCE=table`, or *Suggestions from* in
the demo controls, Today picks from the team's activity table through `POST /api/suggest/table`
instead (below). What's left to test and host: [testing-and-hosting.md](testing-and-hosting.md).

**The activity table.** `activity_tables/2024_compendium_exercise_recommendations.csv` lists the 2024
Adult Compendium's activities, each marked with where it can be done, whether it needs equipment or a
partner, and whether it is an exercise to recommend (`exercise_rec`). Each time the backend starts, it
copies the CSV into the `activities` table in SQLite. So the CSV is the only place to edit: change it and
restart the backend. A mistake in the CSV (a MET value that isn't a number, a code used twice) stops the
backend from starting and names the line.

Two more columns, `family` (the movement itself, e.g. `running`, `cycling_indoor`) and `type` (the kind
of workout, e.g. `cardio`, `mind_body`), are for the similarity check between suggestions; the backend
doesn't use them yet. `activity_tables/update_table.py` fills them in from rules on the description,
and also holds the hand fixes to rows (by code, each with its reason). After editing the CSV, run
`python activity_tables/update_table.py` so both columns stay in step.

`activity_code`, the 5-digit Compendium code, is the id. The frontend library stores the same code for
each of its activities (`code`), so both sides can point at the same activity.

**`POST /api/suggest/table`** does the same job as `/api/suggest`, with the options taken from the table:

```
check-in variables ──► filter the ──► Call 1: which ──► Call 2: which activity? ──► Call 3: how long? ──► pick + 2
and picked_codes        table          heading?          1 question per heading       1 question per        backups
(from the frontend)     (code)         1 question        (Jev's top three)            picked activity
```

1. The frontend sends the check-in variables as before, but no options. Instead it sends what the
   user likes: `liked_categories` (the categories marked 👍) and `picked_codes` (the Compendium codes
   of suggestions they accepted, favorites first). Recent and declined activities can carry their
   `code`, so the prompts name them by the table's description.
2. **Filter.** `candidates()` in `activities.py` keeps the rows marked `exercise_rec` that can be done
   where the user is, need no partner and are 3 MET or more (light activity doesn't count toward the
   goal). Places: *indoors, private* reads `at_home`; *indoors, with others* reads `loc_gym` or
   `at_home`; *outside* reads `loc_outside`. Likes never filter. `exclude_headings` drops a heading
   (a 👎 category, or after "Did this recently"); `exclude_codes` drops one activity (after "Not in
   the mood", "Can't access it" or "Other"); `indoor_only` keeps gym and home rows (after "Weather");
   a health limit or `below_met` caps the MET value.
3. **Call 1, which heading.** One Choice question whose options are the headings that have a
   candidate today. A 👍 category says "A category they like." and a heading picked before says
   "Picked before (#n).", so Jev ranks them higher. Skipped when there is only one heading.
4. **Call 2, which activity.** One question for each of Jev's top three headings. The options are
   that heading's candidates, named by their code; one picked before says "Picked before.". The best
   activity of the top heading is the pick
   and the best of the next two are the backups, so the three are different kinds of activity.
5. **Call 3, how long.** As in `/api/suggest`: one question for each picked activity.

Why the heading comes first: one user can have hundreds of candidates, more than a question takes
(255 options). And if every row were one option, a heading with many rows would outweigh a heading
with few on numbers alone.

Each pick comes back with `activity_code`, `major_heading`, `activity_description`, `label` (the
description up to its effort level, e.g. "Bicycling, stationary, 60 watts", for the card),
`met_value` and `duration_min`, so the app can show it without its own copy of the table. `GET /api/activities`
returns the table itself.

**In the app** (Phase 2 of the plan), behind the setting `VITE_SUGGEST_SOURCE` (`library`, the
default, or `table`), which the demo controls can also switch ("Suggestions from"):

- `buildTableRequest` in `src/services/backend.ts` sends today's check-in, 👍 categories
  (`liked_categories`), 👎 categories and a "Did this recently" category (`exclude_headings`),
  activities ruled out today and "Can't access it" at this place (`exclude_codes`), `indoor_only`
  after "Weather", `below_met` after "Too tired", and recent workouts and declines with their codes.
- Each place learns from its own feedback: an accepted table row's code is saved under today's
  place (`profile.pickedCodes`), and each decline is saved with its place. A request sends only that
  place's picked codes and declines; likes, limits and today's exclusions apply everywhere.
- While the backend decides, the card says "Finding one for you…". If the backend can't be reached,
  errors, finds nothing that fits, or takes more than 10 seconds (`TABLE_WAIT_MS`), the in-app
  ranker's pick is shown instead.
- Each row the backend returns becomes a one-variant activity with the id `table-<code>`
  (`src/lib/tableActivities.ts`), registered so `getFamily` / `getVariant` find it. The rows are
  saved with the app state (`tableActivities`), so a reload keeps today's pick and past sessions.
  MET-hours are always the row's MET × minutes ÷ 60, from the calculator. *Show me how* appears
  only when the library has an activity with the same Compendium code. MET-hours still come from the calculator in `src/lib`.

Not handled yet:

- Equipment isn't filtered. The table says whether an activity needs equipment, not which. Jev sees
  the user's equipment list in `state`.
- "Up for a challenge" gives Jev the 1.5× aim but not the user's usual session length, because the
  table doesn't say which rows are paces of the same activity.

## Next: store user data in proper tables

Today SQLite has three tables: `app_state` (the whole app state as one JSON document per user, the
same thing localStorage held), `suggestion_log` and `activities` (the copy of the activity CSV). Once
the team settles the schema, split the app state into tables and update `backend/app/db.py` and the
`UserRepository` in `src/services/store.ts`. A starting draft:

| Table | Columns |
|---|---|
| `users` | id, name, created_at |
| `profiles` | user_id, usual_time, has_health_condition, fitbit_connected, clinician_view_enabled, updated_at |
| `enjoyed_activities` | user_id, family_id, rank, access (`have` / `sometimes` / `no`) |
| `goals` | user_id, week_start, met_hours, set_by (`default` / `recap`; only the user changes it) |
| `week_plans` | user_id, week_start, mon … sun (`off` / `0` / `5` / `10` / `30` / `45` minutes) |
| `sessions` | id, user_id, date, variant_id, compendium_code, met, duration_min, avg_hr, source, confirmed, band |
| `declines` | id, user_id, date, family_id, reason, note |
| `clinician_notes` | id, user_id, text, created_at (what the user told Chat their clinician said; agent context, never changes the goal) |
| `equipment` | user_id, place (`home` / `gym`), equipment_id; plus a "no gym" flag on `profiles` |
| `sign_ins` | user_id, date (one row per day the app was opened; the streak is computed from these) |
| `vo2_max` | user_id, month, ml_kg_min, source (`fitbit`) |
| `fitbit_tokens` | user_id, access_token, refresh_token, expires_at, scope (already in SQLite) |
| `check_ins` | user_id, date, minutes, place, energy, mood |
| `chat_messages` | id, user_id, role, text, created_at |

`buildAgentContext` then reads from these rows instead of in-memory state, and `serializeContext`
turns them into the JSON block injected into the prompt. Move to per-week `date` fields (instead of
`dayIndex`) at this point.

## Done in the backend: the Chat route (not in the app yet)

The Chat tab answers general questions in the user's own words. In the app it is still scripted
(`MockAgent`). The backend can now answer for real: `POST /api/chat` takes the message through two
checks and, if it passes both, has a model write the reply. Jev doesn't write text, so the reply
comes from ChatGPT.

```
the last user ──► 1. urgent keywords ──► 2. Jev: three yes/no ──────► 3. ChatGPT writes the reply
message              a match gets the       questions. urgent, medical    (its brief repeats the
                     fixed "urgent"         advice or off topic gets      same three rules)
                     reply                  its fixed reply
```

1. **Urgent keywords** (`chat_rules.py`). The message is compared with the list in
   `backend/chat_content/urgent_keywords.csv`: a phrase such as "passed out", or two words in the
   same sentence such as `chest` and `pressure`. A match gets the fixed `urgent` reply and no model
   is asked. This check is for the plain cases that must not be missed.
2. **Jev, three yes/no questions in one request** (`chat_gate.py`). Does the user need urgent help?
   Are they asking for medical advice? Is the message about exercise, health or this app? Jev
   answers each with a probability and the code decides, in this order: `urgent` at 0.5 or more,
   `medical_advice` at 0.7 or more, `about_health_or_app` under 0.3. Each has its own fixed reply;
   anything else goes on. If Jev can't be reached the route returns an error. It doesn't skip the
   check.
3. **The model that writes** (`chat_writer.py`). ChatGPT, through OpenAI's Chat Completions API. Its
   system prompt (`chat_prompt.py`) is the Chat brief, with the three fixed replies in it word for
   word, followed by what the app sent as `system`. The brief tells the model to turn down the same
   three kinds of message, so it is the third and last check.

**What comes back.** Plain text, sent piece by piece as the model writes it. That is what
`HttpAgent` in `src/services/agent.ts` already reads. A fixed reply arrives in one piece. Two
response headers say what happened:

| Header | Values |
|---|---|
| `X-Chat-Stopped-By` | `keywords`, `jev` or `none` |
| `X-Chat-Reply` | `urgent`, `medical_advice`, `off_topic`, or `model` when the model wrote the reply |

The backend terminal prints each step, [1] to [5].

**The wording is in three files** in `backend/chat_content/`, so it can change without touching
code: edit a file, restart the backend. A file that can't be read stops the backend when it starts
and names the line.

| File | What it holds |
|---|---|
| `urgent_keywords.csv` | One keyword per line: `group, text, together_with`. With `together_with` empty the line is a phrase. With it filled, a word from `text` and a word from `together_with` have to be in the same sentence |
| `fixed_replies.csv` | The three fixed replies: `reply, text` |
| `chat_brief.txt` | The brief for the model that writes. `[urgent reply]`, `[medical_advice reply]` and `[off_topic reply]` mark where the fixed replies go |

**Settings**, in `backend/.env`:

- `OPENAI_API_KEY`: the key for ChatGPT. Without it the route still runs, and a message that passes
  both checks gets a placeholder reply.
- `CHAT_MODEL`: which model writes. The default is `gpt-6-luna`.
- `OPENAI_BASE_URL`: only for a key that goes through another address than OpenAI's.
- `TYPESAFE_API_KEY`: the same Jev key as for suggestions. Without it a local mock answers the
  three questions.

With both keys, a message that isn't stopped by a keyword makes one Jev call, and one ChatGPT call
if Jev lets it through. What the app sends as `system` (the user's name, progress and clinician
notes; simulated in the demo) goes to OpenAI together with the conversation.

To try it with the backend running:

```bash
curl -s -i -X POST http://localhost:8000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"I have high blood pressure, can I do HIIT?"}]}'
```

To switch the app over: in `src/services/agent.ts`, change the last line to

```ts
export const agent: Agent = new HttpAgent("/api/chat");
```

`HttpAgent` already sends `buildSystemPrompt(ctx)` plus the chat history. Keep `MockAgent` for when
there is no backend (GitHub Pages) and for tests.

Not handled yet:

- The keyword list, the fixed replies, the brief and the wording of Jev's three questions are first
  drafts. They have not had a clinical review.
- The thresholds are starting values. The checks have run on a few real messages only; they haven't
  been measured on labelled examples.
- Chat messages aren't saved. There is no log like `suggestion_log` for them.
- Only the last user message is checked.
- The app's `system` still carries the coach brief written for the Today tab. The Chat brief comes
  first and wins where the two differ. A cleaner split is for the app to send only the user's data.
- A message that gives the clinician's feedback ("My doctor said…") is handled in the frontend
  (`src/services/clinicianChat.ts`) and doesn't reach the backend.
- The model's reply isn't checked before the user sees it.

Ideas for later: run `VERIFIER_BRIEF` (prompts.ts) as a second agent that checks the coach's
replies, and parse free-text "Other" notes into structured preferences.

## Done: real Fitbit data

The backend reads the user's own Fitbit through the **Google Health API**, which replaced the Fitbit Web
API when Google turned that off on Nov 2, 2026. Without a Google OAuth client in `backend/.env` (or
without the backend), Fitbit stays simulated exactly as before.

```
Connect (new tab) ──► Google sign-in ──► /api/fitbit/callback ──► tokens saved in SQLite
Sync Fitbit ──► /api/fitbit/sync?since=… ──► exercise + vo2-max data points ──► src/lib/fitbit.ts
                                             (every page, token refreshed)     workouts → Sessions,
                                                                                weeks → history,
                                                                                readings → monthly VO2 max
```

- **The backend only reshapes Google's JSON** (`backend/app/fitbit_data.py`): local clock times, minutes,
  heart rate zone minutes. Tokens never reach the browser.
- **The frontend decides what each workout was** (`src/lib/fitbit.ts`). Fitbit's exercise type picks the
  activity (`EXERCISE_VARIANTS`), and the heart rate zones pick the effort: mostly vigorous or peak is the
  very active band, anything else fairly active. Types with no matching activity become *Other activity*
  under Fitbit's name for them and count at the bottom of their band.
- **Today's newest workout goes through the usual confirm step** (`syncFitbit` in `src/state/today.ts`).
  It is logged when it matches the accepted plan, otherwise the coach asks *Right?*. Earlier workouts are
  counted as Fitbit labelled them, and a re-sync keeps whatever the user confirmed.
- **Six months come in on each sync:** 26 weeks of workouts become `history` (starting at the first week
  with any), and VO2 max becomes one value a month, the month's latest reading, carried into months
  without one.

### Set it up

You need a Google account that has a Fitbit linked to it.

1. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project.
2. Enable the [Google Health API](https://console.cloud.google.com/apis/library/health.googleapis.com) for it.
3. On [Branding](https://console.cloud.google.com/auth/branding), set up the consent screen (External).
4. On [Audience](https://console.cloud.google.com/auth/audience), add your Google account as a test user.
5. On [Data Access](https://console.cloud.google.com/auth/scopes), add the scope
   `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`.
6. On [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** client with the
   authorized redirect URI `http://localhost:8000/api/fitbit/callback`.
7. Paste its client ID and secret into `backend/.env` as `GOOGLE_HEALTH_CLIENT_ID` and
   `GOOGLE_HEALTH_CLIENT_SECRET`, then restart the backend.
8. Open the app at **http://localhost:5173** (not 127.0.0.1, so the sign-in cookie matches) and connect
   Fitbit in onboarding or Preferences.

While the project is in Testing mode, Google lets in only the test users and its refresh tokens expire
after 7 days. The app then says the sign-in has expired and the user connects again.

### Use a teammate's Google project

A teammate who already set up the project above can share it, so you skip steps 1 to 6.

1. Send the project owner the Google account your Fitbit is linked to. They add it as a test user on
   [Audience](https://console.cloud.google.com/auth/audience).
2. Get the client ID and secret from them privately, never in the repo or a shared channel.
3. Paste them into your own `backend/.env` and restart the backend.
4. Open the app at **http://localhost:5173** and connect Fitbit. Google warns that the app is not
   verified. Click **Continue**.

Each copy of the app keeps its own tokens in its own database (`backend/data/pha.db`), so teammates never see each
other's Fitbit.

### API

| Route | |
|---|---|
| `GET /api/fitbit/status` | Is a Google client set up, and does this user have tokens? |
| `GET /api/fitbit/connect` | Redirects to Google's consent page |
| `GET /api/fitbit/callback` | Google sends the user back here; saves the tokens, checks a Fitbit is linked |
| `GET /api/fitbit/sync?since=2026-05-18` | Workouts and VO2 max readings since that date |
| `DELETE /api/fitbit` | Forgets this user's tokens |

### Still open

- **Research datasets** (Fitabase, PMData, LifeSnaps) could feed the same `FitbitData` shape through a
  loader, for demos with recorded data.
- Onboarding's observed week still shows the simulated workouts.
- Past weeks use the current goal and plan, since Fitbit doesn't know them.

## Guardrails to keep

- Only suggest activities that aren't marked inaccessible or ruled out today (the code filters options before Jev sees them; the verifier re-checks). Liked activities, learned from accepted suggestions, rank higher but don't limit the options.
- Never suggest an activity in a category the user disliked (👎 in onboarding or Settings); the app filters these out before Jev sees the options, and the verifier re-checks. Liked categories (👍) are sent as `liked_categories` and rank higher.
- With a health flag: nothing at 6 MET or more, and suggest checking with a clinician first.
- Use `clinician_notes` (the user's paraphrase of their clinician's feedback) as context when relevant; never treat them as a goal.
- Remind the user it's a machine learning model and can make mistakes (the app shows this at the top of every conversation).
- Never point out a missed day or a broken streak.
- Symptoms like chest pain or dizziness: stop and contact a clinician (see the `safety` script; in the Chat route, the urgent keywords and Jev's `urgent` question).
- Never let a model produce numbers; MET-hours come from the calculator and the verifier compares them.

## Planned: calendar exercise blocks

The weekly planning session is the source of free time: the user says how much they have each day, and the
app takes it as true. The app then writes each day's time to the user's own Google Calendar as an exercise
block, so exercise sits next to their other events. It reads back only the blocks it created: if the user
moves, shortens or deletes one, that day's time follows the block and the rest of the week is re-split.
Gaps in the calendar are never treated as free time.

In the demo the calendar is simulated. `AppState.planSource` records, per day, whether its time came from
the plan or from an edited block, and *Simulate a calendar edit* in the demo panel stands in for the user
shortening today's block. Going live needs Google Calendar write access to events.

