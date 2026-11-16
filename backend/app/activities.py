"""
The activity catalog: every activity the backend knows about.

The source is one CSV in the repo, built from the 2024 Adult Compendium of
Physical Activities:

    activity_tables/2024_compendium_exercise_recommendations.csv

Each time the backend starts, the `activities` table in SQLite is replaced
with what the CSV says. So the CSV is the only place to edit: change it,
restart the backend, and the table follows. A CSV that can't be read stops
the backend from starting and names the line that is wrong.

`activity_code` is the 5-digit Compendium code, e.g. "01216". The frontend
library uses the same code (`code` in src/lib/activities.ts), so both sides
can point at the same activity.
"""
import csv
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import db

CSV_PATH = Path(__file__).resolve().parents[2] / "activity_tables" / "2024_compendium_exercise_recommendations.csv"

# The 0/1 columns, in the order they sit in the CSV and in the table.
FLAGS = [
    "intensity_high", "intensity_low", "loc_gym", "at_home", "loc_outside",
    "needs_equipment", "need_friends", "exercise_rec",
]
COLUMNS = ["activity_code", "major_heading", "met_value", "activity_description"] + FLAGS


class ActivityTableError(ValueError):
    """The CSV can't be loaded as it is. The message says which line and why."""


def _row(raw: Dict[str, Any], where: str) -> Tuple[Any, ...]:
    """One CSV line as a row for the table, or an error that says what is wrong with it."""
    code = (raw["activity_code"] or "").strip()
    if not code.isdigit() or len(code) > 5:
        raise ActivityTableError(f"{where}: activity_code {code!r} is not a Compendium code")
    code = code.zfill(5)  # Excel drops the leading zero (1216); put it back (01216)

    try:
        met = float(raw["met_value"])
    except (TypeError, ValueError):
        raise ActivityTableError(f"{where}: met_value {raw['met_value']!r} is not a number") from None
    if met <= 0:
        raise ActivityTableError(f"{where}: met_value {met} should be above 0")

    heading = (raw["major_heading"] or "").strip()
    description = (raw["activity_description"] or "").strip()
    if not heading or not description:
        raise ActivityTableError(f"{where}: major_heading and activity_description can't be empty")

    flags = []
    for column in FLAGS:
        value = (raw[column] or "").strip()
        if value not in ("0", "1"):
            raise ActivityTableError(f"{where}: {column} is {value!r}, expected 0 or 1")
        flags.append(int(value))

    return (code, heading, met, description, *flags)


def read_csv(path: Optional[Path] = None) -> List[Tuple[Any, ...]]:
    """Every line of the CSV (CSV_PATH unless another file is given), checked, as rows ready for the table."""
    path = Path(path or CSV_PATH)
    try:
        # utf-8-sig: a CSV saved from Excel starts with a hidden mark; this drops it.
        f = open(path, encoding="utf-8-sig", newline="")
    except FileNotFoundError:
        raise ActivityTableError(f"Activity table not found: {path}") from None
    with f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ActivityTableError(f"{path.name}: missing column(s): {', '.join(missing)}")
        rows: List[Tuple[Any, ...]] = []
        first_seen: Dict[str, int] = {}
        for line, raw in enumerate(reader, start=2):  # line 1 is the header
            row = _row(raw, f"{path.name} line {line}")
            code = row[0]
            if code in first_seen:
                raise ActivityTableError(
                    f"{path.name} line {line}: activity_code {code} is already on line {first_seen[code]}"
                )
            first_seen[code] = line
            rows.append(row)
    if not rows:
        raise ActivityTableError(f"{path.name}: no activities in the file")
    return rows


def load(path: Optional[Path] = None) -> int:
    """Replace the `activities` table with the CSV. Returns how many activities it holds now.

    The whole CSV is read and checked first, so a CSV with a mistake leaves
    the table as it was.
    """
    rows = read_csv(path)
    placeholders = ", ".join("?" * len(COLUMNS))
    with db.session() as conn:
        conn.execute("DELETE FROM activities")
        conn.executemany(f"INSERT INTO activities ({', '.join(COLUMNS)}) VALUES ({placeholders})", rows)
    return len(rows)


def count(recommended: bool = False) -> int:
    """How many activities are in the table; with `recommended`, only those marked exercise_rec."""
    sql = "SELECT COUNT(*) FROM activities" + (" WHERE exercise_rec = 1" if recommended else "")
    with db.session() as conn:
        return int(conn.execute(sql).fetchone()[0])
