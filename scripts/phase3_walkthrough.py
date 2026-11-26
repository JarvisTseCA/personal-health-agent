"""Phase 3 walkthrough: the app, with suggestions from the activity table, driven in a browser.

Five personas (the app's four scenarios, plus Alex with a health flag) x three places x three
energy levels, then each decline reason once per persona. Running is marked 👎 for everyone.
For every pick it checks: it came from the table, the verifier passes, nothing from a 👎
category, nothing outdoor-only indoors, nothing vigorous with a health flag, up to four backups,
and that the next pick follows each decline. It also times how long each pick took.

Works with Jev mocked (no TYPESAFE_API_KEY) or live. Steps: docs/testing-and-hosting.md.

    pip install playwright && python -m playwright install chromium
    python scripts/phase3_walkthrough.py [--url http://localhost:4173/] [--out walkthrough.json]
"""
import argparse, asyncio, json, re, sys, time
from playwright.async_api import async_playwright

ARGS = argparse.ArgumentParser(description=__doc__.split("\n")[0])
ARGS.add_argument("--url", default="http://localhost:4173/", help="the app, built with VITE_SUGGEST_SOURCE=table (npm run preview)")
ARGS.add_argument("--out", default="walkthrough.json", help="where to write every result")
ARGS.add_argument("--headed", action="store_true", help="show the browser")
ARGS.add_argument("--chrome", default=None, help="path to a Chrome to use instead of Playwright's Chromium")
OPTS = ARGS.parse_args()
URL = OPTS.url
PERSONAS = [("alex", "Alex", False), ("maya", "Maya", False), ("jordan", "Jordan", False), ("sam", "Sam", False), ("priya", "Priya", False),
            ("fresh", "Fresh start", False), ("alex", "Alex, health flag", True)]
PLACES = [("indoors_private", "Indoors, private"), ("indoors_with_others", "Indoors, with others"), ("outside", "Outside")]
ENERGIES = [("challenge", "Up for a challenge"), ("normal", "Normal"), ("low", "pretty tired")]
REASONS = [("no-time", "No time"), ("tired", "Too tired"), ("not-mood", "Not in the mood for this"), ("recent", "Did this recently"),
           ("no-access", "Can't access it"), ("weather", "Weather"), ("hurts", "Something hurts")]
rows, problems = [], []

async def state(pg):
    """The app's state as the backend keeps it. With Memory (#35) the app saves each step there:
    today's conversation under other.today and the table rows it knows under other.app."""
    await pg.wait_for_timeout(450)  # let the step reach the backend
    return await pg.evaluate("""async () => { const id = localStorage.getItem('pha-user-id');
        const q = '?user_id=' + encodeURIComponent(id) + '&group=other';
        const m = (await (await fetch('/api/memory' + q)).json()).memory;
        if (m && m.other && m.other.today) return { today: m.other.today, tableActivities: (m.other.app || {}).tableActivities };
        const r = await fetch('/api/state' + q); return (await r.json()).state; }""")

async def wait_pick(pg):
    t = time.perf_counter()
    # Live Jev can take a while; the app itself falls back after 10 s.
    await pg.wait_for_function("() => document.querySelector('.pick.lead') && !document.querySelector('.pick.finding')", timeout=30000)
    return time.perf_counter() - t

async def checks(pg):
    items = await pg.locator(".checks li").all_inner_texts()
    return [i.split("\n")[0] for i in items if i.startswith("Fail")]

async def check_in(pg, place_label, energy):
    await pg.get_by_role("button", name="Start today's check-in over").click(); await pg.wait_for_timeout(250)
    keep = pg.locator(".bubbles button", has_text=re.compile("^Keep"))
    if await keep.count():
        await keep.first.click()
    else:
        await pg.get_by_role("button", name="30 min", exact=True).first.click()
    await pg.wait_for_timeout(200)
    await pg.get_by_role("button", name=place_label, exact=True).click(); await pg.wait_for_timeout(200)
    if energy[0] == "low":
        box = pg.locator(".feed .other-input input"); await box.fill(energy[1]); await box.press("Enter")
    else:
        await pg.get_by_role("button", name=energy[1], exact=True).click()
    return await wait_pick(pg)

def lead_of(st):
    c = st["today"]["current"]; lead = c["lead"]; code = lead["variantId"].removeprefix("table-")
    row = (st.get("tableActivities") or {}).get(code)
    return lead, c, row

async def setup(pg, pid, name, health):
    await pg.get_by_role("button", name="Reset demo").click(); await pg.wait_for_timeout(400)
    await pg.locator("#persona").select_option(pid); await pg.wait_for_timeout(300)
    await pg.get_by_role("button", name="Skip onboarding").click(); await pg.wait_for_timeout(500)
    # Running 👎 for everyone: no pick may come from it.
    await pg.locator("nav.tabbar .tab", has_text="Settings").click(); await pg.wait_for_timeout(300)
    chip = pg.locator(".cat-chip", has_text=re.compile("^Running"))
    await chip.click(); await chip.click(); await pg.wait_for_timeout(200)
    if health:
        await pg.locator("nav.tabbar .tab", has_text="Today").click(); await pg.wait_for_timeout(200)
        await pg.get_by_role("button", name="Preferences").click(); await pg.wait_for_timeout(300)
        await pg.get_by_role("switch", name="Health condition").click(); await pg.wait_for_timeout(200)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        if await pg.get_by_role("button", name="Close").count(): await pg.get_by_role("button", name="Close").first.click()
    await pg.locator("nav.tabbar .tab", has_text="Today").click(); await pg.wait_for_timeout(300)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=OPTS.chrome, headless=not OPTS.headed)
        pg = await b.new_page(viewport={"width": 1280, "height": 1000})
        errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(1500)
        await pg.get_by_role("button", name="Verifier checks").click()
        for pid, name, health in PERSONAS:
            await setup(pg, pid, name, health)
            for place, place_label in PLACES:
                for energy in ENERGIES:
                    secs = await check_in(pg, place_label, energy)
                    st = await state(pg); lead, cur, row = lead_of(st)
                    fails = await checks(pg)
                    from_table = row is not None
                    r = dict(persona=name, place=place_label, energy=energy[0], wait=round(secs, 2), source=cur.get("source"),
                             table=from_table, code=lead["variantId"], heading=row["heading"] if row else "", met=lead["met"],
                             minutes=lead["durationMin"], backups=len(cur["backups"]), fails=fails)
                    if not from_table: problems.append(f"{name} · {place_label} · {energy[0]}: not from the table")
                    if fails: problems.append(f"{name} · {place_label} · {energy[0]}: verifier {fails}")
                    if row and row["heading"] == "Running": problems.append(f"{name}: disliked Running suggested")
                    if row and place != "outside" and row["places"] == ["outside"]: problems.append(f"{name} · {place_label}: outdoor-only pick {row['code']}")
                    if health and lead["met"] >= 6: problems.append(f"{name} · {place_label} · {energy[0]}: vigorous {lead['met']} MET with a health flag")
                    if not 1 <= len(cur["backups"]) <= 4: problems.append(f"{name} · {place_label} · {energy[0]}: {len(cur['backups'])} backups")
                    rows.append(r)
            # Each decline reason, from a fresh pick at Indoors, with others (Normal).
            for reason, label in REASONS:
                await check_in(pg, "Indoors, with others", ENERGIES[1])
                st = await state(pg); before, _, brow = lead_of(st)
                await pg.get_by_role("button", name="Let's start").click(); await pg.wait_for_timeout(200)
                await pg.get_by_role("button", name="Change of plans").click(); await pg.wait_for_timeout(200)
                await pg.get_by_role("button", name=label, exact=True).click()
                await wait_pick(pg)
                st = await state(pg); after, cur, arow = lead_of(st)
                ok, why = True, ""
                if reason == "no-time":  # the time drops to 10 min (or desk moves)
                    ok = after["durationMin"] <= 10 or cur.get("desk"); why = f"{before['durationMin']} → {after['durationMin']} min"
                elif reason == "tired":
                    ok = after["met"] < before["met"] or after["met"] < 6; why = f"{before['met']} → {after['met']} MET"
                elif reason in ("not-mood", "no-access"):
                    ok = after["variantId"] != before["variantId"]; why = f"{before['variantId']} → {after['variantId']}"
                elif reason == "recent":
                    ok = (arow or {}).get("heading") != (brow or {}).get("heading"); why = f"{(brow or {}).get('heading')} → {(arow or {}).get('heading')}"
                elif reason == "weather":
                    ok = arow is None or arow["places"] != ["outside"]; why = f"places {arow['places'] if arow else 'library'}"
                elif reason == "hurts":
                    ok = after["met"] <= 3.5; why = f"{after['met']} MET, desk={cur.get('desk')}"
                fails = await checks(pg)
                rows.append(dict(persona=name, place="Indoors, with others", energy="decline:" + reason, wait=None, source=cur.get("source"),
                                 table=arow is not None, code=after["variantId"], heading=(arow or {}).get("heading", ""), met=after["met"],
                                 minutes=after["durationMin"], backups=len(cur["backups"]), fails=fails, follows=ok, why=why))
                if not ok: problems.append(f"{name}: after '{label}' the pick didn't follow ({why})")
                if fails and reason != "hurts": problems.append(f"{name}: after '{label}' verifier {fails}")
        json.dump(dict(rows=rows, problems=problems, errors=errors), open(OPTS.out, "w"), indent=1)
        await b.close()
    waits = sorted(r["wait"] for r in rows if r["wait"] is not None)
    fallbacks = sum(1 for r in rows if not r["table"] and not r["energy"].startswith("decline:hurts"))
    print(f"{len(rows)} picks · {len(problems)} problems · {len(errors)} page errors · {fallbacks} fell back to the in-app pick")
    if waits:
        print(f"Wait for a pick: median {waits[len(waits) // 2]:.1f} s, slowest {waits[-1]:.1f} s")
    for x in problems:
        print(" -", x)
    print("Every result:", OPTS.out)
    sys.exit(1 if problems or errors else 0)
asyncio.run(main())
