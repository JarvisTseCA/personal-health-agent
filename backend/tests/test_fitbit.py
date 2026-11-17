from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db, main
from app import google_health as gh
from app.fitbit_data import parse_vo2, parse_workout, seconds


def exercise_point(n=1, start="2026-11-16T23:10:00Z", offset="-18000s", minutes=30, kind="RUNNING", **summary):
    """An exercise data point shaped like the Google Health API's."""
    return {
        "name": f"users/111/dataTypes/exercise/dataPoints/{n}",
        "exercise": {
            "interval": {"startTime": start, "startUtcOffset": offset, "endTime": "2026-11-16T23:45:00Z", "endUtcOffset": offset},
            "exerciseType": kind,
            "displayName": kind.title(),
            "activeDuration": f"{minutes * 60}s",
            "metricsSummary": summary,
        },
    }


def vo2_point(when="2026-11-03T12:00:00Z", value=41.6):
    return {"name": "users/111/dataTypes/vo2-max/dataPoints/9",
            "vo2Max": {"sampleTime": {"physicalTime": when, "utcOffset": "-18000s"}, "vo2Max": value, "measurementMethod": "FITBIT_RUN"}}


class FakeGoogle:
    """Answers like Google's token endpoint and the Health API. `pages` is a list of exercise pages."""

    def __init__(self, pages=None, vo2=None, linked=True, refresh_ok=True):
        self.pages = pages or [[]]
        self.vo2 = vo2 or []
        self.linked = linked
        self.refresh_ok = refresh_ok
        self.filters = []

    def handle(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith(gh.TOKEN_URL):
            form = parse_qs(req.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                if not self.refresh_ok:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(200, json={"access_token": "new-access", "expires_in": 3599, "scope": gh.SCOPE})
            return httpx.Response(200, json={"access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3599, "scope": gh.SCOPE})
        if req.headers.get("Authorization") not in ("Bearer access-1", "Bearer new-access"):
            return httpx.Response(401, json={"error": {"status": "UNAUTHENTICATED"}})
        if url.startswith(f"{gh.API_URL}/identity"):
            if not self.linked:
                return httpx.Response(400, json={"error": {"status": "FAILED_PRECONDITION", "details": [{"reason": "ACCOUNT_NOT_LINKED"}]}})
            return httpx.Response(200, json={"name": "users/me/identity", "healthUserId": "111"})
        self.filters.append(req.url.params["filter"])
        if "/dataTypes/vo2-max/" in url:
            return httpx.Response(200, json={"dataPoints": self.vo2})
        i = int(req.url.params.get("pageToken", "0"))
        body = {"dataPoints": self.pages[i]}
        if i + 1 < len(self.pages):
            body["nextPageToken"] = str(i + 1)
        return httpx.Response(200, json=body)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "client-secret")
    monkeypatch.delenv("GOOGLE_HEALTH_REDIRECT_URI", raising=False)
    return TestClient(main.app)


def use(monkeypatch, google: FakeGoogle) -> FakeGoogle:
    monkeypatch.setattr(gh, "http_client", lambda: httpx.Client(transport=httpx.MockTransport(google.handle)))
    return google


def connect(client, monkeypatch, google: FakeGoogle):
    use(monkeypatch, google)
    client.cookies.set(main.OAUTH_COOKIE, "demo|state-1")
    return client.get("/api/fitbit/callback", params={"code": "code-1", "state": "state-1"})


# --- Parsing ------------------------------------------------------------------


def test_workout_uses_the_users_clock_and_active_minutes():
    point = exercise_point(averageHeartRateBeatsPerMinute="142",
                           heartRateZoneDurations={"moderateTime": "600s", "vigorousTime": "930s"})
    assert parse_workout(point) == {
        "id": "users/111/dataTypes/exercise/dataPoints/1",
        "exercise_type": "RUNNING",
        "name": "Running",
        "start": "2026-11-16T18:10:00",
        "duration_min": 30,
        "avg_heart_rate": 142,
        "zone_min": {"light": 0.0, "moderate": 10.0, "vigorous": 15.5, "peak": 0.0},
    }


def test_workout_without_active_duration_or_heart_rate_uses_the_interval():
    point = exercise_point(start="2026-11-16T23:10:00.123456789Z")
    del point["exercise"]["activeDuration"]
    row = parse_workout(point)
    assert (row["duration_min"], row["avg_heart_rate"], row["start"]) == (35, None, "2026-11-16T18:10:00")


def test_vo2_reading_is_dated_on_the_users_clock():
    assert parse_vo2(vo2_point("2026-11-01T02:00:00Z")) == {"date": "2026-10-31", "vo2_max": 41.6, "method": "FITBIT_RUN"}


def test_seconds_rejects_a_value_that_is_not_a_duration():
    with pytest.raises(ValueError, match="Not a duration"):
        seconds("30m")


# --- Connecting ---------------------------------------------------------------


def test_status_without_credentials_says_not_configured(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_HEALTH_CLIENT_ID")
    assert client.get("/api/fitbit/status").json() == {"configured": False, "connected": False}
    assert client.get("/api/fitbit/connect", follow_redirects=False).status_code == 503


def test_connect_sends_the_user_to_google_for_offline_access(client):
    res = client.get("/api/fitbit/connect", follow_redirects=False)
    url = urlparse(res.headers["location"])
    q = parse_qs(url.query)
    assert f"{url.scheme}://{url.netloc}{url.path}" == gh.AUTH_URL
    assert (q["scope"], q["access_type"], q["redirect_uri"]) == ([gh.SCOPE], ["offline"], [gh.DEFAULT_REDIRECT_URI])
    assert res.cookies[main.OAUTH_COOKIE] == f"demo|{q['state'][0]}"


def test_callback_saves_tokens_and_status_says_connected(client, monkeypatch):
    res = connect(client, monkeypatch, FakeGoogle())
    assert "Your Fitbit is connected." in res.text
    assert client.get("/api/fitbit/status").json() == {"configured": True, "connected": True}


def test_callback_with_a_different_state_is_refused(client, monkeypatch):
    use(monkeypatch, FakeGoogle())
    client.cookies.set(main.OAUTH_COOKIE, "demo|state-1")
    res = client.get("/api/fitbit/callback", params={"code": "code-1", "state": "someone-elses"})
    assert res.status_code == 400
    assert client.get("/api/fitbit/status").json()["connected"] is False


def test_callback_for_an_account_without_fitbit_does_not_connect(client, monkeypatch):
    res = connect(client, monkeypatch, FakeGoogle(linked=False))
    assert "no Fitbit account linked" in res.text
    assert client.get("/api/fitbit/status").json()["connected"] is False


def test_disconnect_forgets_the_tokens(client, monkeypatch):
    connect(client, monkeypatch, FakeGoogle())
    client.delete("/api/fitbit")
    assert client.get("/api/fitbit/status").json()["connected"] is False


# --- Syncing ------------------------------------------------------------------


def test_sync_without_connecting_is_refused(client):
    assert client.get("/api/fitbit/sync", params={"since": "2026-06-01"}).status_code == 401


def test_sync_returns_every_page_of_workouts_and_the_vo2_readings(client, monkeypatch):
    google = FakeGoogle(pages=[[exercise_point(1)], [exercise_point(2, kind="WALKING")]], vo2=[vo2_point()])
    connect(client, monkeypatch, google)
    data = client.get("/api/fitbit/sync", params={"since": "2026-06-01"}).json()
    assert [(w["id"][-1], w["exercise_type"]) for w in data["workouts"]] == [("1", "RUNNING"), ("2", "WALKING")]
    assert data["vo2"] == [{"date": "2026-11-03", "vo2_max": 41.6, "method": "FITBIT_RUN"}]
    assert google.filters == [
        'exercise.interval.civil_start_time >= "2026-06-01"',
        'exercise.interval.civil_start_time >= "2026-06-01"',
        'vo2_max.sample_time.civil_time >= "2026-06-01"',
    ]


def test_sync_refreshes_an_expired_access_token(client, monkeypatch):
    connect(client, monkeypatch, FakeGoogle(pages=[[exercise_point()]]))
    db.save_fitbit_tokens("demo", {**db.load_fitbit_tokens("demo"), "expires_at": 0})
    res = client.get("/api/fitbit/sync", params={"since": "2026-06-01"})
    assert len(res.json()["workouts"]) == 1
    assert db.load_fitbit_tokens("demo")["access_token"] == "new-access"
    assert db.load_fitbit_tokens("demo")["refresh_token"] == "refresh-1"


def test_sync_with_an_expired_refresh_token_asks_to_reconnect(client, monkeypatch):
    connect(client, monkeypatch, FakeGoogle(refresh_ok=False))
    db.save_fitbit_tokens("demo", {**db.load_fitbit_tokens("demo"), "expires_at": 0})
    assert client.get("/api/fitbit/sync", params={"since": "2026-06-01"}).status_code == 401
    assert client.get("/api/fitbit/status").json()["connected"] is False
