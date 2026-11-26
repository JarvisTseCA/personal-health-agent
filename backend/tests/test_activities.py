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


def repo_rows():
    with open(activities.CSV_PATH, encoding="utf-8-sig", newline="") as f:
        return {r["activity_code"]: r for r in csv.DictReader(f)}


def test_the_csv_in_the_repo_has_a_family_and_type_for_every_row():
    rows = repo_rows().values()
    assert all(r["family"] and r["type"] for r in rows)
    assert repo_rows()["01216"]["family"] == "cycling_indoor"
    assert repo_rows()["12050"]["family"] == "running"
    assert repo_rows()["12050"]["type"] == "cardio"


def test_every_activity_that_can_be_suggested_has_a_place():
    for r in repo_rows().values():
        if r["exercise_rec"] == "1" and r["need_friends"] == "0" and float(r["met_value"]) >= 3:
            places = r["loc_gym"], r["at_home"], r["loc_outside"]
            assert "1" in places, f"{r['activity_code']} {r['activity_description']} has no place"


def test_the_row_fixes_are_in_the_csv_in_the_repo():
    rows = repo_rows()
    assert rows["17140"]["exercise_rec"] == "0"  # using crutches
    assert rows["18012"]["exercise_rec"] == "0"  # power boating, passenger
    assert rows["22240"]["at_home"] == "1"       # active video game
    assert rows["12050"]["at_home"] == "0"       # running, 6 mph
    assert rows["12025"]["at_home"] == "1"       # jogging in place stays


def test_updating_the_table_again_changes_nothing(tmp_path):
    import importlib.util, shutil
    script = activities.CSV_PATH.parent / "update_table.py"
    spec = importlib.util.spec_from_file_location("update_table", script)
    update_table = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(update_table)
    copy = tmp_path / "table.csv"
    shutil.copy(activities.CSV_PATH, copy)

    assert update_table.update(copy) == 0
    assert copy.read_bytes() == activities.CSV_PATH.read_bytes()


def test_a_row_keeps_its_leading_zero_and_its_values(tmp_path):
    activities.load(write_csv(tmp_path, BIKE))

    assert table() == [{
        "activity_code": "01216",
        "major_heading": "Bicycling",
        "met_value": 5.0,
        "activity_description": "Bicycling, stationary, 60 watts, light to moderate effort",
        "intensity_high": 0, "intensity_low": 1,
        "loc_gym": 1, "at_home": 0, "loc_outside": 0,
        "needs_equipment": 1, "need_friends": 0, "exercise_rec": 1, "family": "", "type": "",
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


# ---- candidates(): which activities fit this user today ----

# More lines as they are in the real CSV. After the description the columns are:
# intensity_high, intensity_low, loc_gym, at_home, loc_outside, needs_equipment, need_friends, exercise_rec
BIKE_HARD = 'Bicycling,01220,6.0,"Bicycling, stationary, 90-100 watts, moderate to vigorous",1,0,1,0,0,1,0,1'
MOUNTAIN = 'Bicycling,01003,14.0,"Bicycling, mountain, uphill, vigorous",1,0,0,0,1,1,0,1'  # outside only
TREADMILL = 'Walking,17358,4.8,"Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade",0,1,1,0,0,1,0,1'
BIRDS = 'Walking,17085,2.5,"Bird watching, walking and stopping",0,1,1,1,1,0,0,1'  # gym, home and outside
RUN = 'Running,12028,6.5,"Running, 4 to 4.2 mph (13 min/mile)",0,1,1,1,1,0,0,1'  # gym, home and outside
COACH = 'Sports,15142,8.0,"Coaching, actively playing sport with players",0,0,1,0,0,0,0,0'  # at the gym, not recommended
# From the top of the file: BIKE is gym only; BALLROOM is at the gym but needs a partner; DESK is not recommended.


@pytest.fixture
def small_table(tmp_path):
    activities.load(write_csv(tmp_path, BIKE, BIKE_HARD, MOUNTAIN, BALLROOM, TREADMILL, BIRDS, RUN, COACH, DESK))


def codes(rows):
    return [r["activity_code"] for r in rows]


def test_candidates_are_recommended_fit_the_place_and_need_no_partner(small_table):
    # Left out at the gym: MOUNTAIN (outside only), BALLROOM (partner), COACH and DESK (not recommended).
    assert codes(activities.candidates("gym")) == ["01216", "01220", "12028", "17085", "17358"]
    assert codes(activities.candidates("home")) == ["12028", "17085"]
    assert codes(activities.candidates("outside")) == ["01003", "12028", "17085"]


def test_the_three_check_in_places(small_table):
    # Indoors, private: what can be done at home. Indoors, with others: at the gym or at home.
    assert codes(activities.candidates("indoors_private")) == ["12028", "17085"]
    assert codes(activities.candidates("indoors_with_others")) == ["01216", "01220", "12028", "17085", "17358"]
    assert codes(activities.candidates("outside")) == ["01003", "12028", "17085"]


def test_a_place_the_table_has_no_column_for_has_no_candidates(small_table):
    assert activities.candidates("office") == []
    assert activities.candidates("traveling") == []


def test_a_partner_activity_or_one_not_recommended_never_comes_back(small_table):
    assert activities.candidates("gym", headings=["Dancing"]) == []  # only BALLROOM, which needs a partner
    assert activities.candidates("gym", headings=["Sports"]) == []  # only COACH, which is not recommended


def test_headings_keep_only_what_the_user_likes(small_table):
    assert codes(activities.candidates("gym", headings=["Bicycling"])) == ["01216", "01220"]
    assert codes(activities.candidates("gym", headings=["Bicycling", "Walking"])) == ["01216", "01220", "17085", "17358"]


def test_no_headings_means_no_preference(small_table):
    assert activities.candidates("gym", headings=[]) == activities.candidates("gym")
    assert len(activities.candidates("gym")) == 5


def test_excluded_headings_are_dropped(small_table):
    """After "Did this recently" on a bike pick: anything but Bicycling."""
    assert codes(activities.candidates("gym", exclude_headings=["Bicycling"])) == ["12028", "17085", "17358"]
    assert codes(activities.candidates("gym", headings=["Bicycling", "Walking"], exclude_headings=["Bicycling"])) == ["17085", "17358"]
    # The only heading they like is the one ruled out: nothing is left.
    assert activities.candidates("gym", headings=["Bicycling"], exclude_headings=["Bicycling"]) == []


def test_met_limits(small_table):
    # No vigorous activity: under 6 MET. Exactly 6.0 (BIKE_HARD) is out.
    assert codes(activities.candidates("gym", below_met=6)) == ["01216", "17085", "17358"]
    # Light activity doesn't count toward the goal: 3 MET and up. BIRDS (2.5) is out.
    assert codes(activities.candidates("gym", min_met=3)) == ["01216", "01220", "12028", "17358"]
    assert codes(activities.candidates("gym", min_met=3, below_met=6)) == ["01216", "17358"]


def test_a_candidate_carries_every_column(small_table):
    row = activities.candidates("gym", headings=["Walking"], min_met=3)[0]

    assert row == {
        "activity_code": "17358",
        "major_heading": "Walking",
        "met_value": 4.8,
        "activity_description": "Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade",
        "intensity_high": 0, "intensity_low": 1,
        "loc_gym": 1, "at_home": 0, "loc_outside": 0,
        "needs_equipment": 1, "need_friends": 0, "exercise_rec": 1, "family": "", "type": "",
    }


def test_headings_of_turns_picked_activities_into_headings(small_table):
    assert activities.headings_of(["01216", "17358", "01220"]) == ["Bicycling", "Walking"]  # each heading once
    assert activities.headings_of(["17358", "01216"]) == ["Walking", "Bicycling"]  # in the order given
    assert activities.headings_of(["99999", "1216"]) == ["Bicycling"]  # unknown code skipped; lost zero put back
    assert activities.headings_of([]) == []


def test_the_gym_example_on_the_csv_in_the_repo():
    """Someone at the gym who picked a stationary bike, ballroom dancing and a treadmill walk before."""
    activities.load()

    liked = activities.headings_of(["01216", "03030", "17358"])
    found = activities.candidates("gym", headings=liked)

    assert liked == ["Bicycling", "Dancing", "Walking"]
    assert 0 < len(found) < len(activities.candidates("gym"))  # fewer than with no preference
    assert all(
        r["exercise_rec"] == 1 and r["loc_gym"] == 1 and r["need_friends"] == 0 and r["major_heading"] in liked
        for r in found
    )


# ---- GET /api/activities: the table, for the frontend to read ----


@pytest.fixture
def client():
    return TestClient(main.app)  # no `with`: the startup step doesn't run, so the table is what the test loaded


def test_the_api_lists_the_recommended_activities(small_table, client):
    body = client.get("/api/activities").json()

    # COACH and DESK are not recommended. BALLROOM is listed: the table is shown as it is, partner or not.
    assert codes(body["activities"]) == ["01003", "01216", "01220", "03030", "12028", "17085", "17358"]
    assert body["count"] == 7
    assert body["activities"][1] == {
        "activity_code": "01216",
        "major_heading": "Bicycling",
        "met_value": 5.0,
        "activity_description": "Bicycling, stationary, 60 watts, light to moderate effort",
        "intensity_high": 0, "intensity_low": 1,
        "loc_gym": 1, "at_home": 0, "loc_outside": 0,
        "needs_equipment": 1, "need_friends": 0, "exercise_rec": 1, "family": "", "type": "",
    }


def test_the_api_can_list_every_row(small_table, client):
    body = client.get("/api/activities", params={"recommended": "false"}).json()

    assert body["count"] == 9
    assert {"11000", "15142"} <= set(codes(body["activities"]))  # DESK and COACH


def test_the_api_filters_by_place_and_heading(small_table, client):
    def get(**params):
        return codes(client.get("/api/activities", params=params).json()["activities"])

    assert get(place="home") == ["12028", "17085"]
    assert get(heading="Bicycling") == ["01003", "01216", "01220"]
    assert get(heading=["Bicycling", "Running"]) == ["01003", "01216", "01220", "12028"]
    assert get(place="gym", heading="Bicycling") == ["01216", "01220"]
    assert get(heading="Knitting") == []


def test_the_api_rejects_a_place_the_table_does_not_have(small_table, client):
    res = client.get("/api/activities", params={"place": "office"})

    assert res.status_code == 422
    assert "Unknown place 'office'" in res.json()["detail"]
