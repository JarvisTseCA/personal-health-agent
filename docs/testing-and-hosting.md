# Testing and hosting the app

What the team does to test the Today tab with suggestions from the activity table (Phase 3 of the
plan) and to put the backend online so the GitHub Pages demo can use it (Phase 4).

**Where things stand (Nov 22, 2026)**

| | Status |
|---|---|
| Automated tests | Pass on `main`, and CI runs them on every pull request. |
| Offline walkthrough, Jev mocked | **Done.** 80 picks, no problems (results below). |
| Live Jev walkthrough | **To do** on a laptop with the Jev key (section 2.3). |
| A day of use by two teammates | **To do** (section 2.5). |
| Hosting code: CORS setting, one saved state per browser, build variables, Render setup file | **Done** (section 3.1). |
| Render account, secrets, GitHub variables, smoke test | **To do** (sections 3.3 to 3.8). |

Jarvis owns every step for now (decided Nov 22). Steps marked **you** need someone with the
account or the key; nobody else can do them, and no key ever goes in chat, in git or in a GitHub
variable.

---

## 1. Run the app on a laptop

```bash
git checkout main && git pull
npm install
npm run dev                                  # the app, http://localhost:5173
```

In a second terminal, the backend:

```bash
cd backend
python3 -m venv .venv                        # first time only
source .venv/bin/activate                    # Windows: .venv\Scripts\activate
pip install -r requirements.txt              # first time, and after requirements.txt changes
uvicorn app.main:app --reload --port 8000
```

`backend/.env` (git-ignored; copy `backend/.env.example`) holds the keys:

| Setting | Without it |
|---|---|
| `TYPESAFE_API_KEY` | Jev is mocked: fixed rules, no cost |
| `OPENAI_API_KEY` | Chat replies come from the placeholder writer |
| `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` | Fitbit stays simulated |

Check: http://localhost:8000/api/health says `"jev": "live"` or `"mock"`.

To use the activity table on Today, set **Suggestions from** → *The activity table (backend)* in
the demo controls, or start the app with `VITE_SUGGEST_SOURCE=table npm run dev`.

---

## 2. Test (Phase 3)

### 2.1 Automated tests

```bash
npm test && npm run typecheck && npm run build
cd backend && python3 -m pytest -q
```

On Nov 22: 154 frontend tests and 247 backend tests pass. CI (`.github/workflows/ci.yml`) runs
the same on every pull request.

### 2.2 Offline walkthrough, Jev mocked: done

`scripts/phase3_walkthrough.py` drives the real app in a browser:

- **Who and where:** five personas (Alex, On a roll, Tough month, Fresh start, and Alex with a
  health flag) × three places × three energy levels ("Up for a challenge", "Normal", and
  "pretty tired" typed in).
- **Declines:** each decline reason once per persona.
- **Dislikes:** Running is marked 👎 for everyone.

For every pick it checks:
- the pick came from the table and has two backups
- the verifier passes
- nothing comes from a 👎 category
- nothing outdoor-only is suggested indoors
- nothing vigorous (6 MET or more) is suggested with a health flag
- the next pick follows each decline

Result on Nov 22, backend on the laptop with Jev mocked: **80 picks, 0 problems, 0 page errors, 0
fallbacks.**

| Check | Result |
|---|---|
| 45 check-ins | All from the table, each with 2 backups, verifier all pass |
| Energy | Challenge 5.8 to 7 MET · Normal 4 to 4.8 · Low 3.5 |
| Health flag | Highest pick 5.8 MET |
| 👎 Running | Never suggested |
| "No time" | Time drops to 10 min |
| "Too tired" | Lighter (4 → 3.5 MET) |
| "Not in the mood", "Can't access it" | A different activity |
| "Did this recently" | A different category |
| "Weather" at Outside | An indoor pick, with `indoor_only` sent |
| "Something hurts" | Gentle desk moves (2.3 MET) |

The mock isn't a test of pick quality: with no likes it always starts from the first category,
so most first picks were Bicycling. Variety and fit are what the live Jev walkthrough checks.

**To run it again:**

```bash
pip install playwright && python -m playwright install chromium   # first time only
# backend running (section 1), then the app built for the table:
VITE_SUGGEST_SOURCE=table npm run build && npm run preview          # http://localhost:4173
python scripts/phase3_walkthrough.py                                # --headed to watch it
```

It uses a fresh browser profile, so your own saved state isn't touched. It prints a summary and
writes every pick to `walkthrough.json` (git-ignored). It exits with an error if anything failed.

### 2.3 Live Jev walkthrough: **you**, on a laptop

1. Put `TYPESAFE_API_KEY` in `backend/.env`, restart the backend, and check `/api/health` says
   `"jev": "live"`.
2. Set a spending limit on the TypeSafe AI account first. One walkthrough is 80 picks, and each
   pick is up to 3 Jev calls.
3. Run the walkthrough as in 2.2. Write down from its summary:
   - problems, if any
   - how many picks fell back to the in-app pick (Jev took over 10 s or failed)
   - the median and slowest wait
4. Open a few picks in the demo controls → **Jev prompt** and read Jev's answers. Do they make
   sense for the persona, the place and the energy?
5. Decide the fallback wait (open question 2 in the plan). It's 10 s now, `TABLE_WAIT_MS` in
   `src/state/suggestSource.ts`. If the slowest live picks are near it, raise it or speed up
   the backend.

### 2.4 Rules on every pick

The walkthrough checks them automatically. By hand, the demo controls → **Verifier checks** must
show *Pass* for every row on any pick:
- never a 👎 category
- nothing vigorous with a health flag
- 3.5 MET or less after "Something hurts"
- indoors after "Weather"

### 2.5 A day of use: **two teammates**

Each uses the app for a full day with **Suggestions from** set to the activity table, on the
hosted demo once section 3 is done, or on a laptop until then.

Note anything odd, with the time and a screenshot, in a GitHub issue titled "Day of use: <name>":
- a pick that doesn't fit the place, time or energy
- a wait that feels long
- a decline that didn't change the next pick
- wording that's unclear
- an error toast

**Phase 3 is done when:** the walkthrough has no problems with live Jev, the team agrees the wait
is acceptable, and the two days turn up nothing that blocks a demo.

---

## 3. Host the backend and point the demo at it (Phase 4)

The GitHub Pages demo (https://jarvistseca.github.io/personal-health-agent/) has no backend
today, so it uses the in-app ranker and the simulated Fitbit.

### 3.1 Already in the repo

| What | Where |
|---|---|
| The backend allows the Pages site to call it, from a setting: `ALLOWED_ORIGINS=https://jarvistseca.github.io` (comma-separated for more) | `backend/app/main.py` |
| One saved state per browser: the built app sends its own id (kept in localStorage) with the saved state, suggestions and Fitbit routes, so testers don't overwrite each other. `npm run dev` keeps the shared id `demo`, so a laptop's saved state stays where it was. | `src/services/userId.ts` |
| The demo build reads two GitHub variables, `API_BASE` and `SUGGEST_SOURCE` | `.github/workflows/deploy.yml` |
| A Render setup file (a "Blueprint"): Python, the start command, the health check, and every setting, with the secret ones left for the dashboard | `render.yaml` |

### 3.2 Choose a plan: **you**

Render's Free web services cost nothing, with two catches:
- **They sleep.** A Free service sleeps after 15 minutes without traffic, and the first request
  after that can take up to a minute.
- **Saved data is lost.** Its files, including our SQLite database, are lost on every redeploy,
  restart or sleep.

For a class demo, Free is usually enough:
- open the backend's `/api/health` a minute before presenting, to wake it
- expect saved progress to reset now and then

For progress that lasts, move the service to a paid plan and attach a disk. `render.yaml` has the
disk lines ready to uncomment; set `PHA_DB_PATH=/var/data/pha.db` too. That costs money, so it's
the team's call.

Other hosts (Railway, Fly.io, Cloud Run) work too: start from `backend/` with
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, deploy the whole repo (the backend reads
`activity_tables/`), and set the same settings as in `render.yaml`.

### 3.3 Create the service: **you**

1. Sign in at render.com with GitHub and allow it to see `JarvisTseCA/personal-health-agent`.
2. **New → Blueprint**, pick the repo and the `main` branch. Render reads `render.yaml` and shows
   one web service, `pha-backend`.
3. Render asks for each secret setting. Enter:
   - `TYPESAFE_API_KEY`: the Jev key
   - `OPENAI_API_KEY`: the OpenAI key, or leave it empty
   - leave the three `GOOGLE_HEALTH_…` settings empty unless you do 3.6
4. **Apply.** The first build takes a few minutes. Note the address Render gives the service, e.g.
   `https://pha-backend.onrender.com`.
5. In each API provider's billing settings, set a monthly spending limit.

### 3.4 Check the backend

Open `https://<your service>/api/health`. It should say `"ok": true` and `"jev": "live"`. If it
says `"mock"`, the key didn't reach Render: check **Environment** on the service and redeploy.

### 3.5 Point the demo at it: **you**, or Claude with your go-ahead

1. GitHub → the repo → **Settings → Secrets and variables → Actions → Variables** →
   **New repository variable**:
   - `API_BASE` = `https://<your service>/api`
   - `SUGGEST_SOURCE` = `table`

   These are variables, not secrets: they end up in the published JavaScript. Never put a key here.
2. **Actions → Deploy demo → Run workflow** (it also runs on every merge to `main`).

### 3.6 Real Fitbit on the hosted backend (optional): **you**

1. In the Google Cloud console, on the OAuth client Andy set up, add the authorized redirect URI
   `https://<your service>/api/fitbit/callback`.
2. On Render, set:
   - `GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET`, from Andy
   - `GOOGLE_HEALTH_REDIRECT_URI` to that same address
3. Only test users on the Google project can connect, and each sign-in lasts 7 days (Google's
   Testing mode).

### 3.7 Smoke test on the live demo

- [ ] `https://<your service>/api/health` says `"jev": "live"`.
- [ ] The demo's controls say "Python backend connected" and Jev live.
- [ ] One check-in at each place (Indoors, private; Indoors, with others; Outside) shows "Finding
      one for you…", then a pick whose Backend line says "activity table".
- [ ] A second browser (or a private window) starts fresh, and the first browser's progress is
      still there after a reload.
- [ ] No red errors in the browser console.

**Phase 4 is done when** the smoke test passes.

### 3.8 Roll back in one step

Set the GitHub variable `SUGGEST_SOURCE` to `library` (or delete it) and run **Deploy demo**.
Today goes back to the built-in list; the backend can stay up. If the backend is down, the app
already shows its own pick on its own.

To take the demo off the backend completely, delete `API_BASE` and run **Deploy demo**.

### 3.9 What to watch, weekly at first

- **Errors:** Render → the service → **Logs**. Look for "No activity in the table fits today" and
  Jev errors.
- **Wait:** each suggestion prints its steps with timings in the same log.
- **Acceptance:** `GET https://<your service>/api/suggestions/log` lists recent prompts and Jev's
  answers. Picks accepted and declined are in each browser's saved state.
- **Spend:** the TypeSafe AI and OpenAI dashboards, against the limits from 3.3.

---

## 4. Checklist

| # | Step | Who | Needs |
|---|---|---|---|
| 1 | Live Jev walkthrough, timings written down | Jarvis | Jev key on a laptop |
| 2 | Decide the fallback wait | Team | Step 1's timings |
| 3 | Choose Free or paid on Render | Team | — |
| 4 | Create the Render service and enter secrets; set spending limits | Jarvis | Render account; keys |
| 5 | GitHub variables `API_BASE`, `SUGGEST_SOURCE`; run Deploy demo | Jarvis (or Claude) | Step 4's address |
| 6 | Smoke test on the live demo | Jarvis | Step 5 |
| 7 | A day of use each | Two teammates | Step 5, or a laptop |
| 8 | Real Fitbit on the hosted backend (optional) | Jarvis with Andy | Google client, redirect URI |

## 5. Known gaps

- **Chat:** the Chat tab still uses scripted replies; it doesn't call the backend's `/api/chat` yet.
- **Real Fitbit after a table pick:** a real workout is matched to the app's own activities
  (BIKING → Cycling), so the coach asks "Right?" instead of logging it straight away. The
  simulated sync logs it directly.
- **Saved data on Render's Free plan** resets now and then (section 3.2).
