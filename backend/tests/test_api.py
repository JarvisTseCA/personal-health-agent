import pytest
from fastapi.testclient import TestClient

from app import main
from app.prompt import build_activity_request, build_duration_request
from app.schemas import SuggestRequest
from app.challenge import challenge_plan, minutes_for
from app.jev import mock_activity, mock_durations
from app.suggest import AnswerError, assemble, pick_activities

REQ = {
    "day_name": "Wednesday",
    "check_in": {"minutes": 60, "place": "home", "energy": "normal", "mood": "surprise"},
    "needed_met_hours": 2.0,
    "enjoyed": [
        {"family_id": "yoga", "name": "Yoga", "rank": 1, "access": "have"},
        {"family_id": "cycling", "name": "Cycling", "rank": 2, "access": "have"},
        {"family_id": "walking", "name": "Walking", "rank": 3, "access": "sometimes"},
    ],
    "options": [
        {"variant_id": "yoga-power", "family_id": "yoga", "family_name": "Yoga", "kind": "mind-body",
         "label": "Power yoga", "met": 4.0, "description": "Power yoga", "setting": "indoor"},
        {"variant_id": "cycling-easy", "family_id": "cycling", "family_name": "Cycling", "kind": "cardio",
         "label": "Easy pace", "met": 4.3, "description": "Bicycling at an easy pace", "setting": "outdoor"},
        {"variant_id": "cycling-steady", "family_id": "cycling", "family_name": "Cycling", "kind": "cardio",
         "label": "12–14 mph", "met": 8.0, "description": "Leisure bicycling", "setting": "outdoor"},
        {"variant_id": "walking-brisk", "family_id": "walking", "family_name": "Walking", "kind": "cardio",
         "label": "Brisk", "met": 4.8, "description": "Brisk walking", "setting": "outdoor"},
    ],
    "durations": [10, 20, 30, 45, 60],
    "recent": [{"family_id": "cycling", "days_ago": 1}],
    "declines": [{"family_id": "walking", "reason": "weather", "days_ago": 2}],
}


def choice(probs):
    top = max(probs, key=probs.get)
    return {"type": "choice", "choice": top, "confidence": probs[top], "probabilities": probs}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    return TestClient(main.app)


ACTIVITY_ANSWERS = {
    "activity": choice({"cycling-steady": 0.5, "cycling-easy": 0.3, "walking-brisk": 0.15, "yoga-power": 0.05}),
}


def test_activity_prompt_carries_the_check_in_variables():
    body = build_activity_request(SuggestRequest(**{**REQ, "check_in": {**REQ["check_in"], "minutes": 120}}), "jev-latest")
    assert body["model"] == "jev-latest"
    assert body["state"]["time_available_min"] == 120
    assert body["state"]["recently_done"] == ["Cycling, yesterday"]
    assert list(body["questions"]) == ["activity"]
    assert set(body["questions"]["activity"]["criteria"]) == {o["variant_id"] for o in REQ["options"]}


def test_duration_prompt_asks_once_per_picked_activity():
    req = SuggestRequest(**REQ)
    picked = pick_activities(req, ACTIVITY_ANSWERS)
    body = build_duration_request(req, picked, "jev-latest")
    assert list(body["questions"]) == ["duration_cycling_steady", "duration_yoga_power", "duration_walking_brisk"]
    q = body["questions"]["duration_cycling_steady"]
    assert "8.0 MET" in q["instructions"] and "about 8 minutes" in q["instructions"]
    assert set(q["criteria"]) == {"10", "20", "30", "45", "60"}


def test_pick_keeps_one_variant_per_activity_and_varies_backups():
    picked = pick_activities(SuggestRequest(**REQ), ACTIVITY_ANSWERS)
    assert [o.variant_id for o in picked] == ["cycling-steady", "yoga-power", "walking-brisk"]


def test_each_activity_gets_its_own_duration():
    req = SuggestRequest(**REQ)
    picked = pick_activities(req, ACTIVITY_ANSWERS)
    durations = {
        "duration_cycling_steady": choice({"10": 0.1, "20": 0.7, "30": 0.1, "45": 0.05, "60": 0.05}),
        "duration_yoga_power": choice({"10": 0.0, "20": 0.1, "30": 0.2, "45": 0.6, "60": 0.1}),
        "duration_walking_brisk": choice({"10": 0.0, "20": 0.1, "30": 0.7, "45": 0.1, "60": 0.1}),
    }
    picks = assemble(req, picked, ACTIVITY_ANSWERS, durations)
    assert [(p.variant_id, p.duration_min) for p in picks] == [("cycling-steady", 20), ("yoga-power", 45), ("walking-brisk", 30)]


def test_rejects_answers_for_options_we_did_not_send():
    with pytest.raises(AnswerError):
        pick_activities(SuggestRequest(**REQ), {"activity": choice({"swimming-laps": 1.0})})
    req = SuggestRequest(**REQ)
    picked = pick_activities(req, ACTIVITY_ANSWERS)
    with pytest.raises(AnswerError):
        assemble(req, picked, ACTIVITY_ANSWERS, {"duration_cycling_steady": choice({"90": 1.0})})


def test_suggest_with_mock_end_to_end(client):
    assert client.get("/api/health").json()["jev"] == "mock"
    res = client.post("/api/suggest", json=REQ)
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "mock"
    assert data["lead"]["duration_min"] in REQ["durations"]
    assert len(data["backups"]) == 2
    assert set(data["jev_request"]) == {"activity", "duration"}
    log = client.get("/api/suggestions/log").json()["items"]
    assert log[0]["id"] == data["log_id"] and log[0]["error"] is None


def test_suggest_with_live_jev(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    calls = []

    def fake_call(body):
        calls.append(body)
        if "activity" in body["questions"]:
            return {"activity": choice({"yoga-power": 0.7, "cycling-easy": 0.2, "cycling-steady": 0.05, "walking-brisk": 0.05})}, "jev-1.13.0"
        return {q: choice({"10": 0.05, "20": 0.1, "30": 0.15, "45": 0.1, "60": 0.6}) for q in body["questions"]}, "jev-1.13.0"

    monkeypatch.setattr(main, "call_jev", fake_call)
    data = client.post("/api/suggest", json=REQ).json()
    assert len(calls) == 2
    assert calls[0]["model"] == "jev-latest"
    assert list(calls[0]["questions"]) == ["activity"]
    assert len(calls[1]["questions"]) == 3
    assert data["source"] == "jev" and data["model"] == "jev-1.13.0"
    assert (data["lead"]["variant_id"], data["lead"]["duration_min"]) == ("yoga-power", 60)


def test_jev_error_is_logged_and_returns_502(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")

    def boom(body):
        raise main.JevError("Jev returned 401: bad key")

    monkeypatch.setattr(main, "call_jev", boom)
    res = client.post("/api/suggest", json=REQ)
    assert res.status_code == 502
    assert client.get("/api/suggestions/log").json()["items"][0]["error"] == "Jev returned 401: bad key"


def test_state_round_trip(client):
    assert client.get("/api/state").json() == {"state": None}
    client.put("/api/state", json={"version": 2, "goal": 7.5})
    assert client.get("/api/state").json() == {"state": {"version": 2, "goal": 7.5}}
    client.delete("/api/state")
    assert client.get("/api/state").json() == {"state": None}


CHALLENGE = {**REQ, "check_in": {**REQ["check_in"], "energy": "challenge"}, "boost": True, "target_met_hours": 2.0}


def test_challenge_uses_a_harder_pace_at_the_usual_length():
    req = SuggestRequest(**CHALLENGE)
    # Easy cycling (4.3 MET) needs 30 min for 2.0 MET-hours; the challenge aims for 3.0.
    pace, minutes = challenge_plan(req, "cycling")
    assert (pace.variant_id, minutes) == ("cycling-steady", 30)
    assert pace.met * minutes / 60 >= 3.0


def test_challenge_goes_longer_only_without_a_harder_pace():
    req = SuggestRequest(**CHALLENGE)
    brisk = next(o for o in req.options if o.variant_id == "walking-brisk")
    assert minutes_for(req, brisk) == 45  # brisk is walking's only pace here: 30 min falls short of 3.0


def test_mock_jev_follows_the_challenge_rule():
    req = SuggestRequest(**CHALLENGE)
    probs = mock_activity(req)["activity"]["probabilities"]
    assert probs["cycling-steady"] > probs["cycling-easy"]
    steady = next(o for o in req.options if o.variant_id == "cycling-steady")
    assert mock_durations(req, [steady])["duration_cycling_steady"]["choice"] == "30"


def test_challenge_prompt_names_the_usual_length():
    req = SuggestRequest(**CHALLENGE)
    body = build_duration_request(req, pick_activities(req, ACTIVITY_ANSWERS), "jev-latest")
    assert "usual session today is 30 minutes" in body["questions"]["duration_cycling_steady"]["instructions"]
    assert build_activity_request(req, "jev-latest")["state"]["challenge_aim_met_hours"] == 3.0
