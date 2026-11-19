"""POST /api/chat: a Chat message → urgent keywords → Jev's three questions → a fixed reply, or the model that writes."""
import pytest
from fastapi.testclient import TestClient

from app import chat_gate, chat_prompt, chat_replies, chat_rules, chat_writer, main

# A short keyword list, three short replies and a short brief, so these tests don't depend on what the files in the repo say.
KEYWORDS = "\n".join([
    "group,text,together_with",
    "chest,chest | heart,pain | pressure | tight",
    "fainting,passed out,",
]) + "\n"
REPLIES = "\n".join([
    "reply,text",
    "urgent,Call 911.",
    "medical_advice,Ask your clinician.",
    "off_topic,Outside what I can help with.",
]) + "\n"
BRIEF = "You are the Chat assistant.\nUrgent: [urgent reply]\nMedical: [medical_advice reply]\nOff topic: [off_topic reply]\n"

FITNESS = "Is it OK to cycle two days in a row?"
URGENT = "I felt pressure in my chest during my ride yesterday"
MEDICAL = "My knee hurts when I run"
OFF_TOPIC = "Can you help me write a cover letter for a marketing job?"


def body(*texts, system="You are the user's exercise coach."):
    """A request as the Chat tab sends it: the texts alternate user, assistant, user, …"""
    roles = ["user", "assistant"]
    return {"system": system, "messages": [{"role": roles[i % 2], "content": t} for i, t in enumerate(texts)]}


def noul(urgent, medical_advice, about_health_or_app):
    return {
        "urgent": {"type": "noul", "noul": urgent},
        "medical_advice": {"type": "noul", "noul": medical_advice},
        "about_health_or_app": {"type": "noul", "noul": about_health_or_app},
    }


@pytest.fixture(autouse=True)
def chat_files(tmp_path, monkeypatch):
    """Every test reads its own keyword list, replies and brief, and never touches backend/data/pha.db.
    No test has a Jev key or an OpenAI key, whatever is in backend/.env, so none of them reaches a real model."""
    keywords, replies, brief = tmp_path / "urgent_keywords.csv", tmp_path / "fixed_replies.csv", tmp_path / "chat_brief.txt"
    keywords.write_text(KEYWORDS, encoding="utf-8")
    replies.write_text(REPLIES, encoding="utf-8")
    brief.write_text(BRIEF, encoding="utf-8")
    monkeypatch.setattr(chat_rules, "CSV_PATH", keywords)
    monkeypatch.setattr(chat_replies, "CSV_PATH", replies)
    monkeypatch.setattr(chat_prompt, "BRIEF_PATH", brief)
    monkeypatch.setattr(main, "_chat", {})
    monkeypatch.setenv("PHA_DB_PATH", str(tmp_path / "test.db"))
    for setting in ("TYPESAFE_API_KEY", "OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(setting, raising=False)
    return keywords, replies, brief


@pytest.fixture
def client():
    return TestClient(main.app)


# --- The three ways a message is stopped, and the one way it goes on ---------


def test_an_urgent_keyword_gets_the_urgent_reply_and_jev_is_not_asked(client, monkeypatch):
    def not_asked(*args):
        raise AssertionError("Jev should not be asked after a keyword match")

    monkeypatch.setattr(chat_gate, "mock_answers", not_asked)

    res = client.post("/api/chat", json=body(URGENT))

    assert res.status_code == 200
    assert res.text == "Call 911."
    assert res.headers["content-type"].startswith("text/plain")
    assert (res.headers["X-Chat-Stopped-By"], res.headers["X-Chat-Reply"]) == ("keywords", "urgent")


@pytest.mark.parametrize("message, reply, text", [
    (MEDICAL, "medical_advice", "Ask your clinician."),
    (OFF_TOPIC, "off_topic", "Outside what I can help with."),
    ("This is an emergency", "urgent", "Call 911."),
])
def test_what_jev_stops_gets_its_fixed_reply(client, message, reply, text):
    res = client.post("/api/chat", json=body(message))

    assert res.status_code == 200
    assert res.text == text
    assert (res.headers["X-Chat-Stopped-By"], res.headers["X-Chat-Reply"]) == ("jev", reply)


def test_a_message_that_passes_both_checks_goes_to_the_model_that_writes(client):
    res = client.post("/api/chat", json=body(FITNESS))

    assert res.status_code == 200
    assert res.text == chat_writer.PLACEHOLDER
    assert res.headers["content-type"].startswith("text/plain")
    assert (res.headers["X-Chat-Stopped-By"], res.headers["X-Chat-Reply"]) == ("none", "model")


def test_the_written_reply_is_sent_piece_by_piece(client, monkeypatch):
    def three_pieces(system, messages):
        yield from ["Yes, ", "two days in a row ", "is fine."]

    monkeypatch.setattr(chat_writer, "write", three_pieces)

    with client.stream("POST", "/api/chat", json=body(FITNESS)) as res:
        pieces = list(res.iter_text())

    assert "".join(pieces) == "Yes, two days in a row is fine."


def test_the_model_gets_the_brief_then_the_apps_notes_and_the_whole_conversation(client, monkeypatch):
    got = {}

    def remember(system, messages):
        got.update(system=system, messages=messages)
        yield "ok"

    monkeypatch.setattr(chat_writer, "write", remember)

    client.post("/api/chat", json=body("What's a MET?", "A MET is…", FITNESS, system="You are the coach."))

    assert got["system"] == (
        "You are the Chat assistant.\n"
        "Urgent: Call 911.\n"
        "Medical: Ask your clinician.\n"
        "Off topic: Outside what I can help with."
        f"\n\n{chat_prompt.APP_NOTES}\n\n"
        "You are the coach."
    )
    assert [m["role"] for m in got["messages"]] == ["user", "assistant", "user"]
    assert got["messages"][-1]["content"] == FITNESS


def test_with_an_openai_key_the_reply_comes_from_the_model(client, monkeypatch, caplog):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-1234")
    monkeypatch.setenv("CHAT_MODEL", "gpt-test")
    monkeypatch.setattr(chat_writer, "_write_openai", lambda system, messages: iter(["Yes, ", "that's fine."]))

    with caplog.at_level("INFO", logger="pha"):
        res = client.post("/api/chat", json=body(FITNESS))

    assert res.text == "Yes, that's fine."
    assert res.headers["X-Chat-Reply"] == "model"
    assert "── POST /api/chat  (Jev: mock · writer: ChatGPT gpt-test) ──" in caplog.text
    assert "[4] Passed both checks. Writing (ChatGPT gpt-test)…" in caplog.text
    assert "[5] Sent to app: 17 characters" in caplog.text
    assert client.get("/api/health").json()["chat_writer"] == "ChatGPT gpt-test"


# --- When the model that writes fails ---------------------------------------


@pytest.mark.parametrize("reply, reason", [
    (chat_writer.WriterError("The chat model returned 401: Incorrect API key provided"), "The chat model returned 401: Incorrect API key provided"),
    ([], "the chat model sent no text"),
])
def test_a_model_that_fails_before_its_first_word_is_an_error_not_an_empty_reply(client, monkeypatch, caplog, reply, reason):
    def write(system, messages):
        if isinstance(reply, Exception):
            raise reply
        yield from reply

    monkeypatch.setattr(chat_writer, "write", write)

    with caplog.at_level("INFO", logger="pha"):
        res = client.post("/api/chat", json=body(FITNESS))

    assert res.status_code == 502
    assert reason.lower() in res.json()["detail"].lower()
    assert f"✗ Failed: {reason}" in caplog.text


def test_a_model_that_stops_halfway_leaves_what_it_already_sent(client, monkeypatch, caplog):
    def write(system, messages):
        yield "Yes, "
        yield "two days "
        raise chat_writer.WriterError("The chat model stopped: overloaded")

    monkeypatch.setattr(chat_writer, "write", write)

    with caplog.at_level("INFO", logger="pha"):
        res = client.post("/api/chat", json=body(FITNESS))

    assert res.status_code == 200  # the first words had already left
    assert res.text == "Yes, two days "
    assert "✗ Failed after 14 characters: The chat model stopped: overloaded" in caplog.text
    assert "[5] Sent to app" not in caplog.text


def test_the_last_user_message_is_the_one_checked(client):
    """An urgent message earlier in the chat doesn't stop a later, ordinary one."""
    res = client.post("/api/chat", json=body(URGENT, "Call 911.", FITNESS))

    assert res.headers["X-Chat-Stopped-By"] == "none"


# --- With a real Jev key ----------------------------------------------------


def test_with_a_key_jev_gets_the_three_questions_and_its_answer_decides(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    calls = []

    def fake_call(request):
        calls.append(request)
        return noul(0.03, 0.81, 0.97), "jev-1.14.0"

    monkeypatch.setattr(main, "call_jev", fake_call)

    res = client.post("/api/chat", json=body("What's a MET?", "A MET is…", "I have high blood pressure, can I do HIIT?"))

    assert len(calls) == 1
    assert calls[0]["model"] == "jev-latest"
    assert calls[0]["state"]["message"] == "I have high blood pressure, can I do HIIT?"
    assert [m["text"] for m in calls[0]["state"]["earlier_in_this_chat"]] == ["What's a MET?", "A MET is…"]
    assert list(calls[0]["questions"]) == ["urgent", "medical_advice", "about_health_or_app"]
    assert res.text == "Ask your clinician."
    assert res.headers["X-Chat-Reply"] == "medical_advice"


@pytest.mark.parametrize("failure, reason", [
    (main.JevError("Jev returned 401: bad key"), "Jev returned 401: bad key"),
    (None, "Jev's answer to 'urgent' has no probability between 0 and 1"),
])
def test_when_jev_cannot_be_asked_the_message_is_not_passed_on(client, monkeypatch, caplog, failure, reason):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")

    def broken(request):
        if failure:
            raise failure
        return {"something": "else"}, "jev-1.14.0"

    def not_written(*args):
        raise AssertionError("the model should not write when the check failed")

    monkeypatch.setattr(main, "call_jev", broken)
    monkeypatch.setattr(chat_writer, "write", not_written)

    with caplog.at_level("INFO", logger="pha"):
        res = client.post("/api/chat", json=body(FITNESS))

    assert res.status_code == 502
    assert reason in res.json()["detail"]
    assert f"✗ Failed: {reason}" in caplog.text


# --- What the terminal shows ------------------------------------------------


def test_each_step_is_printed_in_the_terminal(client, caplog):
    with caplog.at_level("INFO", logger="pha"):
        client.post("/api/chat", json=body(URGENT))
        client.post("/api/chat", json=body(MEDICAL))
        client.post("/api/chat", json=body(FITNESS))

    for line in [
        "── POST /api/chat  (Jev: mock · writer: placeholder) ──",
        '[1] Message: "I felt pressure in my chest during my ride yesterday"',
        '[2] Urgent keywords: matched "chest + pressure" (chest)',
        '[3] Sent to app: fixed reply "urgent"',
        "[2] Urgent keywords: no match",
        "[3] Ask Jev (urgent? medical advice? about health or the app?)…",
        "urgent 0.05 · medical_advice 0.90 · about_health_or_app 0.95",
        '[4] Sent to app: fixed reply "medical_advice"',
        "[4] Passed both checks. Writing (placeholder)…",
        f"[5] Sent to app: {len(chat_writer.PLACEHOLDER)} characters",
    ]:
        assert line in caplog.text
    assert "Prompt:" not in caplog.text  # the full JSON only shows at DEBUG


def test_a_long_message_is_cut_to_one_terminal_line(client, caplog):
    with caplog.at_level("INFO", logger="pha"):
        client.post("/api/chat", json=body("How do I get fitter? " * 20))

    line = next(l for l in caplog.text.splitlines() if "[1] Message:" in l)
    assert line.endswith('…"') and len(line) < 140


# --- Requests the route can't answer ----------------------------------------


@pytest.mark.parametrize("request_body", [
    {"system": "", "messages": []},
    {"system": "", "messages": [{"role": "assistant", "content": "Hi Alex"}]},
    {"system": "", "messages": [{"role": "user", "content": "   "}]},
])
def test_no_user_message_is_a_422(client, request_body):
    res = client.post("/api/chat", json=request_body)

    assert res.status_code == 422
    assert "no user message" in res.json()["detail"]


def test_a_role_the_app_does_not_send_is_a_422(client):
    res = client.post("/api/chat", json={"messages": [{"role": "agent", "content": "Hi"}]})

    assert res.status_code == 422


def test_system_can_be_left_out(client):
    res = client.post("/api/chat", json={"messages": [{"role": "user", "content": FITNESS}]})

    assert res.status_code == 200


# --- When the backend starts ------------------------------------------------


def test_the_two_files_are_read_when_the_backend_starts(caplog):
    with caplog.at_level("INFO", logger="pha"):
        with TestClient(main.app) as client:  # `with` runs the startup step
            res = client.post("/api/chat", json=body(URGENT))

    assert (
        "Chat: 2 urgent keywords from urgent_keywords.csv, 3 fixed replies from fixed_replies.csv, "
        "brief from chat_brief.txt (writer: placeholder)"
    ) in caplog.text
    assert res.text == "Call 911."


@pytest.mark.parametrize("which, broken, problem", [
    (0, "group,text,together_with\n,passed out,\n", "urgent_keywords.csv line 2: group can't be empty"),
    (1, "reply,text\nurgent,Call 911.\n", "fixed_replies.csv: no text for: medical_advice, off_topic"),
    (2, "Just be helpful.\n", "chat_brief.txt: no place for: [urgent reply], [medical_advice reply], [off_topic reply]"),
])
def test_a_file_that_cannot_be_read_stops_the_backend_and_says_why(chat_files, caplog, which, broken, problem):
    chat_files[which].write_text(broken, encoding="utf-8")

    with caplog.at_level("INFO", logger="pha"):
        with pytest.raises((chat_rules.KeywordFileError, chat_replies.ReplyFileError, chat_prompt.BriefFileError)):
            with TestClient(main.app):
                pass

    assert f"✗ Chat: {problem}" in caplog.text


def test_the_files_in_the_repo_work_with_the_route(monkeypatch):
    """The real list, replies and brief, whatever they say today: a short thank-you still gets an answer."""
    monkeypatch.undo()  # back to the files in backend/chat_content/
    monkeypatch.setattr(main, "_chat", {})
    for setting in ("TYPESAFE_API_KEY", "OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(setting, raising=False)  # still no real model

    res = TestClient(main.app).post("/api/chat", json=body("thanks!"))

    assert res.status_code == 200
    assert res.headers["X-Chat-Stopped-By"] in {"keywords", "jev", "none"}
