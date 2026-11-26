"""
Today's target in MET-hours (the 2.1 in "0.0/2.1" on the app's Today page), against the shared examples.

The app and the backend each have their own copy of this calculation: here it is
app/calculator.py, in the app src/lib/met.ts and src/lib/plan.ts. Both are held to the
same examples, shared_examples/today_target.json at the top of the repo: this test works
them out with the backend's copy, src/lib/todayTarget.shared.test.ts with the app's.

If an example fails after a change to the calculation, the backend no longer agrees with
the app. Change the app's copy the same way, then the answers in the examples.
"""
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.calculator import today_numbers

EXAMPLES_FILE = Path(__file__).resolve().parents[2] / "shared_examples" / "today_target.json"
EXAMPLES = json.loads(EXAMPLES_FILE.read_text(encoding="utf-8"))["examples"]

MONDAY = date(2026, 11, 22)  # any Monday will do: the examples give days as 0 = Monday … 6 = Sunday


def workouts_of(example):
    """The example's workouts as Memory holds them (daily.workouts)."""
    return [
        {
            "id": f"shared-{i}",
            "date": (MONDAY + timedelta(days=w["day"])).isoformat(),
            "activity_name": "Shared example",
            "met": w["met"],
            "duration_min": w["minutes"],
            "source": "fitbit" if w.get("band") else "manual",
            "confirmed": w.get("confirmed", True),
            "band": w.get("band"),
        }
        for i, w in enumerate(example["workouts"])
    ]


def test_there_are_examples_to_check():
    assert EXAMPLES


@pytest.mark.parametrize("example", EXAMPLES, ids=[e["name"] for e in EXAMPLES])
def test_todays_target_matches_the_shared_example(example):
    today = MONDAY + timedelta(days=example["today"])
    numbers = today_numbers(example["weekly_goal"], example["plan"], workouts_of(example), today)
    assert numbers["target_met_hours"] == pytest.approx(example["today_target"], abs=0.0005), (
        f"shared_examples/today_target.json says {example['today_target']}. {example['how']}"
    )
