"""The first check on a Chat message: the urgent-symptom keywords in a CSV (app/chat_rules.py)."""
import pytest

from app import chat_rules
from app.chat_rules import KeywordFileError, Match

HEADER = "group,text,together_with"
# A short list in the same shape as the one in the repo, so these tests don't depend on what that list says.
CHEST = "chest,chest | heart,pain | pressure | tight"
ARM = "arm or jaw,arm | jaw,numb | tingling"
BREATHE = "breathing,can't breathe,"
PASSED_OUT = "fainting,passed out,"
SEIZURE = "other,seizure,"
SELF_HARM = "crisis,self-harm,"
WANT_TO_DIE = "crisis,want to die,"
LINES = [CHEST, ARM, BREATHE, PASSED_OUT, SEIZURE, SELF_HARM, WANT_TO_DIE]


def write_csv(tmp_path, *lines, header=HEADER, newline="\n", encoding="utf-8"):
    path = tmp_path / "keywords.csv"
    path.write_bytes((newline.join([header, *lines]) + newline).encode(encoding))
    return path


@pytest.fixture
def keywords(tmp_path):
    return chat_rules.read_csv(write_csv(tmp_path, *LINES))


# --- What stops a message ---------------------------------------------------


def test_a_phrase_stops_a_message_that_has_it(keywords):
    assert chat_rules.check("I almost passed out on the treadmill", keywords) == Match(
        group="fainting", matched="passed out",
    )


@pytest.mark.parametrize("message", [
    "What's a good breathing rhythm for running?",
    "My legs are a bit sore after yesterday, is that normal?",
    "My knee hurts when I run",
    "Does my heart rate zone matter?",
    "",
])
def test_a_message_without_a_keyword_goes_on(keywords, message):
    assert chat_rules.check(message, keywords) is None


@pytest.mark.parametrize("message", [
    "I CAN'T BREATHE",
    "I can’t breathe properly",  # the curly ’ a phone types
    "i cant breathe",
])
def test_case_and_apostrophes_do_not_matter(keywords, message):
    assert chat_rules.check(message, keywords).matched == "can't breathe"


@pytest.mark.parametrize("message", ["I think about self-harm", "I think about self harm"])
def test_a_hyphen_reads_as_a_space(keywords, message):
    assert chat_rules.check(message, keywords).group == "crisis"


def test_a_phrase_matches_whole_words(keywords):
    assert chat_rules.check("I want to diet and lose some weight", keywords) is None
    assert chat_rules.check("Some days I want to die", keywords).matched == "want to die"


def test_a_plural_counts_and_other_endings_do_not(keywords):
    assert chat_rules.check("I had two seizures last year", keywords).matched == "seizure"
    assert chat_rules.check("I was passing out", keywords) is None  # needs its own line in the CSV


def test_a_pair_needs_both_words_in_the_same_sentence(keywords):
    assert chat_rules.check("I felt pressure in my chest during my ride", keywords) == Match(
        group="chest", matched="chest + pressure",
    )
    assert chat_rules.check("What's a good chest workout at the gym?", keywords) is None
    assert chat_rules.check("Chest day went well. I felt some pressure to finish early.", keywords) is None


def test_a_pair_matches_the_start_of_the_symptom_word(keywords):
    assert chat_rules.check("There's a tightness around my heart on the stairs", keywords).matched == "heart + tightness"
    # "press" doesn't start with "pressure", so a chest press goes on.
    assert chat_rules.check("How many chest press sets should I do?", keywords) is None


def test_a_pair_counts_a_plural_body_word_but_not_a_longer_word(keywords):
    assert chat_rules.check("Both arms are tingling", keywords).matched == "arms + tingling"
    assert chat_rules.check("My armband is numb to the touch", keywords) is None


def test_the_first_line_in_the_file_that_matches_is_reported(tmp_path):
    message = "I want to die, my chest is in pain"

    chest_first = chat_rules.read_csv(write_csv(tmp_path, CHEST, WANT_TO_DIE))
    crisis_first = chat_rules.read_csv(write_csv(tmp_path, WANT_TO_DIE, CHEST))

    assert chat_rules.check(message, chest_first).group == "chest"
    assert chat_rules.check(message, crisis_first).group == "crisis"


def test_every_stopped_message_gets_the_urgent_reply():
    """The list has no reply column: one reply for every keyword, named here for the route that will use it."""
    assert chat_rules.REPLY == "urgent"


# --- Reading the CSV --------------------------------------------------------


def test_the_list_in_the_repo_loads():
    """Whatever the list says today, every line of it can be read. An edit that breaks a line fails here."""
    keywords = chat_rules.read_csv()

    assert chat_rules.CSV_PATH.name == "urgent_keywords.csv"
    assert len(keywords) > 0
    assert all(k.group and k.words for k in keywords)


def test_a_line_is_a_pair_when_together_with_is_filled(keywords):
    """There is no column that says phrase or pair: together_with says it."""
    assert [(k.group, bool(k.starts)) for k in keywords] == [
        ("chest", True), ("arm or jaw", True), ("breathing", False), ("fainting", False),
        ("other", False), ("crisis", False), ("crisis", False),
    ]
    assert keywords[0].words == ("chest", "heart")
    assert keywords[0].starts == ("pain", "pressure", "tight")
    assert keywords[3].words == ("passed", "out")


def test_columns_can_be_in_any_order_and_extra_columns_are_ignored(tmp_path):
    path = write_csv(tmp_path, "passed out,a comment,,fainting", header="text,note,together_with,group")

    assert chat_rules.check("I passed out", chat_rules.read_csv(path)).group == "fainting"


def test_a_csv_saved_from_excel_loads(tmp_path):
    """Excel adds a hidden mark at the start, ends lines with \\r\\n and can leave empty lines."""
    path = write_csv(tmp_path, PASSED_OUT, ",,", BREATHE, newline="\r\n", encoding="utf-8-sig")

    assert [k.text for k in chat_rules.read_csv(path)] == ["passed out", "can't breathe"]


@pytest.mark.parametrize("line, problem", [
    ("fainting,,", "text is empty"),
    ("chest,,pain | pressure", "text is empty"),
    ("chest,chest | heart,|", "together_with has no words"),
    ("chest,left arm,numb", "'left arm' is more than one; leave together_with empty for a phrase"),
    (",passed out,", "group can't be empty"),
])
def test_a_wrong_line_is_named(tmp_path, line, problem):
    path = write_csv(tmp_path, PASSED_OUT, line)

    with pytest.raises(KeywordFileError) as error:
        chat_rules.read_csv(path)

    assert "keywords.csv line 3" in str(error.value)
    assert problem in str(error.value)


def test_a_missing_column_is_named(tmp_path):
    path = write_csv(tmp_path, "fainting,passed out", header="group,text")

    with pytest.raises(KeywordFileError, match=r"missing column\(s\): together_with"):
        chat_rules.read_csv(path)


def test_a_missing_file_and_an_empty_file_are_errors(tmp_path):
    with pytest.raises(KeywordFileError, match="not found"):
        chat_rules.read_csv(tmp_path / "nowhere.csv")
    with pytest.raises(KeywordFileError, match="has no keywords"):
        chat_rules.read_csv(write_csv(tmp_path))
