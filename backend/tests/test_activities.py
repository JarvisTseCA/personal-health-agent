"""The activity catalog: the CSV in activity_tables/ → the `activities` table in SQLite."""
import csv

import pytest
from fastapi.testclient import TestClient

from app import activities, db, main

HEADER = (
    "major_heading,activity_code,met_value,activity_description,intensity_high,intensity_low,"
    "loc_gym,at_home,loc_outside,needs_equipment,need_friends,exercise_rec"
)
# Three lines as they are in the real CSV.
BIKE = 'Bicycling,01216,5.0,"Bicycling, stationary, 60 watts, light to moderate effort",0,1,1,0,0,1,0,1'
BALLROOM = 'Dancing,03030,5.5,"Ballroom dancing, fast (Taylor Code 125)",0,0,1,0,0,0,1,1'
DESK = 'Occupation,11000,2.0,"Active workstation, Pedal desk, balance chair/ball, General, light effort",0,1,0,0,0,1,0,0'


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Every test gets its own empty database, never backend/data/pha.db."""
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))


def write_csv(tmp_path, *lines, header=HEADER, newline="\n", encoding="utf-8"):
    path = tmp_path / "activities.csv"
    path.write_bytes((newline.join([header, *lines]) + newline).encode(encoding))
    return path


def table():
    """The whole `activities` table, in code order."""
    with db.session() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM activities ORDER BY activity_code")]


def test_the_csv_in_the_repo_loads_whole():
    with open(activities.CSV_PATH, encoding="utf-8-sig", newline="") as f:
        lines_in_csv = sum(1 for _ in csv.DictReader(f))

    total = activities.load()

    assert total == lines_in_csv == activities.count() > 0
    assert 0 < activities.count(recommended=True) <= total
    assert all(len(r["activity_code"]) == 5 and r["activity_code"].isdigit() for r in table())


def test_a_row_keeps_its_leading_zero_and_its_values(tmp_path):
    activities.load(write_csv(tmp_path, BIKE))

    assert table() == [{
        "activity_code": "01216",
        "major_heading": "Bicycling",
        "met_value": 5.0,
        "activity_description": "Bicycling, stationary, 60 watts, light to moderate effort",
        "intensity_high": 0, "intensity_low": 1,
        "loc_gym": 1, "at_home": 0, "loc_outside": 0,
        "needs_equipment": 1, "need_friends": 0, "exercise_rec": 1,
    }]
    with db.session() as conn:
        assert conn.execute("SELECT typeof(activity_code) FROM activities").fetchone()[0] == "text"


def test_a_code_that_lost_its_zero_in_excel_gets_it_back(tmp_path):
    activities.load(write_csv(tmp_path, BIKE.replace(",01216,", ",1216,")))

    assert [r["activity_code"] for r in table()] == ["01216"]


def test_a_csv_saved_from_excel_loads(tmp_path):
    """Excel adds a hidden mark at the start of the file and Windows line endings."""
    activities.load(write_csv(tmp_path, BIKE, BALLROOM, newline="\r\n", encoding="utf-8-sig"))

    assert [r["activity_code"] for r in table()] == ["01216", "03030"]
    assert table()[0]["major_heading"] == "Bicycling"


def test_loading_again_replaces_the_table(tmp_path):
    assert activities.load(write_csv(tmp_path, BIKE, BALLROOM, DESK)) == 3

    # The CSV changed: two rows are gone and the bike has a new MET value.
    assert activities.load(write_csv(tmp_path, BIKE.replace(",5.0,", ",6.8,"))) == 1

    assert [(r["activity_code"], r["met_value"]) for r in table()] == [("01216", 6.8)]


def test_count_can_keep_only_the_recommended_ones(tmp_path):
    activities.load(write_csv(tmp_path, BIKE, BALLROOM, DESK))

    assert activities.count() == 3
    assert activities.count(recommended=True) == 2  # the desk row is exercise_rec = 0


@pytest.mark.parametrize("bad_line, says", [
    (BALLROOM.replace(",5.5,", ",fast,"), "line 3: met_value 'fast' is not a number"),
    (BALLROOM.replace(",5.5,", ",0,"), "line 3: met_value 0.0 should be above 0"),
    (BALLROOM[:-1] + "yes", "line 3: exercise_rec is 'yes', expected 0 or 1"),
    (BALLROOM.replace(",03030,", ",3O30,"), "line 3: activity_code '3O30' is not a Compendium code"),
    (BALLROOM.replace(",03030,", ",01216,"), "line 3: activity_code 01216 is already on line 2"),
    ("Dancing,03030,5.5", "line 3: major_heading and activity_description can't be empty"),  # a line cut short
])
def test_a_wrong_line_is_named_and_the_table_stays_as_it_was(tmp_path, bad_line, says):
    activities.load(write_csv(tmp_path, BIKE))

    with pytest.raises(activities.ActivityTableError) as e:
        activities.load(write_csv(tmp_path, BIKE, bad_line))

    assert says in str(e.value)
    assert [r["activity_code"] for r in table()] == ["01216"]


def test_a_missing_column_or_file_or_an_empty_csv_is_an_error(tmp_path):
    with pytest.raises(activities.ActivityTableError, match=r"missing column\(s\): exercise_rec"):
        activities.load(write_csv(tmp_path, header=HEADER.replace(",exercise_rec", "")))
    with pytest.raises(activities.ActivityTableError, match="no activities in the file"):
        activities.load(write_csv(tmp_path))
    with pytest.raises(activities.ActivityTableError, match="Activity table not found"):
        activities.load(tmp_path / "nowhere.csv")


def test_starting_the_backend_fills_the_table():
    assert activities.count() == 0

    with TestClient(main.app) as client:  # `with` runs the startup step
        assert client.get("/api/health").json()["ok"] is True
        assert activities.count() > 0


def test_the_backend_does_not_start_on_a_csv_with_a_mistake(tmp_path, monkeypatch):
    monkeypatch.setattr(activities, "CSV_PATH", write_csv(tmp_path, BIKE, BALLROOM.replace(",5.5,", ",fast,")))

    with pytest.raises(activities.ActivityTableError, match="line 3: met_value 'fast' is not a number"):
        with TestClient(main.app):
            pass
