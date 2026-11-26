"""POST /api/suggest/memory: a suggestion from today's check-in alone, the rest read from Memory.

app/memory_suggest.py builds the table route's request out of Memory and the calculator;
the route in app/main.py then hands it to /api/suggest/table.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import activities, db, main, memory, memory_suggest
from app.memory_suggest import NotEnoughMemory, build_request, duration_choices, equipment_at, week_for
from app.schemas import CheckIn

HEADER = (
    "major_heading,activity_code,met_value,activity_description,intensity_high,intensity_low,"
    "loc_gym,at_home,loc_outside,needs_equipment,need_friends,exercise_rec"
)
# Lines as they are in the real CSV (the same small table as tests/test_table_suggest.py). Indoors
# with others, 3 MET and up, no partner, this leaves six activities in four headings:
# Bicycling 01216 01220 · Dancing 03031 · Running 12028 · Walking 17352 17358
TABLE = [
    'Bicycling,01003,14.0,"Bicycling, mountain, uphill, vigorous",1,0,0,0,1,1,0,1',  # outside only
    'Bicycling,01216,5.0,"Bicycling, stationary, 60 watts, light to moderate effort",0,1,1,0,0,1,0,1',
    'Bicycling,01220,6.0,"Bicycling, stationary, 90-100 watts, moderate to vigorous",1,0,1,0,0,1,0,1',
    'Dancing,03031,9.8,"Nightclub or folk dancing, vigorous effort (e.g., nightclub, disco, folk, line dancing, Irish step dancing, polka, contra)",1,0,1,1,0,0,0,1',
    'Running,12028,6.5,"Running, 4 to 4.2 mph (13 min/mile)",0,1,1,1,1,0,0,1',
    'Walking,17085,2.5,"Bird watching, walking and stopping",0,1,1,1,1,0,0,1',  # under 3 MET
    'Walking,17352,3.5,"Walking, treadmill, 2.5 to 2.9 mph (4.0 to 4.7 km/h), 0% grade",0,1,1,0,0,1,0,1',
    'Walking,17358,4.8,"Walking, treadmill, 3.5 to 3.9 mph (5.6 to 6.3 km/h), 0% grade",0,1,1,0,0,1,0,1',
]

WEDNESDAY = date(2026, 11, 25)  # its week starts Monday 2026-11-23; last week started 2026-11-16
GYM = "indoors_with_others"
CHECK_IN = {"minutes": 45, "place": GYM, "energy": "normal", "mood": "surprise"}

# What Memory holds about Sam on Wednesday morning.
SAM = {
    "preferences": {
        "categories": {"Walking": "like", "Dancing": "dislike"},
        "equipment": {"home": ["Yoga mat"], "gym": None},
        "no_vigorous": False,
    },
    "goals": [{"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default",
               "plan": ["30", "off", "30", "off", "off", "45", "off"]}],
    "daily": {
        "workouts": [
            {"id": "w-thu", "date": "2026-11-19", "activity_code": "17358", "activity_name": "Walking, treadmill", "met": 4.8, "duration_min": 30},
            {"id": "w-mon", "date": "2026-11-23", "activity_code": "01216", "activity_name": "Bicycling, stationary", "met": 5.0, "duration_min": 30},
        ],
        "suggestions": [
            # Accepted at the gym on Monday; accepted outside last Friday.
            {"id": "a-gym", "date": "2026-11-23", "place": GYM, "activity_code": "01216", "activity_name": "Bicycling, stationary", "outcome": "accepted"},
            {"id": "a-out", "date": "2026-11-20", "place": "outside", "activity_code": "12028", "activity_name": "Running", "outcome": "accepted"},
            # "Can't access it" last week: once at the gym, once outside.
            {"id": "d-gym", "date": "2026-11-18", "place": GYM, "activity_code": "01220", "activity_name": "Bicycling, stationary, 90-100 watts", "outcome": "declined", "reason": "no-access"},
            {"id": "d-out", "date": "2026-11-18", "place": "outside", "activity_code": "17352", "activity_name": "Walking, treadmill, slow", "outcome": "declined", "reason": "no-access"},
        ],
    },
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    """A backend with its own database, the small table above, Sam in Memory, and no API key (so Jev is mocked)."""
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    csv_path = tmp_path / "activities.csv"
    csv_path.write_text("\n".join([HEADER, *TABLE]) + "\n", encoding="utf-8")
    activities.load(csv_path)
    memory.save("sam", SAM)
    return TestClient(main.app)


def built(day=WEDNESDAY, user="sam", **check_in):
    request, _numbers = build_request(user, CheckIn(**{**CHECK_IN, **check_in}), day)
    return request


def decline_today(reason, code, place=GYM, id=None):
    memory.save("sam", {"daily": {"suggestions": [{
        "id": id or f"today-{reason}", "date": WEDNESDAY.isoformat(), "place": place, "activity_code": code,
        "activity_name": f"activity {code}", "outcome": "declined", "reason": reason,
    }]}})


def suggest(client, user="sam", **more):
    return client.post("/api/suggest/memory", json={"user_id": user, "check_in": CHECK_IN, "date": "2026-11-25", **more})


def codes(data):
    return [p["activity_code"] for p in [data["lead"], *data["backups"]]]


# --- What is read from Memory ------------------------------------------------------------------


def test_todays_numbers_come_from_the_goal_the_plan_and_the_workouts_in_memory(client):
    request, numbers = build_request("sam", CheckIn(**CHECK_IN), WEDNESDAY)
    # 2.5 done on Monday (5.0 MET × 30 min). 5.0 left; Wednesday has 30 of the 75 minutes still planned.
    assert numbers["day_name"] == "Wednesday"
    assert numbers["done_this_week_met_hours"] == pytest.approx(2.5)
    assert numbers["target_met_hours"] == pytest.approx(2.0)
    assert (request.weekly_goal_met_hours, request.done_this_week_met_hours, request.left_this_week_met_hours) == (7.5, 2.5, 5.0)
    assert request.needed_met_hours == pytest.approx(2.0)
    assert request.target_met_hours == pytest.approx(2.0)
    assert request.day_name == "Wednesday"


def test_preferences_become_likes_left_out_categories_limits_and_equipment(client):
    request = built()
    assert request.liked_categories == ["Walking"]
    assert request.exclude_headings == ["Dancing"]
    assert request.limits.no_vigorous is False
    assert request.equipment_here == memory_suggest.TYPICAL_GYM  # the gym isn't listed: a typical one
    assert built(place="indoors_private").equipment_here == ["Yoga mat"]

    memory.save("sam", {"preferences": {"no_vigorous": True}})
    assert built().limits.no_vigorous is True


def test_picked_before_is_what_was_accepted_at_this_place(client):
    assert built().picked_codes == ["01216"]
    assert built(place="outside").picked_codes == ["12028"]
    assert built(place="indoors_private").picked_codes == []


def test_recently_done_is_this_week_and_last_week(client):
    memory.save("sam", {"daily": {"workouts": [
        {"id": "w-old", "date": "2026-11-15", "activity_name": "Hiking", "met": 6.0, "duration_min": 60},  # the Sunday before last week
    ]}})
    assert [(r.code, r.name, r.days_ago) for r in built().recent] == [
        ("17358", "Walking, treadmill", 6), ("01216", "Bicycling, stationary", 2),
    ]
    assert built().recent[1].family_id == "table-01216"  # the id the app gives a table activity


def test_cant_access_it_counts_at_the_place_it_was_said(client):
    at_gym = built()
    assert at_gym.exclude_codes == ["01220"]
    assert [(d.code, d.reason, d.days_ago) for d in at_gym.declines] == [("01220", "no-access", 7)]
    assert built(place="outside").exclude_codes == ["17352"]


def test_deleting_the_decline_makes_the_activity_available_again(client):
    assert memory.delete("sam", "suggestions", "d-gym")  # e.g. "forget this" in Settings
    assert built().exclude_codes == []


def test_the_time_available_gives_the_durations(client):
    assert built().durations == [10, 15, 20, 25, 30, 40, 45]
    assert built(minutes=10).durations == [10]
    assert [duration_choices(m) for m in (0, 5, 12, 60, 90)] == [[], [5], [10], memory_suggest.DURATIONS, memory_suggest.DURATIONS]


def test_a_challenge_or_wanting_more_aims_higher(client):
    assert built().boost is False
    assert built(energy="challenge").boost is True
    request, _ = build_request("sam", CheckIn(**CHECK_IN), WEDNESDAY, want_more=True)
    assert request.boost is True


# --- What a decline made today rules out -------------------------------------------------------


def test_weather_today_means_indoors_only_today(client):
    decline_today("weather", "12028")
    assert built().indoor_only is True
    assert built().constraint_notes == ["Indoors only"]
    assert built(day=date(2026, 11, 26)).indoor_only is False  # tomorrow is a new day


def test_too_tired_means_lighter_than_what_was_declined(client):
    decline_today("tired", "12028")  # running, 6.5 MET
    assert built().below_met == 6.5
    decline_today("tired", "01216", id="tired-again")  # then the 5.0 MET bike too
    assert built().below_met == 5.0
    assert built().constraint_notes == ["Lighter than 5 MET"]
    assert built().exclude_codes == ["01220"]  # "too tired" doesn't rule the activity itself out


def test_something_hurts_means_gentle_only(client):
    decline_today("hurts", "17358")
    assert built().below_met == 3.5


def test_did_this_recently_leaves_out_the_activity_and_its_category(client):
    decline_today("recent", "17358")
    request = built()
    assert request.exclude_headings == ["Dancing", "Walking"]
    assert request.exclude_codes == ["17358", "01220"]


def test_not_in_the_mood_leaves_out_only_that_activity_and_only_today(client):
    decline_today("not-mood", "12028")
    assert built().exclude_codes == ["12028", "01220"]
    assert built().exclude_headings == ["Dancing"]
    assert built(day=date(2026, 11, 26)).exclude_codes == ["01220"]


def test_a_decline_today_at_another_place_still_counts_today_but_isnt_named_here(client):
    decline_today("weather", "12028", place="outside")
    request = built()
    assert request.indoor_only is True
    assert [d.code for d in request.declines] == ["01220"]  # recently declined here: only the gym's


# --- The week's goal and plan ------------------------------------------------------------------

LAST_WEEK = {"week_start": "2026-11-16", "goal_met_hours": 9.0, "goal_set_by": "recap", "plan": ["10"] * 7}
THIS_WEEK = {"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default", "plan": ["30"] * 7}


def test_a_week_nothing_was_saved_for_carries_on_from_the_week_before():
    assert week_for([LAST_WEEK], WEDNESDAY) == {"goal_met_hours": 9.0, "plan": ["10"] * 7}
    assert week_for([LAST_WEEK, THIS_WEEK], WEDNESDAY) == {"goal_met_hours": 7.5, "plan": ["30"] * 7}
    assert week_for([LAST_WEEK, THIS_WEEK], date(2026, 11, 22)) == {"goal_met_hours": 9.0, "plan": ["10"] * 7}  # last Sunday


def test_a_week_with_a_new_goal_only_keeps_the_earlier_plan():
    only_goal = {"week_start": "2026-11-23", "goal_met_hours": 6.0, "goal_set_by": "recap", "plan": None}
    assert week_for([LAST_WEEK, only_goal], WEDNESDAY) == {"goal_met_hours": 6.0, "plan": ["10"] * 7}


def test_no_goal_or_plan_yet_is_said_plainly():
    with pytest.raises(NotEnoughMemory, match="no weekly goal and no weekly plan"):
        week_for([], WEDNESDAY)
    with pytest.raises(NotEnoughMemory, match="no weekly plan for this user"):
        week_for([{"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": None, "plan": None}], WEDNESDAY)
    with pytest.raises(NotEnoughMemory):
        week_for([{**THIS_WEEK, "week_start": "2026-11-30"}], WEDNESDAY)  # only a later week is saved


def test_equipment_that_isnt_listed_isnt_known():
    nothing = {"home": None, "gym": None}
    assert equipment_at(nothing, GYM) is None
    assert equipment_at({"home": ["Yoga mat"], "gym": ["Treadmill"]}, GYM) == ["Treadmill"]
    assert equipment_at({"home": [], "gym": None}, "indoors_private") == []
    assert equipment_at({"home": ["Yoga mat"], "gym": None}, "outside") == []


# --- The route ---------------------------------------------------------------------------------


def test_a_check_in_is_all_it_takes(client):
    res = suggest(client)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["source"] == "mock"
    assert len(codes(data)) == 3
    assert data["today"] == {
        "day_name": "Wednesday", "weekly_goal_met_hours": 7.5, "done_this_week_met_hours": 2.5,
        "left_this_week_met_hours": 5.0, "target_met_hours": pytest.approx(2.0), "done_today_met_hours": 0,
        "needed_met_hours": pytest.approx(2.0),
    }


def test_what_memory_says_decides_what_can_come_up(client):
    data = suggest(client).json()
    headings = {p["major_heading"] for p in [data["lead"], *data["backups"]]}
    assert "Dancing" not in headings  # 👎
    assert "01220" not in codes(data)  # "Can't access it" at the gym
    assert data["candidate_count"] == 4  # 01216 · 12028 · 17352 · 17358


def test_it_gives_the_same_picks_as_the_table_route_given_the_same_request(client):
    by_hand = client.post("/api/suggest/table", json=built().model_dump()).json()
    from_memory = suggest(client).json()
    assert [(p["activity_code"], p["duration_min"]) for p in [from_memory["lead"], *from_memory["backups"]]] == [
        (p["activity_code"], p["duration_min"]) for p in [by_hand["lead"], *by_hand["backups"]]
    ]


def test_each_pick_says_what_it_would_add_toward_the_goal(client):
    data = suggest(client).json()
    for pick in [data["lead"], *data["backups"]]:
        assert pick["met_hours"] == pytest.approx(pick["met_value"] * pick["duration_min"] / 60)
    # The table route leaves that to the app, as before.
    table = client.post("/api/suggest/table", json=built().model_dump()).json()
    assert "met_hours" not in table["lead"]


def test_the_check_in_is_stored_in_memory(client):
    suggest(client)
    assert memory.read("sam", ["daily"])["daily"]["check_ins"] == [{"date": "2026-11-25", **CHECK_IN}]


def test_the_request_that_was_built_is_in_the_suggestion_log(client):
    suggest(client)
    logged = db.recent_suggestions(1)[0]["request_json"]
    assert logged["liked_categories"] == ["Walking"]
    assert logged["picked_codes"] == ["01216"]
    assert logged["needed_met_hours"] == pytest.approx(2.0)


def test_declining_the_pick_then_asking_again_gives_something_else(client):
    first = suggest(client).json()["lead"]
    client.post("/api/memory?user_id=sam", json={"daily": {"suggestions": [{
        "date": "2026-11-25", "place": GYM, "activity_code": first["activity_code"],
        "activity_name": first["activity_description"], "outcome": "declined", "reason": "not-mood",
    }]}})
    again = suggest(client).json()
    assert first["activity_code"] not in codes(again)


def test_a_workout_today_lowers_what_is_still_needed(client):
    client.post("/api/memory?user_id=sam", json={"daily": {"workouts": [
        {"date": "2026-11-25", "activity_code": "17358", "activity_name": "Walking, treadmill", "met": 4.8, "duration_min": 15},  # 1.2
    ]}})
    today = suggest(client).json()["today"]
    assert today["target_met_hours"] == pytest.approx(2.0)
    assert today["done_today_met_hours"] == pytest.approx(1.2)
    assert today["needed_met_hours"] == pytest.approx(0.8)


def test_the_apps_own_numbers_are_refused(client):
    res = suggest(client, needed_met_hours=1.4, weekly_goal_met_hours=7.5)
    assert res.status_code == 422
    assert "needed_met_hours" in res.text and "weekly_goal_met_hours" in res.text


def test_a_user_with_no_goal_in_memory_gets_a_422_that_says_so(client):
    res = suggest(client, user="new")
    assert res.status_code == 422
    assert "no weekly goal and no weekly plan" in res.json()["detail"]


def test_a_date_that_isnt_one_is_a_422(client):
    res = suggest(client, date="today")
    assert res.status_code == 422
    assert "is not a date like 2026-11-23" in res.json()["detail"]


def test_without_a_date_it_is_the_backends_own_day(client):
    res = client.post("/api/suggest/memory", json={"user_id": "sam", "check_in": CHECK_IN})
    assert res.status_code in (200, 422)  # 422 only if today is a day with nothing that fits; never a crash
    assert memory.read("sam", ["daily"])["daily"]["check_ins"][-1]["date"] == date.today().isoformat()
