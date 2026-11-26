"""
The model that writes the Chat reply, for a message that passed both checks
(chat_rules.py, then chat_gate.py).

With OPENAI_API_KEY in backend/.env the reply comes from ChatGPT, through
OpenAI's Chat Completions API. The system prompt and the conversation go in;
the reply comes back in small pieces, and POST /api/chat passes each piece on
to the app as it arrives. Two more settings, both optional, in backend/.env:

    CHAT_MODEL        which model writes. Without it: DEFAULT_MODEL, below
    OPENAI_BASE_URL   only when the key goes through another address than
                      api.openai.com, such as a course gateway that speaks
                      the same API

Without a key, `write` gives back a placeholder that says so, in pieces, so
the whole route still runs offline and in the tests.

`complete` asks for a whole reply at once, for the short jobs on the Today tab (today_words.py).

Another provider would be one more function like `_write_openai`, chosen in `write`.
"""
import json
import os
import re
from typing import Dict, Iterator, List

import httpx

OPENAI_URL = "https://api.openai.com/v1"
# The model that writes when backend/.env doesn't name one. To try another, set CHAT_MODEL there; no code change.
DEFAULT_MODEL = "gpt-6-luna"
# The first piece can take a while on a busy model; a dead connection should not hang the Chat tab.
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
# The Today tab waits for these, so they are short; the app falls back to its own words after this.
SHORT_TIMEOUT = httpx.Timeout(8.0, connect=4.0)

PLACEHOLDER = (
    "This is a placeholder: no chat model is connected yet. "
    "Your message passed both checks, so a model would answer it here."
)


class WriterError(Exception):
    """The model could not be asked, or stopped answering. The message says why, without the API key."""


def has_api_key() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def chat_model() -> str:
    return (os.environ.get("CHAT_MODEL") or "").strip() or DEFAULT_MODEL


def name() -> str:
    """What is writing, for the backend terminal and /api/health."""
    return f"ChatGPT {chat_model()}" if has_api_key() else "placeholder"


def write(system: str, messages: List[Dict[str, str]]) -> Iterator[str]:
    """The reply, piece by piece. `messages` is the conversation: [{"role": "user" or "assistant", "content": "..."}, ...]."""
    if not has_api_key():
        yield from re.findall(r"\S+\s*", PLACEHOLDER)
        return
    yield from _write_openai(system, messages)


def _no_key(text: str) -> str:
    """An error text that is safe to print: OpenAI repeats part of a wrong key in its message."""
    return re.sub(r"sk-[\w\-*.]+", "sk-…", text)


def _error_text(res: httpx.Response) -> str:
    """Why the request was refused, in OpenAI's words when it gave any."""
    try:
        message = res.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        message = res.text
    return _no_key(str(message))[:500]


def _write_openai(system: str, messages: List[Dict[str, str]]) -> Iterator[str]:
    url = (os.environ.get("OPENAI_BASE_URL") or "").strip().rstrip("/") or OPENAI_URL
    body = {
        "model": chat_model(),
        "stream": True,
        "messages": ([{"role": "system", "content": system}] if system else [])
        + [{"role": m["role"], "content": m["content"]} for m in messages],
    }
    headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
    try:
        with httpx.stream("POST", f"{url}/chat/completions", json=body, headers=headers, timeout=TIMEOUT) as res:
            if res.status_code != 200:
                res.read()
                raise WriterError(f"The chat model returned {res.status_code}: {_error_text(res)}")
            # The reply arrives as lines like:  data: {"choices": [{"delta": {"content": "Yes, "}}]}
            # and ends with:                    data: [DONE]
            for line in res.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if isinstance(chunk, dict) and chunk.get("error"):
                    raise WriterError(f"The chat model stopped: {_no_key(str(chunk['error']))[:500]}")
                for choice in (chunk.get("choices") or []) if isinstance(chunk, dict) else []:
                    piece = (choice.get("delta") or {}).get("content")
                    if piece:
                        yield piece
    except httpx.HTTPError as e:
        raise WriterError(f"Could not reach the chat model: {_no_key(str(e))}") from e


def complete(system: str, user: str, as_json: bool = False) -> str:
    """One whole reply to one message, for the Today tab's short jobs. Needs the key (has_api_key).

    With `as_json` the model is asked for a JSON object; the text that comes back is still
    checked by the caller, since a gateway may not honour the request.
    """
    if not has_api_key():
        raise WriterError("No OPENAI_API_KEY in backend/.env")
    url = (os.environ.get("OPENAI_BASE_URL") or "").strip().rstrip("/") or OPENAI_URL
    body: Dict[str, object] = {
        "model": chat_model(),
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if as_json:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
    try:
        res = httpx.post(f"{url}/chat/completions", json=body, headers=headers, timeout=SHORT_TIMEOUT)
    except httpx.HTTPError as e:
        raise WriterError(f"Could not reach the chat model: {_no_key(str(e))}") from e
    if res.status_code != 200:
        raise WriterError(f"The chat model returned {res.status_code}: {_error_text(res)}")
    try:
        return str(res.json()["choices"][0]["message"]["content"] or "").strip()
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise WriterError("The chat model's answer had no text") from e
