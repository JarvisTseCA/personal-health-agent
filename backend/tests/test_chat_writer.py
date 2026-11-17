"""The model that writes the Chat reply (app/chat_writer.py). No test here reaches OpenAI: httpx.stream is replaced."""
import json

import httpx
import pytest

from app import chat_writer
from app.chat_writer import WriterError

CHAT = [
    {"role": "user", "content": "What's a MET?"},
    {"role": "assistant", "content": "A MET is…"},
    {"role": "user", "content": "Is it OK to cycle two days in a row?"},
]


def data(text):
    """One line of a streamed reply, as OpenAI sends it."""
    return "data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": text}}]})


class FakeStream:
    """What httpx.stream(...) gives back: a response that is read line by line."""

    def __init__(self, lines=(), status_code=200, body=""):
        self.lines, self.status_code, self.text = list(lines), status_code, body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def iter_lines(self):
        yield from self.lines

    def read(self):
        return self.text.encode()

    def json(self):
        return json.loads(self.text)


@pytest.fixture(autouse=True)
def no_settings(monkeypatch):
    """Start every test without a key, whatever is in backend/.env."""
    for setting in ("OPENAI_API_KEY", "CHAT_MODEL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(setting, raising=False)


@pytest.fixture
def openai(monkeypatch):
    """A key and a model are set, and requests go to a fake. Returns what was sent; set .reply to choose the answer."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-1234")
    monkeypatch.setenv("CHAT_MODEL", "gpt-test")

    class Sent:
        calls = []
        reply = FakeStream([data("Yes, "), data("that's fine."), "data: [DONE]"])

    def fake_stream(method, url, **kwargs):
        Sent.calls.append({"method": method, "url": url, **kwargs})
        if isinstance(Sent.reply, Exception):
            raise Sent.reply
        return Sent.reply

    monkeypatch.setattr(chat_writer.httpx, "stream", fake_stream)
    return Sent


# --- Without a key ----------------------------------------------------------


def test_without_a_key_the_reply_is_the_placeholder_in_pieces(monkeypatch):
    def not_called(*args, **kwargs):
        raise AssertionError("no request should be made without a key")

    monkeypatch.setattr(chat_writer.httpx, "stream", not_called)

    pieces = list(chat_writer.write("You are the coach.", CHAT))

    assert len(pieces) > 1
    assert "".join(pieces) == chat_writer.PLACEHOLDER
    assert chat_writer.name() == "placeholder"


# --- With a key -------------------------------------------------------------


def test_with_a_key_the_system_prompt_and_the_conversation_go_to_openai(openai):
    pieces = list(chat_writer.write("You are the coach.", CHAT))

    assert pieces == ["Yes, ", "that's fine."]
    (call,) = openai.calls
    assert (call["method"], call["url"]) == ("POST", "https://api.openai.com/v1/chat/completions")
    assert call["headers"] == {"Authorization": "Bearer sk-test-1234"}
    assert call["json"] == {
        "model": "gpt-test",
        "stream": True,
        "messages": [{"role": "system", "content": "You are the coach."}, *CHAT],
    }
    assert chat_writer.name() == "ChatGPT gpt-test"


def test_only_the_text_of_the_reply_is_passed_on(openai):
    openai.reply = FakeStream([
        'data: {"choices": [{"index": 0, "delta": {"role": "assistant"}}]}',  # the first line has no text
        "",
        ": keep-alive",
        data("Yes, "),
        'data: {"choices": []}',
        data(""),
        data("that's fine."),
        'data: {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}',
        "data: [DONE]",
        data("never read"),
    ])

    assert list(chat_writer.write("", CHAT)) == ["Yes, ", "that's fine."]


def test_an_empty_system_prompt_is_left_out(openai):
    list(chat_writer.write("", CHAT))

    assert openai.calls[0]["json"]["messages"] == CHAT


def test_a_course_gateway_address_replaces_openais(openai, monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "https://llm.example.edu/v1/")

    list(chat_writer.write("", CHAT))

    assert openai.calls[0]["url"] == "https://llm.example.edu/v1/chat/completions"


# --- When it goes wrong -----------------------------------------------------


@pytest.mark.parametrize("setting", [None, "", "   "])
def test_without_chat_model_the_default_model_writes(openai, monkeypatch, setting):
    """The model is a setting, not code: CHAT_MODEL in backend/.env picks it, and DEFAULT_MODEL is used without one."""
    if setting is None:
        monkeypatch.delenv("CHAT_MODEL")
    else:
        monkeypatch.setenv("CHAT_MODEL", setting)

    list(chat_writer.write("", CHAT))

    assert openai.calls[0]["json"]["model"] == chat_writer.DEFAULT_MODEL
    assert chat_writer.name() == f"ChatGPT {chat_writer.DEFAULT_MODEL}"


def test_a_refused_request_says_why_without_the_key(openai):
    openai.reply = FakeStream(status_code=401, body=json.dumps({
        "error": {"message": "Incorrect API key provided: sk-test-****1234. You can find your API key at …"},
    }))

    with pytest.raises(WriterError) as error:
        list(chat_writer.write("", CHAT))

    assert str(error.value).startswith("The chat model returned 401: Incorrect API key provided: sk-… You can find")
    assert "1234" not in str(error.value)


def test_a_refusal_that_is_not_json_is_shown_as_it_is(openai):
    openai.reply = FakeStream(status_code=502, body="Bad gateway")

    with pytest.raises(WriterError, match="The chat model returned 502: Bad gateway"):
        list(chat_writer.write("", CHAT))


def test_no_connection_is_a_writer_error(openai):
    openai.reply = httpx.ConnectError("All connection attempts failed")

    with pytest.raises(WriterError, match="Could not reach the chat model: All connection attempts failed"):
        list(chat_writer.write("", CHAT))


def test_an_error_in_the_middle_keeps_what_came_before_it(openai):
    openai.reply = FakeStream([data("Yes, "), 'data: {"error": {"message": "The server is overloaded"}}', data("never read")])
    reply = chat_writer.write("", CHAT)

    assert next(reply) == "Yes, "
    with pytest.raises(WriterError, match="The chat model stopped: .*overloaded"):
        next(reply)
