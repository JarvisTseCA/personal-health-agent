"""
Talks to the Google Health API, which replaced the Fitbit Web API on Nov 2, 2026.

    consent_url    → Google's sign-in and consent page (standard Google OAuth, offline access)
    exchange_code  → tokens for the code Google sends back to the callback
    check_linked   → users.getIdentity, which fails when no Fitbit account is linked
    fetch_data     → exercise and vo2-max data points since a date, every page

Setup is in docs/architecture.md ("Real Fitbit data"). The client id and secret
live in backend/.env, never in the frontend. In the console's Testing mode,
refresh tokens last 7 days, so expect to reconnect about once a week.
API reference: https://developers.google.com/health/reference/rest
"""
import os
import time
from datetime import date
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx

from .fitbit_data import parse_vo2, parse_workout

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_URL = "https://health.googleapis.com/v4/users/me"
# Exercise sessions and VO2 max are both "activity and fitness" data.
SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"
DEFAULT_REDIRECT_URI = "http://localhost:8000/api/fitbit/callback"
PAGE_SIZE = 25  # the most the exercise list allows per page
TIMEOUT_S = 20.0
# Refresh a little early so a token doesn't expire between our check and Google's.
EXPIRY_MARGIN_S = 60


class GoogleHealthError(Exception):
    """A call to Google failed. `status` is the HTTP status our API answers with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def has_credentials() -> bool:
    return bool(os.environ.get("GOOGLE_HEALTH_CLIENT_ID") and os.environ.get("GOOGLE_HEALTH_CLIENT_SECRET"))


def redirect_uri() -> str:
    return os.environ.get("GOOGLE_HEALTH_REDIRECT_URI", DEFAULT_REDIRECT_URI)


def http_client() -> httpx.Client:
    """Every request to Google goes through this client, so tests can swap in a fake transport."""
    return httpx.Client(timeout=TIMEOUT_S)


def consent_url(state: str) -> str:
    """Where the Connect button sends the user. `state` comes back to the callback unchanged."""
    return AUTH_URL + "?" + urlencode({
        "client_id": os.environ["GOOGLE_HEALTH_CLIENT_ID"],
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",  # a refresh token, so syncs work after the hour-long access token expires
        "prompt": "consent",  # Google only sends a refresh token when the user sees the consent page
        "state": state,
    })


def _tokens(res: Dict[str, Any], refresh_token: Optional[str] = None) -> Dict[str, Any]:
    """The token fields we store. A refresh response has no new refresh token, so the old one is kept."""
    return {
        "access_token": res["access_token"],
        "refresh_token": res.get("refresh_token", refresh_token),
        "expires_at": time.time() + float(res.get("expires_in", 3600)),
        "scope": res.get("scope", ""),
    }


def _post_token(form: Dict[str, str]) -> Dict[str, Any]:
    with http_client() as client:
        try:
            res = client.post(TOKEN_URL, data=form)
        except httpx.HTTPError as e:
            raise GoogleHealthError(f"Could not reach Google: {e}") from e
    if res.status_code != 200:
        # invalid_grant: the refresh token expired (7 days in Testing mode) or the user removed access.
        status = 401 if "invalid_grant" in res.text else 502
        raise GoogleHealthError(f"Google's token endpoint returned {res.status_code}: {res.text[:300]}", status)
    return res.json()


def exchange_code(code: str) -> Dict[str, Any]:
    """Swap the code from the callback for an access token and a refresh token."""
    res = _post_token({
        "code": code,
        "client_id": os.environ["GOOGLE_HEALTH_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_HEALTH_CLIENT_SECRET"],
        "redirect_uri": redirect_uri(),
        "grant_type": "authorization_code",
    })
    return _tokens(res)


def fresh_tokens(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """The same tokens while the access token is still good, otherwise refreshed ones."""
    if tokens["expires_at"] - EXPIRY_MARGIN_S > time.time():
        return tokens
    if not tokens.get("refresh_token"):
        raise GoogleHealthError("No refresh token saved; reconnect Fitbit", 401)
    res = _post_token({
        "refresh_token": tokens["refresh_token"],
        "client_id": os.environ["GOOGLE_HEALTH_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_HEALTH_CLIENT_SECRET"],
        "grant_type": "refresh_token",
    })
    return _tokens(res, tokens["refresh_token"])


def _get(access_token: str, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with http_client() as client:
        try:
            res = client.get(f"{API_URL}/{path}", params=params, headers={"Authorization": f"Bearer {access_token}"})
        except httpx.HTTPError as e:
            raise GoogleHealthError(f"Could not reach the Google Health API: {e}") from e
    if res.status_code == 401:
        raise GoogleHealthError("Google rejected the access token; reconnect Fitbit", 401)
    if res.status_code != 200:
        raise GoogleHealthError(f"Google Health API returned {res.status_code} for {path}: {res.text[:300]}")
    return res.json()


def check_linked(access_token: str) -> None:
    """Raise unless the Google account has Fitbit data linked to it."""
    try:
        _get(access_token, "identity")
    except GoogleHealthError as e:
        if "ACCOUNT_NOT_LINKED" in str(e):
            raise GoogleHealthError("This Google account has no Fitbit account linked to it", 409) from e
        raise


def list_points(access_token: str, data_type: str, filter_: str) -> List[Dict[str, Any]]:
    """Every data point of one type that matches the filter, following nextPageToken."""
    points: List[Dict[str, Any]] = []
    page_token = None
    while True:
        params: Dict[str, Any] = {"filter": filter_, "pageSize": PAGE_SIZE}
        if page_token:
            params["pageToken"] = page_token
        page = _get(access_token, f"dataTypes/{data_type}/dataPoints", params)
        points += page.get("dataPoints", [])
        page_token = page.get("nextPageToken")
        if not page_token:
            return points


def fetch_data(access_token: str, since: date) -> Dict[str, List[Dict[str, Any]]]:
    """Workouts and VO2 max readings from `since` (the user's own calendar date) to now."""
    day = since.isoformat()
    # Civil time is the user's own clock. The exercise filter is from Google's docs; the vo2-max one
    # follows the documented pattern for sample data types.
    exercise = list_points(access_token, "exercise", f'exercise.interval.civil_start_time >= "{day}"')
    vo2 = list_points(access_token, "vo2-max", f'vo2_max.sample_time.civil_time >= "{day}"')
    return {"workouts": [parse_workout(p) for p in exercise], "vo2": [parse_vo2(p) for p in vo2]}
