"""The fixed replies of the Chat tab: the wording in a CSV (app/chat_replies.py)."""
import pytest

from app import chat_gate, chat_replies, chat_rules
from app.chat_replies import ReplyFileError

HEADER = "reply,text"
URGENT = 'urgent,"This sounds serious. If it\'s happening now, call 911."'
MEDICAL = 'medical_advice,"I can\'t give medical advice, so please ask your clinician."'
OFF_TOPIC = "off_topic,That's outside what I can help with."


def write_csv(tmp_path, *lines, header=HEADER, newline="\n", encoding="utf-8"):
    path = tmp_path / "replies.csv"
    path.write_bytes((newline.join([header, *lines]) + newline).encode(encoding))
    return path


def test_the_file_gives_the_text_of_each_reply(tmp_path):
    assert chat_replies.read_csv(write_csv(tmp_path, URGENT, MEDICAL, OFF_TOPIC)) == {
        "urgent": "This sounds serious. If it's happening now, call 911.",
        "medical_advice": "I can't give medical advice, so please ask your clinician.",
        "off_topic": "That's outside what I can help with.",
    }


def test_the_file_in_the_repo_has_every_reply():
    """Whatever the wording is today, each reply the checks can ask for has a text."""
    replies = chat_replies.read_csv()

    assert chat_replies.CSV_PATH.name == "fixed_replies.csv"
    assert set(replies) == set(chat_replies.REPLIES)
    assert all(text.strip() for text in replies.values())


def test_every_reply_the_two_checks_can_ask_for_is_one_the_file_must_have():
    """The keyword check and the Jev check name replies; none of them may be missing from REPLIES."""
    assert chat_rules.REPLY in chat_replies.REPLIES

    def noul(p):
        return {"type": "noul", "noul": p}

    from_jev = {
        chat_gate.decide({"urgent": noul(u), "medical_advice": noul(m), "about_health_or_app": noul(t)}).reply
        for u, m, t in [(1, 0, 1), (0, 1, 1), (0, 0, 0)]
    }
    assert from_jev == set(chat_replies.REPLIES)


def test_a_csv_saved_from_excel_loads(tmp_path):
    """Excel adds a hidden mark at the start, ends lines with \\r\\n and can leave empty lines."""
    path = write_csv(tmp_path, URGENT, ",", MEDICAL, OFF_TOPIC, newline="\r\n", encoding="utf-8-sig")

    assert set(chat_replies.read_csv(path)) == {"urgent", "medical_advice", "off_topic"}


@pytest.mark.parametrize("line, problem", [
    ("crisis,Call 988.", "reply is 'crisis', expected one of: urgent, medical_advice, off_topic"),
    (",Some text without a name.", "reply is '', expected one of"),
    ('urgent,"A second urgent text."', "reply 'urgent' is already in the file"),
    ("off_topic,", "the text of 'off_topic' is empty"),
])
def test_a_wrong_line_is_named(tmp_path, line, problem):
    path = write_csv(tmp_path, URGENT, MEDICAL, line)

    with pytest.raises(ReplyFileError) as error:
        chat_replies.read_csv(path)

    assert "replies.csv line 4" in str(error.value)
    assert problem in str(error.value)


def test_a_reply_without_a_text_is_named(tmp_path):
    with pytest.raises(ReplyFileError, match="no text for: medical_advice, off_topic"):
        chat_replies.read_csv(write_csv(tmp_path, URGENT))


def test_a_missing_column_and_a_missing_file_are_errors(tmp_path):
    with pytest.raises(ReplyFileError, match=r"missing column\(s\): text"):
        chat_replies.read_csv(write_csv(tmp_path, "urgent", header="reply"))
    with pytest.raises(ReplyFileError, match="not found"):
        chat_replies.read_csv(tmp_path / "nowhere.csv")
