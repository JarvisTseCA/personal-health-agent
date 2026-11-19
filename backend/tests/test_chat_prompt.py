"""The system prompt for the model that writes the Chat reply (app/chat_prompt.py)."""
import pytest

from app import chat_prompt, chat_replies
from app.chat_prompt import BriefFileError

BRIEF = (
    "You are the Chat assistant.\n"
    "Urgent: [urgent reply]\n"
    "Medical: [medical_advice reply]\n"
    "Off topic: [off_topic reply]\n"
)
REPLIES = {"urgent": "Call 911.", "medical_advice": "Ask your clinician.", "off_topic": "Outside what I can help with."}


def write_brief(tmp_path, text, encoding="utf-8"):
    path = tmp_path / "chat_brief.txt"
    path.write_bytes(text.encode(encoding))
    return path


def test_the_fixed_replies_go_into_the_brief_and_the_apps_notes_come_after():
    system = chat_prompt.build_system(BRIEF.strip(), REPLIES, "  User context (JSON): {…}  ")

    assert system == (
        "You are the Chat assistant.\n"
        "Urgent: Call 911.\n"
        "Medical: Ask your clinician.\n"
        "Off topic: Outside what I can help with."
        f"\n\n{chat_prompt.APP_NOTES}\n\n"
        "User context (JSON): {…}"
    )


@pytest.mark.parametrize("app_system", ["", "   ", None])
def test_without_app_notes_the_prompt_is_the_brief_alone(app_system):
    system = chat_prompt.build_system(BRIEF.strip(), REPLIES, app_system)

    assert system.endswith("Off topic: Outside what I can help with.")
    assert chat_prompt.APP_NOTES not in system


def test_the_brief_in_the_repo_has_a_place_for_every_fixed_reply():
    """Whatever the brief says today: it loads, and each reply in the repo ends up in the prompt word for word."""
    replies = chat_replies.read_csv()

    system = chat_prompt.build_system(chat_prompt.read_brief(), replies)

    assert chat_prompt.BRIEF_PATH.name == "chat_brief.txt"
    assert all(text in system for text in replies.values())
    assert not any(marker in system for marker in chat_prompt.MARKERS.values())


def test_a_brief_is_read_without_the_space_around_it(tmp_path):
    path = write_brief(tmp_path, "\n\n" + BRIEF + "\n\n", encoding="utf-8-sig")  # the hidden mark some editors add

    assert chat_prompt.read_brief(path) == BRIEF.strip()


@pytest.mark.parametrize("text, problem", [
    ("", "chat_brief.txt is empty"),
    ("   \n", "chat_brief.txt is empty"),
    ("Just be helpful.", "no place for: [urgent reply], [medical_advice reply], [off_topic reply]"),
    (BRIEF.replace("[medical_advice reply]", "[medical reply]"), "no place for: [medical_advice reply]"),
])
def test_a_brief_that_cannot_be_used_says_why(tmp_path, text, problem):
    with pytest.raises(BriefFileError) as error:
        chat_prompt.read_brief(write_brief(tmp_path, text))

    assert problem in str(error.value)


def test_a_missing_brief_is_an_error(tmp_path):
    with pytest.raises(BriefFileError, match="not found"):
        chat_prompt.read_brief(tmp_path / "nowhere.txt")
