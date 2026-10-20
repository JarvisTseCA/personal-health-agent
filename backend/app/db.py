"""
SQLite storage. Two tables for now:

- app_state: the whole app state as one JSON document per user, the same
  thing the frontend used to keep in localStorage. We'll split it into proper
  tables once the team settles the schema (docs/architecture.md has a draft).
- suggestion_log: every prompt sent to Jev and what came back, so the team can
  review real answers when tuning the prompt.
"""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "pha.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS app_state (
    user_id    TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestion_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    source       TEXT NOT NULL,          -- jev | mock
    model        TEXT NOT NULL,
    request_json TEXT NOT NULL,          -- what the frontend sent
    jev_request  TEXT NOT NULL,          -- the prompt: state + questions
    jev_answers  TEXT,                   -- Jev's answers (null on error)
    result_json  TEXT,                   -- the pick + backups we returned
    error        TEXT
);
"""


def db_path() -> Path:
    return Path(os.environ.get("PHA_DB_PATH", DEFAULT_PATH))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    """A connection that commits on success and is always closed."""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_state(user_id: str) -> Optional[Dict[str, Any]]:
    with session() as conn:
        row = conn.execute("SELECT state_json FROM app_state WHERE user_id = ?", (user_id,)).fetchone()
    return json.loads(row["state_json"]) if row else None


def save_state(user_id: str, state: Dict[str, Any]) -> None:
    with session() as conn:
        conn.execute(
            "INSERT INTO app_state (user_id, state_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
            (user_id, json.dumps(state), _now()),
        )


def clear_state(user_id: str) -> None:
    with session() as conn:
        conn.execute("DELETE FROM app_state WHERE user_id = ?", (user_id,))


def log_suggestion(
    *,
    user_id: str,
    source: str,
    model: str,
    request: Dict[str, Any],
    jev_request: Dict[str, Any],
    jev_answers: Optional[Dict[str, Any]],
    result: Optional[Any],
    error: Optional[str],
) -> int:
    with session() as conn:
        cur = conn.execute(
            "INSERT INTO suggestion_log (user_id, created_at, source, model, request_json, jev_request, jev_answers, result_json, error) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id, _now(), source, model, json.dumps(request), json.dumps(jev_request),
                json.dumps(jev_answers) if jev_answers is not None else None,
                json.dumps(result) if result is not None else None,
                error,
            ),
        )
        return int(cur.lastrowid)


def recent_suggestions(limit: int) -> List[Dict[str, Any]]:
    with session() as conn:
        rows = conn.execute("SELECT * FROM suggestion_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        for k in ("request_json", "jev_request", "jev_answers", "result_json"):
            d[k] = json.loads(d[k]) if d[k] else None
        out.append(d)
    return out
