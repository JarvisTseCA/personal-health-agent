"""POST /api/suggest/table: a suggestion whose options come from the activity table.

Filter the table → Jev: which heading → Jev: which activity in each of the top
headings → Jev: how long.
"""
import pytest
from fastapi.testclient import TestClient

from app import activities, main
from app.jev import mock_heading, mock_table_activities
from app.prompt import (
    build_heading_request, build_table_activity_request, build_table_duration_request, build_table_state,
    group_by_heading, heading_key,
)
from app.schemas import TableSuggestRequest
from app.suggest import AnswerError, pick_from_table, rank_headings

HEADER = (
    "major_heading,activity_code,met_value,activity_description,intensity_high,intensity_low,"
    "loc_gym,at_home,loc_outside,needs_equipment,need_friends,exercise_rec"
)
# Lines as they are in the real CSV. At the gym, 3 MET and up, no partner, this leaves six
# activities in four headings: Bicycling 01216 01220 · Dancing 03031 · Running 12028 · Walking 17352 17358
TABLE = [
    'Bicycling,01003,14.0,"Bicycling, mountain, uphill, vigorous",1,0,0,0,1,1,0,1',  # outside only
    'Bicycling,01216,5.0,"Bicycling, stationary, 60 watts, light to moderate effort",0,1,1,0,0,1,0,1',
    'Bicycling,01220,6.0,"Bicycling, stationary, 90-100 watts, moderate to vigorous",1,0,1,0,0,1,0,1',
    'Dancing,03030,5.5,"Ballroom dancing, fast (Taylor Code 125)",0,0,1,0,0,0,1,1',  # needs a partner
    'Dancing,03031,9.8,"Nightclub or folk dancing, vigorous effort (e.g., nightclub, disco, folk, line dancing, Irish step dancing, polka, contra)",1,0,1,1,0,0,0,1',
    'Running,12028,6.5,"Running, 4 to 4.2 mph (13 min/mile)",0,1,1,1,1,0,0,1',
    'Walking,17085,2.5,"Bird watching, walking and stopping",0,1,1,1,1,0,0,1',  # under 3 MET
    'Walking,17352,3.5,"Walking, treadmill, 2.5 to 2.9 mph (4.0 to 4.7 km/h), 0% grade",0,1,1,0,0,1,0,1',
    'Walking,17358,4.8,"Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade",0,1,1,0,0,1,0,1',
    'Sports,15142,8.0,"Coaching, actively playing sport with players",0,0,1,0,0,0,0,0',  # not recommended
]

# At the gym with 45 minutes, having picked a stationary bike and a treadmill walk before.
REQ = {
    "weekly_goal_met_hours": 7.5,
    "done_this_week_met_hours": 3.06,
    "left_this_week_met_hours": 4.44,
    "day_name": "Wednesday",
    "check_in": {"minutes": 45, "place": "gym", "energy": "normal", "mood": "surprise"},
    "needed_met_hours": 1.4,
    "equipment_here": ["Treadmill", "Stationary bike"],
    "picked_codes": ["01216", "17358"],
    "durations": [10, 15, 20, 25, 30, 40, 45],
    "recent": [{"family_id": "cycling", "name": "Cycling", "days_ago": 1}],
}


def choice(probs):
    top = max(probs, key=probs.get)
    return {"type": "choice", "choice": top, "confidence": probs[top], "probabilities": probs}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A backend with its own database, the small table above, and no API key (so Jev is mocked)."""
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    csv_path = tmp_path / "activities.csv"
    csv_path.write_text("\n".join([HEADER, *TABLE]) + "\n", encoding="utf-8")
    activities.load(csv_path)
    return TestClient(main.app)


def post(client, **changes):
    return client.post("/api/suggest/table", json={**REQ, **changes})


def picks(data):
    return [(p["activity_code"], p["major_heading"]) for p in [data["lead"], *data["backups"]]]


def gym_candidates(**filters):
    return group_by_heading(activities.candidates("gym", min_met=3, **filters))


# ---- the three prompts ----


def test_state_lists_the_kinds_picked_before(client):
    state = build_table_state(TableSuggestRequest(**REQ), ["Bicycling", "Walking"])

    assert state["kinds_of_activity_picked_before"] == ["Bicycling", "Walking"]
    assert "favorites_in_order" not in state  # this route gets no list of favorites
    assert (state["where"], state["time_available_min"], state["energy"]) == ("at the gym", 45, "normal")
    assert state["recently_done"] == ["Cycling, yesterday"]


def test_heading_prompt_has_one_option_per_heading(client):
    by_heading = gym_candidates()
    body = build_heading_request({"where": "at the gym"}, by_heading, ["Walking"], "jev-latest")

    q = body["questions"]["heading"]
    assert list(q["criteria"]) == ["bicycling", "dancing", "running", "walking"]
    assert q["criteria"]["bicycling"] == (
        "Bicycling. 2 activities fit today, 5 to 6 MET. For example: "
        "Bicycling, stationary, 60 watts, light to moderate effort; "
        "Bicycling, stationary, 90-100 watts, moderate to vigorous."
    )
    assert q["criteria"]["walking"].endswith("Picked before (#1).")
    assert "Picked before" not in q["criteria"]["dancing"]
    assert body["state"] == {"where": "at the gym"} and body["model"] == "jev-latest"


def test_a_heading_with_spaces_gets_a_plain_option_name():
    assert heading_key("Water Activities") == "water_activities"
    assert heading_key("Lawn & Garden") == "lawn_garden"


def test_activity_prompt_asks_once_per_heading_with_codes_as_options(client):
    by_heading = gym_candidates(headings=["Bicycling", "Walking"])
    body = build_table_activity_request({}, by_heading, "jev-latest")

    assert list(body["questions"]) == ["activity_in_bicycling", "activity_in_walking"]
    bike = body["questions"]["activity_in_bicycling"]
    assert bike["criteria"] == {
        "01216": "Bicycling, stationary, 60 watts, light to moderate effort (5 MET)",
        "01220": "Bicycling, stationary, 90-100 watts, moderate to vigorous (6 MET)",
    }
    assert bike["instructions"].startswith("Pick the one Bicycling activity")
    assert list(body["questions"]["activity_in_walking"]["criteria"]) == ["17352", "17358"]


def test_duration_prompt_asks_once_per_picked_activity(client):
    req = TableSuggestRequest(**REQ)
    bike, walk = activities.candidates("gym", headings=["Bicycling"])[0], activities.candidates("gym", min_met=4)[-1]
    body = build_table_duration_request(req, {}, [bike, walk], "jev-latest")

    assert list(body["questions"]) == ["duration_01216", "duration_17358"]
    q = body["questions"]["duration_01216"]
    assert list(q["criteria"]) == ["10", "15", "20", "25", "30", "40", "45"]
    assert "Bicycling, stationary, 60 watts, light to moderate effort? It is 5 MET, so 1 MET-hour takes about 12 minutes" in q["instructions"]
    assert "challenge" not in q["instructions"]


def test_duration_prompt_on_a_challenge_names_the_aim(client):
    req = TableSuggestRequest(**{**REQ, "boost": True, "target_met_hours": 1.4})
    body = build_table_duration_request(req, {}, activities.candidates("gym", headings=["Bicycling"])[:1], "jev-latest")

    assert "up for a challenge: aim for about 2.1 MET-hours" in body["questions"]["duration_01216"]["instructions"]


# ---- from Jev's answers to the pick and the backups ----


def test_headings_are_ranked_by_jevs_probability():
    answers = {"heading": choice({"walking": 0.5, "bicycling": 0.3, "dancing": 0.2})}

    assert rank_headings(answers, ["Bicycling", "Dancing", "Walking"]) == [("Walking", 0.5), ("Bicycling", 0.3), ("Dancing", 0.2)]


def test_a_heading_we_did_not_offer_is_rejected():
    with pytest.raises(AnswerError, match="None of Jev's 'heading' options match"):
        rank_headings({"heading": choice({"swimming": 1.0})}, ["Bicycling", "Walking"])


def test_the_pick_and_the_backups_come_from_different_headings(client):
    by_heading = gym_candidates()
    ranked = [("Walking", 0.5), ("Bicycling", 0.3), ("Running", 0.2)]
    answers = {
        "activity_in_walking": choice({"17352": 0.2, "17358": 0.8}),
        "activity_in_bicycling": choice({"01216": 0.6, "01220": 0.4}),
        "activity_in_running": choice({"12028": 1.0}),
    }

    picked = pick_from_table(ranked, answers, by_heading)

    assert [(row["activity_code"], heading_p, activity_p) for row, heading_p, activity_p in picked] == [
        ("17358", 0.5, 0.8), ("01216", 0.3, 0.6), ("12028", 0.2, 1.0),
    ]


def test_with_two_headings_the_last_backup_is_the_top_headings_second_best(client):
    by_heading = gym_candidates(headings=["Bicycling", "Walking"])
    answers = {
        "activity_in_walking": choice({"17352": 0.2, "17358": 0.8}),
        "activity_in_bicycling": choice({"01216": 0.6, "01220": 0.4}),
    }

    picked = pick_from_table([("Walking", 0.7), ("Bicycling", 0.3)], answers, by_heading)

    assert [row["activity_code"] for row, _, _ in picked] == ["17358", "01216", "17352"]


def test_an_activity_answer_for_codes_we_did_not_send_is_rejected(client):
    by_heading = gym_candidates(headings=["Bicycling"])

    with pytest.raises(AnswerError, match="None of Jev's 'activity_in_bicycling' options match"):
        pick_from_table([("Bicycling", 1.0)], {"activity_in_bicycling": choice({"99999": 1.0})}, by_heading)


def test_mock_jev_prefers_what_was_picked_before_and_a_pace_that_suits_the_energy(client):
    by_heading = gym_candidates()
    heading = mock_heading(by_heading, ["Walking", "Bicycling"])["heading"]
    low = mock_table_activities(TableSuggestRequest(**{**REQ, "check_in": {**REQ["check_in"], "energy": "low"}}), by_heading)
    hard = mock_table_activities(TableSuggestRequest(**{**REQ, "check_in": {**REQ["check_in"], "energy": "challenge"}}), by_heading)

    assert heading["choice"] == "walking"
    assert heading["probabilities"]["bicycling"] > heading["probabilities"]["dancing"]
    assert low["activity_in_walking"]["choice"] == "17352"  # 3.5 MET
    assert hard["activity_in_bicycling"]["choice"] == "01220"  # 6 MET


# ---- the route, end to end ----


def test_table_suggest_with_mock_end_to_end(client):
    res = post(client)

    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "mock"
    # Picked before: Bicycling and Walking, so only those two headings are candidates (2 + 2).
    assert data["candidate_count"] == 4
    assert picks(data) == [("01216", "Bicycling"), ("17358", "Walking"), ("01220", "Bicycling")]
    assert data["lead"] == {
        "activity_code": "01216",
        "major_heading": "Bicycling",
        "activity_description": "Bicycling, stationary, 60 watts, light to moderate effort",
        "met_value": 5.0,
        "duration_min": 15,  # 1.4 MET-hours at 5 MET is about 17 minutes
        "heading_probability": data["jev_answers"]["heading"]["heading"]["probabilities"]["bicycling"],
        "probability": data["jev_answers"]["activity"]["activity_in_bicycling"]["probabilities"]["01216"],
        "reasons": ["A kind of activity you picked before", "Fits in 45 min"],
    }
    assert list(data["jev_request"]) == ["heading", "activity", "duration"]
    log = client.get("/api/suggestions/log").json()["items"]
    assert log[0]["id"] == data["log_id"] and log[0]["error"] is None
    assert log[0]["result_json"][0]["activity_code"] == "01216"


def test_nothing_picked_before_means_every_heading_is_a_candidate(client):
    data = post(client, picked_codes=[]).json()

    assert data["candidate_count"] == 6
    assert len({heading for _, heading in picks(data)}) == 3  # the pick and both backups differ in kind
    assert data["lead"]["reasons"] == ["Fits in 45 min"]


def test_one_heading_skips_the_heading_question(client, caplog):
    with caplog.at_level("INFO", logger="pha"):
        data = post(client, picked_codes=["01216"]).json()

    assert list(data["jev_request"]) == ["activity", "duration"]
    assert picks(data) == [("01216", "Bicycling"), ("01220", "Bicycling")]  # only two candidates, so one backup
    assert data["lead"]["heading_probability"] == 1.0
    assert "Only one heading fits today (Bicycling), so Jev #1 is skipped" in caplog.text


def test_excluded_headings_are_left_out(client):
    """After "Did this recently" on a bike pick."""
    data = post(client, exclude_headings=["Bicycling"]).json()

    assert picks(data) == [("17358", "Walking"), ("17352", "Walking")]


def test_met_limits_reach_the_filter(client):
    assert post(client, limits={"no_vigorous": True}).json()["candidate_count"] == 3  # 01220 (6 MET) is out
    assert picks(post(client, below_met=4).json()) == [("17352", "Walking")]  # only the 3.5 MET walk is left
    assert post(client, limits={"no_vigorous": True}, below_met=8).json()["candidate_count"] == 3  # the lower limit wins
    # Light activity is left out unless the app says it counts: the 2.5 MET row shows up with min_met off.
    assert post(client, picked_codes=["17358"]).json()["candidate_count"] == 2
    assert post(client, picked_codes=["17358"], min_met=None).json()["candidate_count"] == 3


def test_nothing_in_the_table_fits(client):
    office = post(client, check_in={**REQ["check_in"], "place": "office"})
    no_time = post(client, durations=[])

    assert office.status_code == 422 and no_time.status_code == 422
    assert "No activity in the table fits today" in office.json()["detail"]


def test_table_suggest_prints_each_step_in_the_terminal(client, caplog):
    with caplog.at_level("INFO", logger="pha"):
        log_id = post(client).json()["log_id"]

    text = caplog.text
    for step in [
        "POST /api/suggest/table",
        "[1] Check-in: 45 min · gym",
        "picked before: Bicycling, Walking",
        "4 candidates in the table: Bicycling 2 · Walking 2",
        "[2] Ask Jev #1 (which heading)",
        "[3] Ask Jev #2 (which activity in each heading)",
        "[4] Ask Jev #3 (how long)",
        "[5] Sent to app: lead 01216",
    ]:
        assert step in text
    assert f"Saved as suggestion_log #{log_id}" in text
    assert "Prompt #1" not in text  # the full JSON only shows at DEBUG


def test_table_suggest_with_live_jev(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    calls = []

    def fake_call(body):
        calls.append(body)
        questions = body["questions"]
        if "heading" in questions:
            return {"heading": choice({"walking": 0.6, "bicycling": 0.4})}, "jev-1.14.0"
        if "activity_in_walking" in questions:
            return {
                "activity_in_walking": choice({"17352": 0.7, "17358": 0.3}),
                "activity_in_bicycling": choice({"01216": 0.1, "01220": 0.9}),
            }, "jev-1.14.0"
        return {q: choice({"10": 0.1, "20": 0.2, "30": 0.7}) for q in questions}, "jev-1.14.0"

    monkeypatch.setattr(main, "call_jev", fake_call)
    data = post(client).json()

    assert len(calls) == 3
    assert calls[0]["model"] == "jev-latest"
    assert list(calls[0]["questions"]) == ["heading"]
    assert list(calls[1]["questions"]) == ["activity_in_walking", "activity_in_bicycling"]  # Jev's order
    assert list(calls[2]["questions"]) == ["duration_17352", "duration_01220", "duration_17358"]
    assert calls[0]["state"] == calls[1]["state"] == calls[2]["state"]
    assert data["source"] == "jev" and data["model"] == "jev-1.14.0"
    lead = data["lead"]
    assert (lead["activity_code"], lead["heading_probability"], lead["probability"], lead["duration_min"]) == ("17352", 0.6, 0.7, 30)
    assert picks(data)[1:] == [("01220", "Bicycling"), ("17358", "Walking")]


def test_jev_error_is_logged_and_returns_502(client, monkeypatch, caplog):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")

    def fails_on_the_second_call(body):
        if "heading" in body["questions"]:
            return {"heading": choice({"walking": 0.6, "bicycling": 0.4})}, "jev-1.14.0"
        raise main.JevError("Jev returned 401: bad key")

    monkeypatch.setattr(main, "call_jev", fails_on_the_second_call)
    with caplog.at_level("INFO", logger="pha"):
        res = post(client)

    assert res.status_code == 502
    assert "✗ Failed: Jev returned 401: bad key" in caplog.text
    logged = client.get("/api/suggestions/log").json()["items"][0]
    assert logged["error"] == "Jev returned 401: bad key"
    assert list(logged["jev_request"]) == ["heading", "activity"]  # how far it got


# ---- on the CSV in the repo ----


@pytest.fixture
def real_table(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "real.db"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    activities.load()
    return TestClient(main.app)


def test_no_heading_is_too_big_for_one_jev_question(real_table):
    """Call 2 puts a whole heading into one question, and a question takes 255 options at most."""
    for place in activities.PLACE_COLUMN:
        sizes = {h: len(rows) for h, rows in group_by_heading(activities.candidates(place)).items()}
        assert sizes and max(sizes.values()) <= 255, (place, sizes)


def test_the_gym_example_on_the_csv_in_the_repo(real_table):
    """Picked before: a stationary bike, ballroom dancing and a treadmill walk."""
    res = real_table.post("/api/suggest/table", json={**REQ, "picked_codes": ["01216", "03030", "17358"]})

    assert res.status_code == 200
    data = res.json()
    assert sorted(heading for _, heading in picks(data)) == ["Bicycling", "Dancing", "Walking"]
    for p in [data["lead"], *data["backups"]]:
        assert len(p["activity_code"]) == 5 and p["met_value"] >= 3 and p["duration_min"] in REQ["durations"]
    assert list(data["jev_request"]["activity"]["questions"]) == [
        "activity_in_bicycling", "activity_in_dancing", "activity_in_walking",
    ]
