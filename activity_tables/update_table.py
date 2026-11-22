"""Fix rows of the activity table and fill in its `family` and `type` columns.

    python activity_tables/update_table.py [path/to/table.csv]

Without a path it updates activity_tables/2024_compendium_exercise_recommendations.csv
in place. Running it again changes nothing.

- `ROW_FIXES` lists every hand fix, by Compendium code, with the reason.
- `family` is the movement itself (running, cycling_indoor, swimming, ...): two rows
  with the same family are the same activity at different efforts.
- `type` is the kind of workout (cardio, strength, mind_body, water, ...).
Both come from the rules below, in order; the first rule that matches wins.
The backend ignores both columns for now; they are for the similarity check.
"""
import csv
import re
import sys
from pathlib import Path

DEFAULT_CSV = Path(__file__).resolve().parent / "2024_compendium_exercise_recommendations.csv"

# ---------------------------------------------------------------- row fixes

NOT_EXERCISE = "not something to coach as exercise"
ROW_FIXES = {
    # Daily living, chores and riding as a passenger: exercise_rec 1 -> 0.
    **{code: ({"exercise_rec": "0"}, NOT_EXERCISE) for code in [
        "17140", "17142",          # using crutches
        "17145",                   # using a medical knee scooter
        "17105",                   # pushing a wheelchair
        "18012",                   # power boating, passenger
        "19006",                   # dog sledding, passenger
        "19202",                   # snowmobiling, passenger
        "15408",                   # horse cart, driving, standing or sitting
        "02135",                   # whirlpool, sitting
        "19011",                   # ice fishing
        "17016", "17018", "17019", # carrying loads (suitcase, boxes, furniture, feed)
        "17021",                   # carrying a child, slow walking
        "17025", "17026", "17027", "17028", "17029", "17030",  # carrying loads upstairs
        "17031",                   # loading or unloading a car
        "17076",                   # hauling water on the head
    ]},
    # Rows with no place marked, so they could never be suggested.
    **{code: ({"loc_outside": "1"}, "done outside") for code in [
        "01070",                   # unicycling
        "01080", "01084", "01088", # e-bike
    ]},
    **{code: ({"loc_gym": "1"}, "a gym machine") for code in [
        "18114",                   # rowing ergometer on slides
        "19045", "19046", "19047", "19048",  # skating treadmill
    ]},
    **{code: ({"at_home": "1"}, "played at home") for code in [
        "22200", "22240", "22280", "22320", "22360",  # active video games, VR fitness
    ]},
    # Running at a set pace, uphill, downhill or with a stroller can't be done at home
    # (it stays at the gym, on a treadmill, and outside). Jogging in place, on a
    # mini-trampoline and running up stairs stay at home.
    **{code: ({"at_home": "0"}, "needs a track, road or treadmill") for code in [
        "12010", "12020", "12026", "12028", "12029", "12030", "12045", "12050", "12060",
        "12070", "12080", "12090", "12100", "12110", "12115", "12120", "12130", "12132",
        "12134", "12135", "12145", "12150", "12255", "12260", "12265", "12325", "12335",
        "12337", "12339", "12341", "12343", "12345", "12350", "12352", "12353", "12355",
        "12358", "12361", "12508", "12510", "12512", "12514", "12555", "12560", "12565",
        "12585", "12588", "12593", "12595", "12620",
    ]},
}

# ---------------------------------------------------------------- family

# (pattern on the description, family). Order matters: the first match wins.
FAMILY_RULES = [
    (r"water (aerobics|jogging|running|walking)|water calisthenics|aquatic cycling", "water_fitness"),
    (r"^water polo|^water volleyball", "water_team_game"),
    (r"swimming|treading water", "swimming"),
    (r"canoe|kayak|paddle ?board|paddleboard|surfboard, paddling|rowing, simulated crew|single scull|canoeing or rowing|paddle boat|whitewater", "paddling"),
    (r"^rowing, stationary|^rowing, single scull, ergometer", "rowing_machine"),
    (r"bicycling, stationary|spin bike|indoor cycle|bicycling, (concentric|eccentric)", "cycling_indoor"),
    (r"^bicycling|^e-bike|^unicycling", "cycling_outdoor"),
    (r"treadmill", "treadmill"),
    (r"^running|^jogging|^jog/walk|^skipping|^triathlon", "running"),
    (r"race walking", "race_walking"),
    (r"stair climbing|stair treadmill|carrying load upstairs|descending stairs|carrying load, .*upstairs", "stairs"),
    (r"nordic walking", "nordic_walking"),
    (r"hiking|backpacking|climbing hills|bird watching", "hiking"),
    (r"^walking|marching|stroller|carrying|loading|using crutches|knee scooter|wheelchair|hauling water", "walking"),
    (r"rope (jumping|skipping)|jumping rope", "jump_rope"),
    (r"elliptical", "elliptical"),
    (r"ski (machine|ergometer)", "ski_machine"),
    (r"arm ergometer|upper body exercise|airdyne", "arm_ergometer"),
    (r"yoga", "yoga"),
    (r"pilates", "pilates"),
    (r"stretching", "stretching"),
    (r"tai chi", "tai_chi"),
    (r"high intensity interval|tabata|circuit training|boot camp|obstacle", "hiit_circuit"),
    (r"resistance|weight lifting|kettle ?bell|body weight|calisthenics|sit to stand|curves|impulse training|wand exercise|exercise ball", "strength"),
    (r"shuttle running|slide board", "hiit_circuit"),
    (r"native new zealander|cheerleading", "dance"),
    (r"zumba|aerobic dance|aerobic, |bench step|jazzercise|slimnastics|pound,|hooping|pole dancing|teaching exercise", "aerobics_class"),
    (r"virtual reality|exercube|blackbox|video game|exergam", "active_gaming"),
    (r"video, exercise|home exercise|health club", "general_workout"),
    (r"boxing|kickboxing|martial arts|taekwondo|judo|kendo|kung fu|wrestling|fencing", "combat"),
    (r"tennis|badminton|squash|racquetball|paddleball|table tennis|handball|jai alai|wallyball", "racket_court"),
    (r"basketball|soccer|football|hockey|lacrosse|rugby|softball|volleyball|cricket|netball|kickball|futsal|floorball|broomball|polo", "team_ball"),
    (r"golf|bowling|billiards|darts|archery|croquet|shuffleboard|horseshoe|lawn bowling|curling", "precision"),
    (r"frisbee|hacky sack|juggling|children.s games", "play"),
    (r"rock climbing|rock or mountain|prusik|high ropes|mountaineering|rappelling", "climbing"),
    (r"skating, ice|ice dancing|skating, speed|skating treadmill", "ice_skating"),
    (r"skating, roller|roller ?blading|skateboard", "skating_wheels"),
    (r"skiing, water|wake ?board", "board_sail"),
    (r"skiing, cross|cross-country|biathlon|rollerski|skiing, roller", "xc_skiing"),
    (r"skiing|snowboard|slalom|ski jumping", "downhill_snow"),
    (r"snow ?shoe", "snowshoeing"),
    (r"horse", "horseback"),
    (r"surfing|windsurf|kitesurf|sailing", "board_sail"),
    (r"scuba|skindiving|snorkel|diving", "diving"),
]


def slug(text):
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def exercise_family(row):
    d = row["activity_description"].lower()
    if row["major_heading"] == "Dancing":
        return "dance"
    for pattern, fam in FAMILY_RULES:
        if re.search(pattern, d):
            if fam == "treadmill":  # a treadmill splits by what you do on it
                return "running" if re.search(r"running|jogging", d) else "walking"
            return fam
    return slug(re.split(r"[,(]", d)[0])


def family(row):
    if row["exercise_rec"] == "1":
        return exercise_family(row)
    # Rows not recommended: only the plainest movements get an exercise family;
    # everything else is named by its own first phrase.
    d = row["activity_description"].lower()
    if re.match(r"walking|walk ", d):
        return "walking"
    if re.match(r"bicycling|e-bike", d):
        return "cycling_outdoor"
    return slug(re.split(r"[,(;:]", d)[0])

# ---------------------------------------------------------------- type

TYPE_OF_FAMILY = {
    **dict.fromkeys(["running", "race_walking", "walking", "hiking", "nordic_walking", "stairs", "treadmill",
                     "cycling_outdoor", "cycling_indoor", "rowing_machine", "elliptical", "ski_machine",
                     "jump_rope", "arm_ergometer"], "cardio"),
    "strength": "strength",
    **dict.fromkeys(["hiit_circuit", "general_workout"], "hiit_circuit"),
    **dict.fromkeys(["yoga", "pilates", "stretching", "tai_chi"], "mind_body"),
    "aerobics_class": "dance_aerobics",
    "dance": "dance_aerobics",
    **dict.fromkeys(["swimming", "water_fitness", "paddling", "water_team_game", "board_sail", "diving"], "water"),
    **dict.fromkeys(["xc_skiing", "downhill_snow", "snowshoeing", "ice_skating"], "snow_ice"),
    **dict.fromkeys(["racket_court", "team_ball"], "ball_racket_sport"),
    "combat": "combat",
    **dict.fromkeys(["precision", "play"], "skill_play"),
    **dict.fromkeys(["climbing", "skating_wheels", "horseback"], "adventure"),
    "active_gaming": "active_gaming",
}
TYPE_OF_HEADING = {
    "Dancing": "dance_aerobics", "Water Activities": "water", "Winter Activities": "snow_ice",
    "Video Games": "active_gaming", "Sports": "other_sport", "Walking": "cardio",
    "Running": "cardio", "Bicycling": "cardio", "Conditioning Exercise": "other",
}
NON_EXERCISE_TYPE = {
    "Home Activities": "household", "Home Repair": "household", "Lawn & Garden": "yard_garden",
    "Occupation": "work", "Inactivity": "inactive", "Self Care": "daily_living", "Miscellaneous": "daily_living",
    "Religious Activities": "daily_living", "Volunteer Activities": "daily_living", "Music Playing": "music",
    "Fishing & Hunting": "fishing_hunting", "Sexual Activity": "other", "Transportation": "transportation",
    "Video Games": "active_gaming", "Sports": "other",
}


def workout_type(row):
    fam = family(row)
    if row["exercise_rec"] == "1":
        return TYPE_OF_FAMILY.get(fam, TYPE_OF_HEADING.get(row["major_heading"], "other"))
    if fam in ("walking", "cycling_outdoor"):
        return "cardio"
    return NON_EXERCISE_TYPE.get(row["major_heading"], "other")

# ---------------------------------------------------------------- main


def update(path=DEFAULT_CSV):
    path = Path(path)
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        columns = [c for c in reader.fieldnames if c not in ("family", "type")]
        rows = list(reader)

    by_code = {r["activity_code"].zfill(5): r for r in rows}
    unknown = sorted(set(ROW_FIXES) - set(by_code))
    if unknown:
        raise SystemExit(f"{path.name}: no row with code(s) {', '.join(unknown)}")

    changed = 0
    for code, (fix, _reason) in ROW_FIXES.items():
        row = by_code[code]
        for column, value in fix.items():
            if row[column] != value:
                row[column] = value
                changed += 1

    for row in rows:
        row["family"] = family(row)
        row["type"] = workout_type(row)

    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns + ["family", "type"], lineterminator="\n")
        writer.writeheader()
        writer.writerows({c: r[c] for c in columns + ["family", "type"]} for r in rows)
    return changed


if __name__ == "__main__":
    n = update(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV)
    print(f"{n} value(s) fixed; family and type written.")
