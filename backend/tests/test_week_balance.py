"""Balance across the week, and now and then a category the user hasn't tried (suggest.py, the table route)."""
import pytest
from fastapi.testclient import TestClient

from app import activities, main
from app.schemas import TableSuggestRequest
from app.suggest import EXPLORE_CHANCE, balance_week, explore_today, lopsided, week_types, with_new_category

REQ = {
    "weekly_goal_met_hours": 7.5,
    "done_this_week_met_hours": 3.06,
    "left_this_week_met_hours": 4.44,
    "day_name": "Wednesday",
    "check_in": {"minutes": 45, "place": "gym", "energy": "normal", "mood": "surprise"},
    "needed_met_hours": 1.4,
    "picked_codes": ["01216", "17358"],
    "durations": [10, 15, 20, 25, 30, 40, 45],
}
# Three stationary-bike rides this week (cardio), on Monday, Tuesday and today.
CARDIO_WEEK = [{"family_id": "cycling", "name": "Cycling", "days_ago": d, "code": "01216"} for d in (2, 1, 0)]


def row(code, kind):
    return {"activity_code": code, "type": kind}


@pytest.fixture
def real_table(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "real.db"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    activities.load()
    return TestClient(main.app)


# --- Balance across the week ------------------------------------------------------------------


def test_a_week_is_lopsided_from_three_of_one_kind_and_three_in_four():
    assert lopsided({"cardio": 3}) == "cardio"
    assert lopsided({"cardio": 3, "strength": 1}) == "cardio"
    assert lopsided({"cardio": 2}) is None  # too few to call it a pattern
    assert lopsided({"cardio": 3, "strength": 2}) is None  # already mixed
    assert lopsided({}) is None


def test_only_this_weeks_workouts_count():
    req = TableSuggestRequest(**REQ, recent=[*CARDIO_WEEK, {"family_id": "x", "name": "x", "days_ago": 5, "code": "01216"}])
    assert week_types(req, {"01216": "cardio"}) == {"cardio": 3}  # 5 days ago is last week from a Wednesday


def test_the_best_pick_of_another_kind_leads_and_the_rest_keep_their_order():
    picked = [(row("a", "cardio"), 0.5, 0.9), (row("b", "cardio"), 0.3, 0.9), (row("c", "strength"), 0.2, 0.9)]
    moved, did = balance_week(picked, "cardio")
    assert did and [r["activity_code"] for r, _, _ in moved] == ["c", "a", "b"]
    assert balance_week(picked, None) == (picked, False)
    assert balance_week(picked, "strength") == (picked, False)  # the lead isn't of the week's kind
    only = picked[:2]
    assert balance_week(only, "cardio") == (only, False)  # nothing of another kind: no change


def test_a_cardio_week_gets_a_lead_of_another_kind_that_says_why(real_table):
    data = real_table.post("/api/suggest/table", json={**REQ, "recent": CARDIO_WEEK, "explore": False}).json()
    lead_type = activities.types_by_code([data["lead"]["activity_code"]])[data["lead"]["activity_code"]]
    assert lead_type != "cardio"
    assert "A change from this week's cardio" in data["lead"]["reasons"]
    assert data["jev_request"]["heading"]["state"]["this_weeks_workouts_by_kind"] == {"cardio": 3}


def test_a_mixed_week_changes_nothing(real_table):
    plain = real_table.post("/api/suggest/table", json={**REQ, "explore": False}).json()
    assert not any(r.startswith("A change from") for r in plain["lead"]["reasons"])


# --- Now and then, something new ---------------------------------------------------------------


def test_the_new_category_goes_second_and_takes_the_last_place_when_needed():
    ranked = [("Walking", 0.4), ("Running", 0.2), ("Bicycling", 0.1), ("Dancing", 0.1), ("Sports", 0.1), ("Water", 0.1)]
    top, new = with_new_category(ranked, known=["Walking", "Running", "Bicycling", "Dancing", "Sports"])
    assert new == "Water"
    assert [h for h, _ in top] == ["Walking", "Water", "Running", "Bicycling", "Dancing"]
    top, new = with_new_category(ranked, known=["Walking"])
    assert new == "Running" and [h for h, _ in top][:2] == ["Walking", "Running"]
    assert with_new_category(ranked, known=[h for h, _ in ranked]) == (ranked[:5], None)


def test_about_one_check_in_in_five_explores_and_the_same_day_gives_the_same_answer():
    reqs = [TableSuggestRequest(**REQ, user_id=f"u{i}", date="2026-11-22") for i in range(1000)]
    share = sum(explore_today(r) for r in reqs) / len(reqs)
    assert abs(share - EXPLORE_CHANCE) < 0.05
    assert explore_today(reqs[7]) == explore_today(TableSuggestRequest(**REQ, user_id="u7", date="2026-11-22"))


def test_on_an_exploring_day_the_second_option_is_new_and_says_so(real_table):
    body = {**REQ, "liked_categories": ["Bicycling", "Walking", "Running", "Conditioning Exercise"], "explore": True}
    data = real_table.post("/api/suggest/table", json=body).json()
    second = data["backups"][0]
    known = {"Bicycling", "Walking", "Running", "Conditioning Exercise"}
    assert second["major_heading"] not in known
    assert f"Something new: you haven't tried {second['major_heading']} yet" in second["reasons"]
    assert real_table.post("/api/suggest/table", json={**body, "explore": False}).json()["backups"][0]["major_heading"] in known
