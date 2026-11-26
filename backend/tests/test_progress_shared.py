"""
The streak, the trophies, the past weeks, the goal offer and the Summary averages, against the shared examples.

The app and the backend each have their own copy of these calculations: here it is
app/progress.py, in the app src/lib/rewards.ts, src/lib/goal.ts, src/services/context.ts and
src/services/summary.ts. Both are held to the same examples, shared_examples/progress.json at
the top of the repo: this test works them out with the backend's copy,
src/lib/progress.shared.test.ts with the app's.

The examples count days the app's way: 0 = Monday … 6 = Sunday, in "this week" and in the
weeks before it. Memory holds real dates, so each example is laid out on the calendar first
(this week starts on MONDAY) and then worked out from dates alone.

If an example fails after a change to the calculation, the backend no longer agrees with
the app. Change the app's copy the same way, then the answers in the examples.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app import progress

EXAMPLES_FILE = Path(__file__).resolve().parents[2] / "shared_examples" / "progress.json"
EXAMPLES = json.loads(EXAMPLES_FILE.read_text(encoding="utf-8"))["examples"]

MONDAY = date(2026, 11, 23)  # this week's Monday; any Monday will do


def memory_of(example):
    """The example as Memory holds it: (goals, daily), with real dates."""
    goals, workouts, opens = [], [], []

    def add_week(monday, tag, goal, week_workouts, week_opens):
        goals.append({"week_start": monday.isoformat(), "goal_met_hours": goal, "goal_set_by": "default", "plan": example["plan"]})
        for i, w in enumerate(week_workouts):
            workouts.append({
                "id": f"shared-{tag}-{i}",
                "date": (monday + timedelta(days=w["day"])).isoformat(),
                "activity_code": None,
                "activity_name": f"Shared example {tag}-{i}",
                "met": w["met"],
                "duration_min": w["minutes"],
                "source": "fitbit" if w.get("band") else "manual",
                "confirmed": w.get("confirmed", True),
                "band": w.get("band"),
            })
        # A week the app holds no record for (null) and a week with no opens ([]): no dates for that week, either way.
        opens.extend((monday + timedelta(days=day)).isoformat() for day in week_opens or [])

    past = example["past_weeks"]
    for i, week in enumerate(past):
        add_week(MONDAY - timedelta(weeks=len(past) - i), f"past{i}", week["goal"], week["workouts"], week["opens"])
    add_week(MONDAY, "now", example["weekly_goal"], example["workouts"], example["opens"])
    return goals, {"workouts": workouts, "app_opens": sorted(opens)}


def worked_out(example):
    """What app/progress.py makes of the example, under the names the examples use."""
    goals, daily = memory_of(example)
    n = progress.numbers(goals, daily, MONDAY + timedelta(days=example["today"]))
    past, summary = n["past_weeks"], n["summary"]

    def days(flags):
        return [day for day, on in enumerate(flags) if on]

    return {
        "streak": n["streak"],
        "trophy": n["trophy"],
        "trophies": n["trophies"],
        "week_done": n["this_week"]["done_met_hours"],
        "past_done": [week["done_met_hours"] for week in past],
        "past_opens": [days(week["app_opens"]) for week in past],
        "past_active": [days(week["active_days"]) for week in past],
        "offer": {"kind": n["goal_offer"]["kind"], "to": n["goal_offer"]["to"]},
        "summary": {
            "weeks": summary["weeks"],
            "avg_met_hours": summary["avg_met_hours"],
            "avg_brisk_min": summary["avg_brisk_min"],
            "goal_weeks": summary["goal_weeks"],
            "avg_active_days": summary["avg_active_days"],
            "longest_gap": summary["longest_gap"],
            "intensity": summary["intensity"],
        },
    }


def differences(got, want, where=""):
    """Where `got` isn't what the example expects. Only what the example lists is checked; numbers to 3 decimals."""
    if isinstance(want, dict):
        return [d for key, value in want.items() for d in differences(got[key], value, f"{where}.{key}" if where else key)]
    if isinstance(want, list):
        if not isinstance(got, list) or len(got) != len(want):
            return [f"{where}: {got} (expected {want})"]
        return [d for i, value in enumerate(want) for d in differences(got[i], value, f"{where}[{i}]")]
    if isinstance(want, bool) or isinstance(want, str):
        return [] if got == want else [f"{where}: {got!r} (expected {want!r})"]
    return [] if got == pytest.approx(want, abs=0.0005) else [f"{where}: {got} (expected {want})"]


def test_there_are_examples_to_check():
    assert EXAMPLES


@pytest.mark.parametrize("example", EXAMPLES, ids=[e["name"] for e in EXAMPLES])
def test_progress_matches_the_shared_example(example):
    wrong = differences(worked_out(example), example["expect"])
    assert not wrong, f"shared_examples/progress.json disagrees on {'; '.join(wrong)}. {example['how']}"
