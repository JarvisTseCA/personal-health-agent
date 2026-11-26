"""Memory: the seven groups of what the backend remembers about a user, in SQLite (app/memory.py)."""
import copy
import json

import pytest

from app import db, memory

# One user's whole memory, in the shape save() takes and read() returns.
ALEX = {
    "who": {"name": "Alex", "fitbit_connected": True},
    "preferences": {
        "categories": {"Bicycling": "like", "Running": "dislike"},
        "equipment": {"home": ["Dumbbells", "Yoga mat"], "gym": None},
        "no_vigorous": False,
    },
    "goals": [
        {"week_start": "2026-11-23", "goal_met_hours": 7.5, "goal_set_by": "default",
         "plan": ["30", "off", "30", "10", "off", "45", "10"]},
    ],
    "daily": {
        "check_ins": [
            {"date": "2026-11-23", "minutes": 30, "place": "indoors_with_others", "energy": "normal", "mood": "surprise"},
        ],
        "suggestions": [
            {"id": "s1", "date": "2026-11-23", "place": "indoors_with_others", "activity_code": "01216",
             "activity_name": "Bicycling, stationary, 60 watts", "outcome": "accepted", "reason": None, "note": None},
            {"id": "s2", "date": "2026-11-23", "place": "indoors_with_others", "activity_code": "03030",
             "activity_name": "Ballroom dancing, fast", "outcome": "declined", "reason": "tired", "note": "long day"},
        ],
        "workouts": [
            {"id": "w1", "date": "2026-11-23", "activity_code": "01216", "activity_name": "Bicycling, stationary, 60 watts",
             "met": 5.0, "duration_min": 30, "source": "fitbit", "confirmed": False, "band": "fairly",
             "start_time": "2026-11-23T18:05:00"},
        ],
        "app_opens": ["2026-11-22", "2026-11-23"],
    },
    "health": {
        "vo2_max": [{"month": "2026-10", "ml_kg_min": 37.9, "source": "fitbit"}, {"month": "2026-11", "ml_kg_min": 38.2, "source": "fitbit"}],
        "heart_rates": [{"workout_id": "w1", "avg_bpm": 132}],
    },
    # The conversation in the Chat tab, oldest first. "reply": what kind of reply the backend's Chat route gave.
    "chat": [
        {"id": "c1", "role": "user", "text": "Is walking enough?", "at": "2026-11-23T14:03:20.000Z", "reply": None, "app": None},
        {"id": "c2", "role": "agent", "text": "Brisk walking counts.", "at": None, "reply": "model", "app": {"suggestions": ["How brisk?"]}},
    ],
    # The app's own: the backend keeps these and gives them back, and reads none of it.
    "other": {
        "today": {"step": "time", "entries": [{"id": "t1", "role": "agent", "text": "How much time today?"}]},
        "notes": [{"id": "n1", "text": "knee is sore after stairs", "where": "Today: mood", "day": 0}],
        "clinician": {"entries": [{"id": "k1", "text": "Keep it moderate for two weeks.", "at": "2026-11-23T09:30:00.000Z"}]},
    },
}

NOTHING = {
    "who": {"name": None, "fitbit_connected": None},
    "preferences": {"categories": {}, "equipment": {"home": None, "gym": None}, "no_vigorous": None},
    "goals": [],
    "daily": {"check_ins": [], "suggestions": [], "workouts": [], "app_opens": []},
    "health": {"vo2_max": [], "heart_rates": []},
    "chat": [],
    "other": {},
}


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Every test gets its own empty database, never backend/data/pha.db."""
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))


def rows(table, user_id="alex"):
    with db.session() as conn:
        return [dict(r) for r in conn.execute(f"SELECT * FROM {table} WHERE user_id = ?", (user_id,))]


# --- The shape ---------------------------------------------------------------------------------


def test_a_user_nothing_is_known_about_reads_as_the_seven_groups_empty():
    assert memory.read("nobody") == NOTHING
    assert tuple(NOTHING) == memory.GROUPS


def test_what_is_saved_reads_back_the_same():
    memory.save("alex", ALEX)
    assert memory.read("alex") == ALEX


def test_every_table_is_named_after_its_group():
    memory.save("alex", ALEX)
    with db.session() as conn:
        in_db = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'memory_%'")}
    assert in_db == set(memory.TABLES)
    for table in memory.TABLES:
        assert table.split("_")[1] in memory.GROUPS
        assert rows(table), f"{table} is empty after saving a whole memory"


def test_read_can_give_only_the_groups_named():
    memory.save("alex", ALEX)
    assert memory.read("alex", ["preferences", "daily"]) == {"preferences": ALEX["preferences"], "daily": ALEX["daily"]}


# --- What a save changes -----------------------------------------------------------------------


def test_saving_one_group_leaves_the_others_alone():
    memory.save("alex", ALEX)
    memory.save("alex", {"who": {"name": "Alexandra"}})
    after = memory.read("alex")
    assert after["who"] == {"name": "Alexandra", "fitbit_connected": True}  # fitbit_connected wasn't sent: it stays
    assert {g: after[g] for g in memory.GROUPS if g != "who"} == {g: ALEX[g] for g in memory.GROUPS if g != "who"}


def test_a_field_left_out_of_preferences_stays():
    memory.save("alex", ALEX)
    memory.save("alex", {"preferences": {"no_vigorous": True}})  # e.g. after "something hurts"
    assert memory.read("alex")["preferences"] == {**ALEX["preferences"], "no_vigorous": True}


def test_categories_are_replaced_by_what_is_sent():
    memory.save("alex", ALEX)
    memory.save("alex", {"preferences": {"categories": {"Dancing": "like", "Bicycling": "like"}}})  # 👎 on Running taken back
    assert memory.read("alex")["preferences"]["categories"] == {"Dancing": "like", "Bicycling": "like"}


def test_equipment_not_listed_is_not_the_same_as_having_nothing():
    memory.save("alex", {"preferences": {"equipment": {"home": [], "gym": None}}})
    assert memory.read("alex")["preferences"]["equipment"] == {"home": [], "gym": None}


def test_each_place_keeps_its_own_equipment():
    memory.save("alex", ALEX)
    memory.save("alex", {"preferences": {"equipment": {"gym": ["Treadmill", "Treadmill", " Stationary bike "]}}})
    assert memory.read("alex")["preferences"]["equipment"] == {
        "home": ["Dumbbells", "Yoga mat"],  # not sent: stays
        "gym": ["Treadmill", "Stationary bike"],  # a repeat is stored once, spaces trimmed
    }


def test_a_week_is_found_by_its_monday():
    memory.save("alex", ALEX)
    memory.save("alex", {"goals": [
        {"week_start": "2026-11-23", "goal_met_hours": 9, "goal_set_by": "recap"},  # the goal changes, the plan stays
        {"week_start": "2026-11-16", "goal_met_hours": 7.5, "plan": ["10"] * 7},  # an earlier week
    ]})
    assert memory.read("alex")["goals"] == [
        {"week_start": "2026-11-16", "goal_met_hours": 7.5, "goal_set_by": None, "plan": ["10"] * 7},
        {"week_start": "2026-11-23", "goal_met_hours": 9, "goal_set_by": "recap", "plan": ["30", "off", "30", "10", "off", "45", "10"]},
    ]


def test_a_goal_the_user_set_is_kept_as_theirs():
    memory.save("alex", ALEX)
    memory.save("alex", {"goals": [{"week_start": "2026-11-23", "goal_met_hours": 12, "goal_set_by": "user"}]})
    assert memory.read("alex")["goals"][0]["goal_set_by"] == "user"


def test_a_second_check_in_on_the_same_day_replaces_the_first():
    memory.save("alex", ALEX)
    memory.save("alex", {"daily": {"check_ins": [
        {"date": "2026-11-23", "minutes": 10, "place": "outside", "energy": "low", "mood": "surprise"},
        {"date": "2026-11-24", "minutes": 45, "place": "indoors_private", "energy": "challenge", "mood": "cycling"},
    ]}})
    assert memory.read("alex")["daily"]["check_ins"] == [
        {"date": "2026-11-23", "minutes": 10, "place": "outside", "energy": "low", "mood": "surprise"},
        {"date": "2026-11-24", "minutes": 45, "place": "indoors_private", "energy": "challenge", "mood": "cycling"},
    ]


def test_a_workout_sent_again_is_updated_not_added_twice():
    memory.save("alex", ALEX)
    confirmed = {**ALEX["daily"]["workouts"][0], "confirmed": True, "duration_min": 35}
    memory.save("alex", {"daily": {"workouts": [confirmed]}})
    assert memory.read("alex")["daily"]["workouts"] == [confirmed]
    assert memory.read("alex")["daily"]["suggestions"] == ALEX["daily"]["suggestions"]  # not sent: stay


def test_a_workout_needs_little_and_gets_an_id():
    memory.save("alex", {"daily": {"workouts": [{"date": "2026-11-23", "activity_name": "Walking", "met": 3.5, "duration_min": 20}]}})
    (workout,) = memory.read("alex")["daily"]["workouts"]
    assert workout["id"]
    assert {**workout, "id": None} == {
        "id": None, "date": "2026-11-23", "activity_code": None, "activity_name": "Walking", "met": 3.5,
        "duration_min": 20, "source": "manual", "confirmed": True, "band": None, "start_time": None,
    }


def test_a_code_gets_its_leading_zero_back():
    memory.save("alex", {"daily": {"suggestions": [
        {"date": "2026-11-23", "activity_code": 1216, "activity_name": "Bicycling, stationary", "outcome": "accepted"},
    ]}})
    assert memory.read("alex")["daily"]["suggestions"][0]["activity_code"] == "01216"


def test_a_vo2_max_reading_is_found_by_its_month():
    memory.save("alex", ALEX)
    memory.save("alex", {"health": {"vo2_max": [{"month": "2026-11", "ml_kg_min": 38.6}]}})
    assert memory.read("alex")["health"]["vo2_max"] == [
        {"month": "2026-10", "ml_kg_min": 37.9, "source": "fitbit"},
        {"month": "2026-11", "ml_kg_min": 38.6, "source": "fitbit"},
    ]


def test_a_day_the_app_was_opened_is_kept_once_and_days_come_back_oldest_first():
    memory.save("alex", ALEX)  # opened on the 22nd and the 23rd
    memory.save("alex", {"daily": {"app_opens": ["2026-11-25", "2026-11-23", "2026-11-20"]}})
    daily = memory.read("alex")["daily"]
    assert daily["app_opens"] == ["2026-11-20", "2026-11-22", "2026-11-23", "2026-11-25"]
    assert daily["check_ins"] == ALEX["daily"]["check_ins"]  # not sent: stay


def test_other_comes_back_exactly_as_it_was_sent():
    kept = {
        "today": {"step": "suggested", "nudged": False, "entries": [{"id": "t1", "role": "agent", "text": "How much time today? ⏱️"}]},
        "chat": [],
        "painReports": 2,
        "fitbitWeek": None,
        "tableActivities": {"01216": {"met": 5.0, "tags": ["indoor", "bike"], "deeper": {"mixed": [1, 2.5, True, None, "一"]}}},
    }
    memory.save("sam", {"other": kept})
    got = memory.read("sam")["other"]
    assert got == kept
    assert json.dumps(got, sort_keys=True) == json.dumps(kept, sort_keys=True)  # true stays true, 5.0 stays 5.0


def test_a_name_in_other_sent_again_replaces_only_that_name():
    memory.save("alex", ALEX)
    memory.save("alex", {"other": {"notes": []}})  # e.g. the user took their note back
    assert memory.read("alex")["other"] == {**ALEX["other"], "notes": []}
    assert len(rows("memory_other")) == len(ALEX["other"])


def test_what_the_app_keeps_under_one_name_can_be_taken_out():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "other", "notes") is True  # the app keeps nothing under this name any more
    assert memory.read("alex")["other"] == {name: kept for name, kept in ALEX["other"].items() if name != "notes"}
    assert memory.delete("alex", "other", "notes") is False


# --- The conversation in the Chat tab ----------------------------------------------------------


def test_a_new_chat_message_goes_after_the_ones_already_there():
    memory.save("alex", ALEX)
    memory.save("alex", {"chat": [{"id": "c3", "role": "user", "text": "How brisk?", "at": "2026-11-23T14:05:00.000Z"}]})
    assert [m["id"] for m in memory.read("alex")["chat"]] == ["c1", "c2", "c3"]
    assert memory.read("alex", ["chat"])["chat"][:2] == ALEX["chat"]  # not sent: stay as they were


def test_a_chat_message_sent_again_is_updated_and_keeps_its_place():
    memory.save("alex", ALEX)
    memory.save("alex", {"chat": [{"id": "c1", "role": "user", "text": "Is walking enough for my goal?"}]})
    chat = memory.read("alex")["chat"]
    assert [m["id"] for m in chat] == ["c1", "c2"]
    assert chat[0] == {"id": "c1", "role": "user", "text": "Is walking enough for my goal?", "at": None, "reply": None, "app": None}


def test_a_chat_message_needs_only_who_said_it_and_the_words():
    memory.save("sam", {"chat": [{"role": "user", "text": "Hello"}, {"role": "agent", "text": ""}]})
    hello, empty = memory.read("sam")["chat"]
    assert (hello["role"], hello["text"], hello["at"], hello["reply"], hello["app"]) == ("user", "Hello", None, None, None)
    assert hello["id"] and empty["id"] and hello["id"] != empty["id"]  # each got an id of its own
    assert empty["text"] == ""


def test_the_conversation_has_no_limit():
    many = [{"id": f"m{i}", "role": "user" if i % 2 == 0 else "agent", "text": f"message {i}"} for i in range(500)]
    memory.save("sam", {"chat": many})
    assert [m["id"] for m in memory.read("sam")["chat"]] == [m["id"] for m in many]


def test_what_the_app_keeps_with_a_message_comes_back_as_it_was_sent():
    kept = {"suggestions": ["Add strength training", "What should I do today?"], "kind": "offer-strength", "deeper": [1, 2.5, True, None, "一"]}
    memory.save("sam", {"chat": [{"id": "a1", "role": "agent", "text": "Want me to add it?", "app": kept}]})
    assert memory.read("sam")["chat"][0]["app"] == kept


def test_one_chat_message_can_be_deleted_and_the_rest_stays():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "chat", "c2") is True  # e.g. the user edited the message before it
    assert memory.read("alex")["chat"] == ALEX["chat"][:1]
    assert memory.delete("alex", "chat", "c2") is False


def test_forgetting_a_user_takes_the_conversation_too():
    memory.save("alex", ALEX)
    memory.clear("alex")
    assert memory.read("alex")["chat"] == []


# --- Taking one entry out ----------------------------------------------------------------------


def test_one_decline_can_be_deleted_and_the_rest_stays():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "suggestions", "s2") is True  # e.g. forgetting a decline in Settings
    daily = memory.read("alex")["daily"]
    assert [s["id"] for s in daily["suggestions"]] == ["s1"]
    assert daily["workouts"] == ALEX["daily"]["workouts"]
    assert daily["check_ins"] == ALEX["daily"]["check_ins"]


def test_deleting_a_workout_takes_its_heart_rate_too():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "workouts", "w1") is True
    after = memory.read("alex")
    assert after["daily"]["workouts"] == []
    assert after["health"] == {"vo2_max": ALEX["health"]["vo2_max"], "heart_rates": []}


def test_a_check_in_is_deleted_by_its_date():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "check_ins", "2026-11-23") is True
    assert memory.read("alex")["daily"]["check_ins"] == []


def test_deleting_what_is_not_there_says_so_and_changes_nothing():
    memory.save("alex", ALEX)
    assert memory.delete("alex", "suggestions", "no-such-id") is False
    assert memory.delete("sam", "suggestions", "s1") is False  # s1 is Alex's, not Sam's
    assert memory.read("alex") == ALEX


def test_only_some_kinds_of_entry_can_be_deleted_one_by_one():
    with pytest.raises(memory.MemoryDataError, match="can't delete from 'vo2_max'"):
        memory.delete("alex", "vo2_max", "2026-11")


# --- Users -------------------------------------------------------------------------------------


def test_users_are_kept_apart_and_clear_forgets_only_one():
    memory.save("alex", ALEX)
    memory.save("sam", {"who": {"name": "Sam"}, "preferences": {"categories": {"Walking": "like"}}})
    assert memory.read("alex") == ALEX
    assert memory.read("sam")["preferences"]["categories"] == {"Walking": "like"}

    memory.clear("alex")
    assert memory.read("alex") == NOTHING
    assert memory.read("sam")["who"]["name"] == "Sam"
    for table in memory.TABLES:
        assert rows(table) == []


def test_forgetting_a_user_takes_the_opened_days_and_other_too():
    memory.save("alex", ALEX)
    memory.clear("alex")
    after = memory.read("alex")
    assert after["daily"]["app_opens"] == []
    assert after["other"] == {}


def test_memory_and_the_saved_app_state_dont_touch_each_other():
    db.save_state("alex", {"version": 2, "goal": 7.5})
    memory.save("alex", ALEX)
    memory.clear("alex")
    assert db.load_state("alex") == {"version": 2, "goal": 7.5}


# --- Mistakes ----------------------------------------------------------------------------------


def changed(group, change):
    """ALEX with one thing changed in a group; `change` gets a copy of that group to edit."""
    part = copy.deepcopy(ALEX[group])
    change(part)
    return {group: part}


MISTAKES = [
    ({"profile": {}}, "unknown group(s) profile"),
    ({"who": {"name": "Alex", "age": 40}}, "who: unknown field(s) age"),
    ({"who": {"fitbit_connected": "yes"}}, "who.fitbit_connected is 'yes', expected true or false"),
    (changed("preferences", lambda p: p["categories"].update(Dancing="love")), "'Dancing' is 'love', expected like or dislike"),
    (changed("preferences", lambda p: p["equipment"].update(office=["Desk bike"])), "preferences.equipment should look like"),
    (changed("preferences", lambda p: p["equipment"].update(home="Dumbbells")), "preferences.equipment.home should be a list"),
    (changed("goals", lambda g: g[0].update(plan=["30"] * 6)), "goals[0].plan should be 7 days"),
    (changed("goals", lambda g: g[0].update(plan=["20"] * 7)), "goals[0].plan should be 7 days"),
    (changed("goals", lambda g: g[0].update(week_start="2026-11-24")), "goals[0].week_start 2026-11-24 is not a Monday"),
    (changed("goals", lambda g: g[0].update(goal_met_hours=0)), "goals[0].goal_met_hours is 0, expected a number above 0"),
    (changed("goals", lambda g: g[0].update(goal_set_by="coach")), "goals[0].goal_set_by is 'coach'"),
    (changed("daily", lambda d: d["check_ins"][0].update(date="Monday")), "daily.check_ins[0]: 'Monday' is not a date like 2026-11-23"),
    (changed("daily", lambda d: d["suggestions"][1].update(outcome="skipped")), "daily.suggestions[1].outcome is 'skipped'"),
    (changed("daily", lambda d: d["suggestions"][0].pop("activity_name")), "daily.suggestions[0]: activity_name is required"),
    (changed("daily", lambda d: d["workouts"][0].update(met=0)), "daily.workouts[0].met is 0, expected a number above 0"),
    (changed("daily", lambda d: d["workouts"][0].update(source="strava")), "daily.workouts[0].source is 'strava'"),
    (changed("daily", lambda d: d.update(workouts={"id": "w1"})), "daily.workouts should be a list"),
    (changed("daily", lambda d: d["app_opens"].append("yesterday")), "daily.app_opens[2]: 'yesterday' is not a date like 2026-11-23"),
    (changed("daily", lambda d: d.update(app_opens="2026-11-23")), "daily.app_opens should be a list"),
    (changed("health", lambda h: h["vo2_max"][0].update(month="November")), "health.vo2_max[0]: 'November' is not a month like 2026-11"),
    (changed("health", lambda h: h["heart_rates"][0].pop("avg_bpm")), "health.heart_rates[0]: avg_bpm is required"),
    (changed("chat", lambda c: c[0].update(role="assistant")), "chat[0].role is 'assistant', expected user or agent"),
    (changed("chat", lambda c: c[0].pop("role")), "chat[0]: role is required"),
    (changed("chat", lambda c: c[1].update(text=None)), "chat[1].text should be the words of the message"),
    (changed("chat", lambda c: c[1].update(reply="scripted")), "chat[1].reply is 'scripted'"),
    (changed("chat", lambda c: c[0].update(at="this morning")), "chat[0].at: 'this morning' is not a time like 2026-11-23T14:03:20Z"),
    (changed("chat", lambda c: c[0].update(at=1795478400000)), "chat[0].at: 1795478400000 is not a time"),
    (changed("chat", lambda c: c[1].update(app={"suggestions": {"a", "b"}})), "chat[1].app can't be kept"),  # a Python set
    (changed("chat", lambda c: c[0].update(suggestions=["Hi"])), "chat[0]: unknown field(s) suggestions"),
    ({"chat": {"c1": "Hello"}}, "chat should be a list"),
    ({"other": ["notes"]}, "other should be an object"),
    ({"other": {"": []}}, "other: '' can't be a name"),
    ({"other": {"notes": {"n1", "n2"}}}, "other.notes can't be kept"),  # a Python set
    ({"other": {"vo2": float("nan")}}, "other.vo2 can't be kept"),
]


@pytest.mark.parametrize("bad, message", MISTAKES, ids=[m for _, m in MISTAKES])
def test_a_mistake_is_named(bad, message):
    with pytest.raises(memory.MemoryDataError) as error:
        memory.save("alex", bad)
    assert message in str(error.value)


def test_a_save_with_a_mistake_stores_nothing():
    memory.save("alex", ALEX)
    with pytest.raises(memory.MemoryDataError):
        memory.save("alex", {
            "who": {"name": "Changed"},  # fine on its own
            "preferences": {"categories": {"Walking": "like"}, "equipment": {"home": "none"}},  # the mistake comes last
        })
    assert memory.read("alex") == ALEX


def test_read_says_when_a_group_does_not_exist():
    with pytest.raises(memory.MemoryDataError, match="unknown group"):
        memory.read("alex", ["likes"])
