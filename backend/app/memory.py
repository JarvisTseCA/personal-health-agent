"""
Memory: what the backend remembers about each user, kept in SQLite.

It has six groups: the five in the team's design picture, and "other". Every
table is named memory_<group>..., so the groups are easy to find in the database:

    who           memory_who                      name; is a Fitbit connected
    preferences   memory_preferences              can't do vigorous exercise; which places have their equipment listed
                  memory_preferences_categories   👍 / 👎 on the activity table's categories ("Bicycling", ...)
                  memory_preferences_equipment    what the user has at home and at the gym
    goals         memory_goals                    one row per week: the weekly goal and the plan for its 7 days
    daily         memory_daily_check_ins          each day's check-in
                  memory_daily_suggestions        suggestions the user accepted or declined
                  memory_daily_workouts           workouts done, logged by hand or synced from Fitbit
                  memory_daily_app_opens          the days the user opened the app
    health        memory_health_vo2_max           VO2 max, one reading per month
                  memory_health_heart_rates       average heart rate during a workout
    other         memory_other                    what the app keeps here for itself, under names of its own

The backend works with the first five. "other" it only looks after: the Today
conversation, the chat, the user's notes, the clinician's feedback and anything
else the app wants back the next time it opens. Whatever the app stores under a
name comes back exactly as it was sent.

`save()` stores any part of a user's memory, and `read()` gives it back in the
same shape:

    {
      "who": {"name": "Alex", "fitbit_connected": True},
      "preferences": {
        "categories": {"Bicycling": "like", "Running": "dislike"},
        "equipment": {"home": ["Dumbbells"], "gym": None},        # None: not listed
        "no_vigorous": False,
      },
      "goals": [
        {"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default",
         "plan": ["30", "off", "30", "10", "off", "45", "10"]},   # Monday to Sunday
      ],
      "daily": {
        "check_ins": [{"date": "2026-11-23", "minutes": 30, "place": "indoors_with_others",
                       "energy": "normal", "mood": "surprise"}],
        "suggestions": [{"id": "s1", "date": "2026-11-23", "place": "indoors_with_others",
                         "activity_code": "01216", "activity_name": "Bicycling, stationary, 60 watts",
                         "outcome": "accepted", "reason": None, "note": None}],
        "workouts": [{"id": "w1", "date": "2026-11-23", "activity_code": "01216",
                      "activity_name": "Bicycling, stationary, 60 watts", "met": 5.0, "duration_min": 30,
                      "source": "manual", "confirmed": True, "band": None, "start_time": None}],
        "app_opens": ["2026-11-22", "2026-11-23"],                # oldest first
      },
      "health": {
        "vo2_max": [{"month": "2026-11", "ml_kg_min": 38.2, "source": "fitbit"}],
        "heart_rates": [{"workout_id": "w1", "avg_bpm": 132}],
      },
      "other": {                                                  # the names and what is under them are the app's
        "chat": [{"id": "c1", "role": "user", "text": "Is walking enough?"}],
        "notes": [{"id": "n1", "text": "knee is sore", "where": "Today: mood"}],
      },
    }

What a save changes:
- Groups and fields that are left out stay as they are.
- "categories", and each place under "equipment", are replaced by what is sent.
- Each name under "other" is replaced by what is sent; the other names stay.
- Everything else is added, or replaces the entry with the same key: a week by
  its week_start, a check-in by its date, a suggestion or a workout by its id,
  a VO2 max reading by its month, a heart rate by its workout_id. A day in
  "app_opens" is its own key, so a day sent again is still one day.
- A save that has a mistake in it stores nothing.

`delete()` takes one entry out of "daily" again: a check-in by its date, a
suggestion or a workout by its id. `clear()` forgets a user altogether.

The /api/memory routes in main.py are the way in from outside. When the app
finds the backend running it uses them for everything it remembers: it reads
Memory when it opens and tells it what changed after every step
(src/services/fromMemory.ts and toMemory.ts in the app). Its earlier way,
the whole state in one piece through /api/state (the `app_state` table in
db.py), is only read once, to bring an earlier save over.
"""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, Iterator, List, Optional

from . import db

GROUPS = ("who", "preferences", "goals", "daily", "health", "other")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SLOTS = ("off", "0", "5", "10", "30", "45")  # minutes planned for a day; DaySlot in src/lib/plan.ts
EQUIPMENT_PLACES = ("home", "gym")

SCHEMA = """
-- who
CREATE TABLE IF NOT EXISTS memory_who (
    user_id          TEXT PRIMARY KEY,
    name             TEXT,
    fitbit_connected INTEGER,                          -- 0 | 1
    updated_at       TEXT NOT NULL
);

-- preferences
CREATE TABLE IF NOT EXISTS memory_preferences (
    user_id               TEXT PRIMARY KEY,
    no_vigorous           INTEGER,                     -- 0 | 1; empty: not asked yet
    home_equipment_listed INTEGER NOT NULL DEFAULT 0,  -- 1: the user listed it (the list can be empty)
    gym_equipment_listed  INTEGER NOT NULL DEFAULT 0,
    updated_at            TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_preferences_categories (
    user_id  TEXT NOT NULL,
    category TEXT NOT NULL,                            -- major_heading in the activity table
    pref     TEXT NOT NULL CHECK (pref IN ('like', 'dislike')),
    PRIMARY KEY (user_id, category)
);
CREATE TABLE IF NOT EXISTS memory_preferences_equipment (
    user_id TEXT NOT NULL,
    place   TEXT NOT NULL CHECK (place IN ('home', 'gym')),
    item    TEXT NOT NULL,
    PRIMARY KEY (user_id, place, item)
);

-- goals
CREATE TABLE IF NOT EXISTS memory_goals (
    user_id        TEXT NOT NULL,
    week_start     TEXT NOT NULL,                      -- the week's Monday, "2026-11-23"
    goal_met_hours REAL,
    goal_set_by    TEXT,                               -- default | recap
    mon TEXT, tue TEXT, wed TEXT, thu TEXT, fri TEXT, sat TEXT, sun TEXT,  -- off | 0 | 5 | 10 | 30 | 45
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (user_id, week_start)
);

-- daily
CREATE TABLE IF NOT EXISTS memory_daily_check_ins (
    user_id    TEXT NOT NULL,
    date       TEXT NOT NULL,
    minutes    INTEGER,
    place      TEXT,
    energy     TEXT,
    mood       TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
);
CREATE TABLE IF NOT EXISTS memory_daily_suggestions (
    user_id       TEXT NOT NULL,
    id            TEXT NOT NULL,
    date          TEXT NOT NULL,
    place         TEXT,
    activity_code TEXT,                                -- Compendium code, for a pick from the activity table
    activity_name TEXT NOT NULL,
    outcome       TEXT NOT NULL CHECK (outcome IN ('accepted', 'declined')),
    reason        TEXT,                                -- why it was declined, e.g. tired, no-access
    note          TEXT,
    PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS memory_daily_workouts (
    user_id       TEXT NOT NULL,
    id            TEXT NOT NULL,
    date          TEXT NOT NULL,
    activity_code TEXT,
    activity_name TEXT NOT NULL,
    met           REAL NOT NULL,
    duration_min  INTEGER NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('manual', 'fitbit')),
    confirmed     INTEGER NOT NULL,                    -- 0 | 1; Fitbit workouts start unconfirmed
    band          TEXT,                                -- Fitbit's intensity band (fairly | very), for unconfirmed workouts
    start_time    TEXT,
    PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS memory_daily_app_opens (
    user_id TEXT NOT NULL,
    date    TEXT NOT NULL,                             -- a day the user opened the app, "2026-11-23"
    PRIMARY KEY (user_id, date)
);

-- health
CREATE TABLE IF NOT EXISTS memory_health_vo2_max (
    user_id   TEXT NOT NULL,
    month     TEXT NOT NULL,                           -- "2026-11"
    ml_kg_min REAL NOT NULL,
    source    TEXT NOT NULL,                           -- fitbit
    PRIMARY KEY (user_id, month)
);
CREATE TABLE IF NOT EXISTS memory_health_heart_rates (
    user_id    TEXT NOT NULL,
    workout_id TEXT NOT NULL,                          -- id in memory_daily_workouts
    avg_bpm    REAL NOT NULL,
    PRIMARY KEY (user_id, workout_id)
);

-- other
CREATE TABLE IF NOT EXISTS memory_other (
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,                          -- the app's name for it: chat, notes, ...
    content    TEXT NOT NULL,                          -- what the app sent, as JSON
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
);
"""

TABLES = (
    "memory_who",
    "memory_preferences", "memory_preferences_categories", "memory_preferences_equipment",
    "memory_goals",
    "memory_daily_check_ins", "memory_daily_suggestions", "memory_daily_workouts", "memory_daily_app_opens",
    "memory_health_vo2_max", "memory_health_heart_rates",
    "memory_other",
)


# The single entries delete() can take out, and the field that names one.
DELETABLE = {
    "check_ins": ("memory_daily_check_ins", "date"),
    "suggestions": ("memory_daily_suggestions", "id"),
    "workouts": ("memory_daily_workouts", "id"),
}


class MemoryDataError(ValueError):
    """What was sent to save() can't be stored as it is. The message says which part and why."""


# --- The four things other code calls ----------------------------------------------------------


def save(user_id: str, memory: Dict[str, Any]) -> None:
    """Store any part of a user's memory (the shape is at the top of this file)."""
    if not isinstance(memory, dict):
        raise MemoryDataError("memory should be an object with any of: " + ", ".join(GROUPS))
    unknown = sorted(set(memory) - set(GROUPS))
    if unknown:
        raise MemoryDataError(f"unknown group(s) {', '.join(unknown)}; the groups are {', '.join(GROUPS)}")
    with _session() as conn:  # one transaction: a mistake anywhere undoes the whole save
        for group in GROUPS:
            if group in memory:
                _SAVE[group](conn, user_id, memory[group])


def read(user_id: str, groups: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """A user's memory: all six groups, or only the ones named. An unknown user gets the same shape, empty."""
    wanted = GROUPS if groups is None else tuple(groups)
    unknown = sorted(set(wanted) - set(GROUPS))
    if unknown:
        raise MemoryDataError(f"unknown group(s) {', '.join(unknown)}; the groups are {', '.join(GROUPS)}")
    with _session() as conn:
        return {group: _READ[group](conn, user_id) for group in GROUPS if group in wanted}


def delete(user_id: str, kind: str, key: str) -> bool:
    """Take one entry out of "daily": a check-in by its date, a suggestion or a workout by its id.

    False when the user has no such entry. A workout's heart rate goes with it.
    """
    if kind not in DELETABLE:
        raise MemoryDataError(f"can't delete from {kind!r}; it can be one of: {', '.join(DELETABLE)}")
    table, column = DELETABLE[kind]
    with _session() as conn:
        found = conn.execute(f"DELETE FROM {table} WHERE user_id = ? AND {column} = ?", (user_id, key)).rowcount > 0
        if kind == "workouts":
            conn.execute("DELETE FROM memory_health_heart_rates WHERE user_id = ? AND workout_id = ?", (user_id, key))
    return found


def clear(user_id: str) -> None:
    """Forget everything about one user."""
    with _session() as conn:
        for table in TABLES:
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))


# --- Saving, one group at a time ---------------------------------------------------------------


def _save_who(conn: sqlite3.Connection, user_id: str, who: Any) -> None:
    row = _fields(who, ("name", "fitbit_connected"), (), "who")
    if "fitbit_connected" in row:
        row["fitbit_connected"] = _flag(row["fitbit_connected"], "who.fitbit_connected")
    _upsert(conn, "memory_who", ("user_id",), {"user_id": user_id, **row, "updated_at": _now()})


def _save_preferences(conn: sqlite3.Connection, user_id: str, preferences: Any) -> None:
    part = _fields(preferences, ("categories", "equipment", "no_vigorous"), (), "preferences")
    row: Dict[str, Any] = {"user_id": user_id, "updated_at": _now()}

    if "no_vigorous" in part:
        row["no_vigorous"] = _flag(part["no_vigorous"], "preferences.no_vigorous")

    if "categories" in part:
        categories = part["categories"] or {}
        if not isinstance(categories, dict):
            raise MemoryDataError('preferences.categories should look like {"Bicycling": "like"}')
        for category, pref in categories.items():
            if pref not in ("like", "dislike"):
                raise MemoryDataError(f"preferences.categories: {category!r} is {pref!r}, expected like or dislike")
        conn.execute("DELETE FROM memory_preferences_categories WHERE user_id = ?", (user_id,))
        conn.executemany(
            "INSERT INTO memory_preferences_categories (user_id, category, pref) VALUES (?, ?, ?)",
            [(user_id, category, pref) for category, pref in categories.items()],
        )

    if "equipment" in part:
        equipment = part["equipment"] or {}
        if not isinstance(equipment, dict) or set(equipment) - set(EQUIPMENT_PLACES):
            raise MemoryDataError('preferences.equipment should look like {"home": [...], "gym": [...]}')
        for place, items in equipment.items():
            if items is not None and not (isinstance(items, list) and all(isinstance(i, str) and i.strip() for i in items)):
                raise MemoryDataError(f"preferences.equipment.{place} should be a list of names, or null for not listed")
            conn.execute("DELETE FROM memory_preferences_equipment WHERE user_id = ? AND place = ?", (user_id, place))
            conn.executemany(
                "INSERT OR IGNORE INTO memory_preferences_equipment (user_id, place, item) VALUES (?, ?, ?)",
                [(user_id, place, item.strip()) for item in items or []],
            )
            row[f"{place}_equipment_listed"] = int(items is not None)

    _upsert(conn, "memory_preferences", ("user_id",), row)


def _save_goals(conn: sqlite3.Connection, user_id: str, weeks: Any) -> None:
    for i, week in enumerate(_list(weeks, "goals")):
        what = f"goals[{i}]"
        part = _fields(week, ("week_start", "goal_met_hours", "goal_set_by", "plan"), ("week_start",), what)
        row: Dict[str, Any] = {"user_id": user_id, "week_start": _monday(part["week_start"], what), "updated_at": _now()}

        if "goal_met_hours" in part:
            row["goal_met_hours"] = _above_zero(part["goal_met_hours"], f"{what}.goal_met_hours")
        if "goal_set_by" in part:
            if part["goal_set_by"] not in ("default", "recap"):
                raise MemoryDataError(f"{what}.goal_set_by is {part['goal_set_by']!r}, expected default or recap")
            row["goal_set_by"] = part["goal_set_by"]
        if "plan" in part:
            plan = part["plan"]
            if not isinstance(plan, list) or len(plan) != 7 or any(slot not in SLOTS for slot in plan):
                raise MemoryDataError(f"{what}.plan should be 7 days, Monday to Sunday, each one of: {', '.join(SLOTS)}")
            row.update(zip(DAYS, plan))

        _upsert(conn, "memory_goals", ("user_id", "week_start"), row)


def _save_daily(conn: sqlite3.Connection, user_id: str, daily: Any) -> None:
    part = _fields(daily, ("check_ins", "suggestions", "workouts", "app_opens"), (), "daily")

    for i, entry in enumerate(_list(part.get("check_ins"), "daily.check_ins")):
        what = f"daily.check_ins[{i}]"
        e = _fields(entry, ("date", "minutes", "place", "energy", "mood"), ("date",), what)
        _upsert(conn, "memory_daily_check_ins", ("user_id", "date"), {
            "user_id": user_id, "date": _date(e["date"], what), "minutes": e.get("minutes"),
            "place": e.get("place"), "energy": e.get("energy"), "mood": e.get("mood"), "updated_at": _now(),
        })

    for i, entry in enumerate(_list(part.get("suggestions"), "daily.suggestions")):
        what = f"daily.suggestions[{i}]"
        e = _fields(
            entry, ("id", "date", "place", "activity_code", "activity_name", "outcome", "reason", "note"),
            ("date", "activity_name", "outcome"), what,
        )
        if e["outcome"] not in ("accepted", "declined"):
            raise MemoryDataError(f"{what}.outcome is {e['outcome']!r}, expected accepted or declined")
        _upsert(conn, "memory_daily_suggestions", ("user_id", "id"), {
            "user_id": user_id, "id": _id(e.get("id")), "date": _date(e["date"], what), "place": e.get("place"),
            "activity_code": _code(e.get("activity_code")), "activity_name": e["activity_name"],
            "outcome": e["outcome"], "reason": e.get("reason"), "note": e.get("note"),
        })

    for i, entry in enumerate(_list(part.get("workouts"), "daily.workouts")):
        what = f"daily.workouts[{i}]"
        e = _fields(
            entry,
            ("id", "date", "activity_code", "activity_name", "met", "duration_min", "source", "confirmed", "band", "start_time"),
            ("date", "activity_name", "met", "duration_min"), what,
        )
        source = e.get("source") or "manual"
        if source not in ("manual", "fitbit"):
            raise MemoryDataError(f"{what}.source is {source!r}, expected manual or fitbit")
        confirmed = True if e.get("confirmed") is None else e["confirmed"]
        _upsert(conn, "memory_daily_workouts", ("user_id", "id"), {
            "user_id": user_id, "id": _id(e.get("id")), "date": _date(e["date"], what),
            "activity_code": _code(e.get("activity_code")), "activity_name": e["activity_name"],
            "met": _above_zero(e["met"], f"{what}.met"), "duration_min": _above_zero(e["duration_min"], f"{what}.duration_min"),
            "source": source, "confirmed": _flag(confirmed, f"{what}.confirmed"),
            "band": e.get("band"), "start_time": e.get("start_time"),
        })

    for i, day in enumerate(_list(part.get("app_opens"), "daily.app_opens")):
        conn.execute(
            "INSERT OR IGNORE INTO memory_daily_app_opens (user_id, date) VALUES (?, ?)",
            (user_id, _date(day, f"daily.app_opens[{i}]")),
        )


def _save_health(conn: sqlite3.Connection, user_id: str, health: Any) -> None:
    part = _fields(health, ("vo2_max", "heart_rates"), (), "health")

    for i, entry in enumerate(_list(part.get("vo2_max"), "health.vo2_max")):
        what = f"health.vo2_max[{i}]"
        e = _fields(entry, ("month", "ml_kg_min", "source"), ("month", "ml_kg_min"), what)
        _upsert(conn, "memory_health_vo2_max", ("user_id", "month"), {
            "user_id": user_id, "month": _month(e["month"], what),
            "ml_kg_min": _above_zero(e["ml_kg_min"], f"{what}.ml_kg_min"), "source": e.get("source") or "fitbit",
        })

    for i, entry in enumerate(_list(part.get("heart_rates"), "health.heart_rates")):
        what = f"health.heart_rates[{i}]"
        e = _fields(entry, ("workout_id", "avg_bpm"), ("workout_id", "avg_bpm"), what)
        _upsert(conn, "memory_health_heart_rates", ("user_id", "workout_id"), {
            "user_id": user_id, "workout_id": str(e["workout_id"]), "avg_bpm": _above_zero(e["avg_bpm"], f"{what}.avg_bpm"),
        })


def _save_other(conn: sqlite3.Connection, user_id: str, other: Any) -> None:
    if not isinstance(other, dict):
        raise MemoryDataError('other should be an object: the app\'s own names, each with what to keep, like {"chat": [...]}')
    for name, content in other.items():
        if not isinstance(name, str) or not name.strip():
            raise MemoryDataError(f"other: {name!r} can't be a name; a name is a word like chat or notes")
        try:
            as_json = json.dumps(content, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError):
            raise MemoryDataError(f"other.{name} can't be kept: it has something in it that JSON can't hold") from None
        _upsert(conn, "memory_other", ("user_id", "name"), {
            "user_id": user_id, "name": name, "content": as_json, "updated_at": _now(),
        })


_SAVE = {
    "who": _save_who, "preferences": _save_preferences, "goals": _save_goals,
    "daily": _save_daily, "health": _save_health, "other": _save_other,
}


# --- Reading, one group at a time --------------------------------------------------------------


def _read_who(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    row = conn.execute("SELECT name, fitbit_connected FROM memory_who WHERE user_id = ?", (user_id,)).fetchone()
    return {"name": row["name"] if row else None, "fitbit_connected": _bool(row["fitbit_connected"]) if row else None}


def _read_preferences(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    row = conn.execute("SELECT * FROM memory_preferences WHERE user_id = ?", (user_id,)).fetchone()
    categories = conn.execute(
        "SELECT category, pref FROM memory_preferences_categories WHERE user_id = ? ORDER BY rowid", (user_id,)
    ).fetchall()
    equipment: Dict[str, Optional[List[str]]] = {}
    for place in EQUIPMENT_PLACES:
        items = conn.execute(
            "SELECT item FROM memory_preferences_equipment WHERE user_id = ? AND place = ? ORDER BY rowid", (user_id, place)
        ).fetchall()
        listed = bool(row and row[f"{place}_equipment_listed"])
        equipment[place] = [r["item"] for r in items] if listed else None
    return {
        "categories": {r["category"]: r["pref"] for r in categories},
        "equipment": equipment,
        "no_vigorous": _bool(row["no_vigorous"]) if row else None,
    }


def _read_goals(conn: sqlite3.Connection, user_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute("SELECT * FROM memory_goals WHERE user_id = ? ORDER BY week_start", (user_id,)).fetchall()
    return [
        {
            "week_start": r["week_start"], "goal_met_hours": r["goal_met_hours"], "goal_set_by": r["goal_set_by"],
            "plan": [r[day] for day in DAYS] if r["mon"] is not None else None,
        }
        for r in rows
    ]


def _read_daily(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    check_ins = conn.execute(
        "SELECT date, minutes, place, energy, mood FROM memory_daily_check_ins WHERE user_id = ? ORDER BY date", (user_id,)
    ).fetchall()
    suggestions = conn.execute(
        "SELECT id, date, place, activity_code, activity_name, outcome, reason, note "
        "FROM memory_daily_suggestions WHERE user_id = ? ORDER BY date, rowid", (user_id,)
    ).fetchall()
    workouts = conn.execute(
        "SELECT id, date, activity_code, activity_name, met, duration_min, source, confirmed, band, start_time "
        "FROM memory_daily_workouts WHERE user_id = ? ORDER BY date, rowid", (user_id,)
    ).fetchall()
    app_opens = conn.execute(
        "SELECT date FROM memory_daily_app_opens WHERE user_id = ? ORDER BY date", (user_id,)
    ).fetchall()
    return {
        "check_ins": [dict(r) for r in check_ins],
        "suggestions": [dict(r) for r in suggestions],
        "workouts": [{**dict(r), "confirmed": bool(r["confirmed"])} for r in workouts],
        "app_opens": [r["date"] for r in app_opens],
    }


def _read_health(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    vo2_max = conn.execute(
        "SELECT month, ml_kg_min, source FROM memory_health_vo2_max WHERE user_id = ? ORDER BY month", (user_id,)
    ).fetchall()
    heart_rates = conn.execute(
        "SELECT workout_id, avg_bpm FROM memory_health_heart_rates WHERE user_id = ? ORDER BY rowid", (user_id,)
    ).fetchall()
    return {"vo2_max": [dict(r) for r in vo2_max], "heart_rates": [dict(r) for r in heart_rates]}


def _read_other(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    rows = conn.execute("SELECT name, content FROM memory_other WHERE user_id = ? ORDER BY rowid", (user_id,)).fetchall()
    return {r["name"]: json.loads(r["content"]) for r in rows}


_READ = {
    "who": _read_who, "preferences": _read_preferences, "goals": _read_goals,
    "daily": _read_daily, "health": _read_health, "other": _read_other,
}


# --- Small helpers -----------------------------------------------------------------------------


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    """db.session(), with the Memory tables made sure of first. Commits on success, undoes everything on an error."""
    with db.session() as conn:
        conn.executescript(SCHEMA)
        yield conn


def _upsert(conn: sqlite3.Connection, table: str, keys: Iterable[str], row: Dict[str, Any]) -> None:
    """Add `row`, or, if a row with the same keys is there, overwrite only the columns `row` has."""
    keys = list(keys)
    columns = list(row)  # column names come from this file, never from what was sent
    updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in keys)
    conn.execute(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)}) "
        f"ON CONFLICT({', '.join(keys)}) DO UPDATE SET {updates}",
        [row[c] for c in columns],
    )


def _fields(entry: Any, allowed: Iterable[str], required: Iterable[str], what: str) -> Dict[str, Any]:
    """`entry` as it is, after checking it has no field we don't know and none of the required ones is missing."""
    if not isinstance(entry, dict):
        raise MemoryDataError(f"{what} should be an object with: {', '.join(allowed)}")
    unknown = sorted(set(entry) - set(allowed))
    if unknown:
        raise MemoryDataError(f"{what}: unknown field(s) {', '.join(unknown)}; expected {', '.join(allowed)}")
    missing = [key for key in required if entry.get(key) in (None, "")]
    if missing:
        raise MemoryDataError(f"{what}: {', '.join(missing)} is required")
    return dict(entry)


def _list(value: Any, what: str) -> List[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise MemoryDataError(f"{what} should be a list")
    return value


def _flag(value: Any, what: str) -> Optional[int]:
    """true / false as 1 / 0 for SQLite; None stays None (not known)."""
    if value is None:
        return None
    if not isinstance(value, bool):
        raise MemoryDataError(f"{what} is {value!r}, expected true or false")
    return int(value)


def _bool(value: Optional[int]) -> Optional[bool]:
    return None if value is None else bool(value)


def _above_zero(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise MemoryDataError(f"{what} is {value!r}, expected a number above 0")
    return value


def _date(value: Any, what: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise MemoryDataError(f"{what}: {value!r} is not a date like 2026-11-23") from None


def _monday(value: Any, what: str) -> str:
    day = _date(value, f"{what}.week_start")
    if date.fromisoformat(day).weekday() != 0:
        raise MemoryDataError(f"{what}.week_start {day} is not a Monday")
    return day


def _month(value: Any, what: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m").strftime("%Y-%m")
    except (TypeError, ValueError):
        raise MemoryDataError(f"{what}: {value!r} is not a month like 2026-11") from None


def _code(value: Any) -> Optional[str]:
    """A Compendium code the way the activity table writes it: 5 digits, "01216"."""
    return None if value in (None, "") else str(value).strip().zfill(5)


def _id(value: Any) -> str:
    """The id that was sent, or a new one."""
    return str(value) if value not in (None, "") else uuid.uuid4().hex


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
