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

`candidates()` picks, out of the whole table, the activities that fit one
user today. Jev can't be handed every row (a question takes 255 options at
most), so this runs first. It is not connected to /api/suggest yet.
"""
import csv
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import db

CSV_PATH = Path(__file__).resolve().parents[2] / "activity_tables" / "2024_compendium_exercise_recommendations.csv"

# The 0/1 columns, in the order they sit in the CSV and in the table.
FLAGS = [
    "intensity_high", "intensity_low", "loc_gym", "at_home", "loc_outside",
    "needs_equipment", "need_friends", "exercise_rec",
]
COLUMNS = ["activity_code", "major_heading", "met_value", "activity_description"] + FLAGS
# Filled in by activity_tables/update_table.py; used to keep the three picks varied. A CSV without
# them still loads ('' for every row).
OPTIONAL = ["family", "type"]


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

    extra = [(raw.get(column) or "").strip() for column in OPTIONAL]
    return (code, heading, met, description, *flags, *extra)


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
    columns = COLUMNS + OPTIONAL
    placeholders = ", ".join("?" * len(columns))
    with db.session() as conn:
        conn.execute("DELETE FROM activities")
        conn.executemany(f"INSERT INTO activities ({', '.join(columns)}) VALUES ({placeholders})", rows)
    return len(rows)


def count(recommended: bool = False) -> int:
    """How many activities are in the table; with `recommended`, only those marked exercise_rec."""
    sql = "SELECT COUNT(*) FROM activities" + (" WHERE exercise_rec = 1" if recommended else "")
    with db.session() as conn:
        return int(conn.execute(sql).fetchone()[0])


# The table has one 0/1 column per place: loc_gym, at_home and loc_outside. The app's three check-in places, as conditions on those columns. "Indoors, private" (home,
# a hotel room) is what can be done at home; "indoors, with others" (a gym, an office) is
# what can be done at the gym or at home. Any other place has no candidates.
PLACE_WHERE = {
    "indoors_private": "at_home = 1",
    "indoors_with_others": "(loc_gym = 1 OR at_home = 1)",
    "outside": "loc_outside = 1",
    # The table's own columns still work, for GET /api/activities and older callers.
    "gym": "loc_gym = 1",
    "home": "at_home = 1",
}


def _marks(values: List[Any]) -> str:
    """"?, ?, ?" for a list of three, to put a list into a query safely."""
    return ", ".join("?" * len(values))


def _rows(where: List[str], values: List[Any]) -> List[Dict[str, Any]]:
    """The rows of the table that meet every condition in `where`, in code order."""
    sql = "SELECT * FROM activities" + (f" WHERE {' AND '.join(where)}" if where else "") + " ORDER BY activity_code"
    with db.session() as conn:
        return [dict(r) for r in conn.execute(sql, values)]


def catalog(
    recommended: bool = True, headings: Iterable[str] = (), place: Optional[str] = None
) -> List[Dict[str, Any]]:
    """The table as it is, for whoever wants to read it (GET /api/activities).

    Unlike candidates(), nothing is decided here: partner activities are
    included, and `place` is optional. By default only the rows marked as an
    exercise to recommend; `recommended=False` gives every row.
    """
    where: List[str] = []
    values: List[Any] = []
    if recommended:
        where.append("exercise_rec = 1")
    keep = list(headings)
    if keep:
        where.append(f"major_heading IN ({_marks(keep)})")
        values += keep
    if place is not None:
        if place not in PLACE_WHERE:
            return []
        where.append(PLACE_WHERE[place])
    return _rows(where, values)


def descriptions_of(codes: Iterable[str]) -> Dict[str, str]:
    """The activity_description of each code that is in the table: {"01216": "Bicycling, stationary, ..."}."""
    wanted = sorted({str(c).strip().zfill(5) for c in codes if str(c).strip()})
    if not wanted:
        return {}
    with db.session() as conn:
        return {
            r["activity_code"]: r["activity_description"]
            for r in conn.execute(
                f"SELECT activity_code, activity_description FROM activities WHERE activity_code IN ({_marks(wanted)})", wanted
            )
        }


# Words that start the effort part of a description: "light effort", "moderate", "vigorous", "general".
_EFFORT = re.compile(
    r"^(very |)(light|moderate|vigorous|general|leisurely|leisure|slow|fast|brisk|easy|competitive|"
    r"recreational|casual|racing|self-selected|elite)\b|\beffort\b|\bpace\b",
    re.IGNORECASE,
)


def label_of(description: str) -> str:
    """A short name for the app: the description up to its effort level.

    "Bicycling, stationary, 51-89 watts, light to moderate effort" → "Bicycling, stationary, 51-89 watts".
    "(Taylor Code 200)" and similar notes go too. The first part always stays.
    """
    text = re.sub(r"\s*\((Taylor Code[^)]*|[^)]*min/mile)\)", "", description).strip()
    parts = [p.strip() for p in re.split(r",(?![^()]*\))", text)]  # commas outside parentheses
    kept = [parts[0]]
    for part in parts[1:]:
        if not part or _EFFORT.search(part):
            break
        kept.append(part)
    return ", ".join(kept)


def families_of(codes: Iterable[str]) -> List[str]:
    """The `family` of each code that is in the table and has one, e.g. ["cycling_indoor"]."""
    wanted = sorted({str(c).strip().zfill(5) for c in codes if str(c).strip()})
    if not wanted:
        return []
    with db.session() as conn:
        rows = conn.execute(f"SELECT DISTINCT family FROM activities WHERE activity_code IN ({_marks(wanted)})", wanted)
        return sorted(r["family"] for r in rows if r["family"])


def types_by_code(codes: Iterable[str]) -> Dict[str, str]:
    """The `type` of each code that is in the table and has one, e.g. {"01020": "cardio"}."""
    wanted = sorted({str(c).strip().zfill(5) for c in codes if str(c).strip()})
    if not wanted:
        return {}
    with db.session() as conn:
        rows = conn.execute(f"SELECT activity_code, type FROM activities WHERE activity_code IN ({_marks(wanted)})", wanted)
        return {r["activity_code"]: r["type"] for r in rows if r["type"]}


def headings_of(codes: Iterable[str]) -> List[str]:
    """The major_heading of each activity code, each heading once, in the order given.

    This turns "activities the user picked before" into "headings the user
    likes": ["01216", "17358"] → ["Bicycling", "Walking"]. A code that is not
    in the table is skipped.
    """
    wanted = [str(c).strip().zfill(5) for c in codes]
    if not wanted:
        return []
    with db.session() as conn:
        found = {
            r["activity_code"]: r["major_heading"]
            for r in conn.execute(
                f"SELECT activity_code, major_heading FROM activities WHERE activity_code IN ({_marks(wanted)})", wanted
            )
        }
    headings: List[str] = []
    for code in wanted:
        heading = found.get(code)
        if heading and heading not in headings:
            headings.append(heading)
    return headings


def candidates(
    place: str,
    headings: Iterable[str] = (),
    exclude_headings: Iterable[str] = (),
    min_met: Optional[float] = None,
    below_met: Optional[float] = None,
    exclude_codes: Iterable[str] = (),
    indoor_only: bool = False,
) -> List[Dict[str, Any]]:
    """The activities in the table that fit this user today, in code order.

    Always:
    - marked as an exercise to recommend (exercise_rec = 1)
    - can be done at `place`: "indoors_private", "indoors_with_others" or "outside" (or the
      table's own "gym" and "home"). Any other place → no candidates.
    - needs no partner (need_friends = 0); the app doesn't ask whether one is around

    Only when given:
    - headings: keep these major_headings only, e.g. what the user picked before
      (see headings_of). Empty means no preference, so nothing is filtered by it.
    - exclude_headings: drop these major_headings, e.g. after "Did this recently" or a 👎 category
    - exclude_codes: drop these activities, e.g. one the user said "Not in the mood" to today
    - indoor_only: keep only what can be done at the gym or at home, e.g. after "Weather"
    - min_met: keep met_value at or above this, e.g. 3 while light activity doesn't count toward the goal
    - below_met: keep met_value under this, e.g. 6 for someone who shouldn't do vigorous activity

    Equipment is not filtered: the table only says whether an activity needs
    some, not which.

    Example: candidates("gym", headings=["Bicycling"], below_met=6) → the
    stationary-bike rows under 6 MET.
    """
    fits = PLACE_WHERE.get(place)
    if fits is None:
        return []
    where = ["exercise_rec = 1", fits, "need_friends = 0"]
    values: List[Any] = []

    keep = list(headings)
    if keep:
        where.append(f"major_heading IN ({_marks(keep)})")
        values += keep
    drop = list(exclude_headings)
    if drop:
        where.append(f"major_heading NOT IN ({_marks(drop)})")
        values += drop
    skip = [str(c).strip().zfill(5) for c in exclude_codes]
    if skip:
        where.append(f"activity_code NOT IN ({_marks(skip)})")
        values += skip
    if indoor_only:
        where.append("(loc_gym = 1 OR at_home = 1)")
    if min_met is not None:
        where.append("met_value >= ?")
        values.append(min_met)
    if below_met is not None:
        where.append("met_value < ?")
        values.append(below_met)
    return _rows(where, values)
