"""
The system prompt for the model that writes the Chat reply.

It has three parts, in this order:

  1. The brief: who the model is in the Chat tab, what it helps with, the
     three kinds of message it doesn't answer, and how to answer the rest.
     It is a text file in the repo, so the wording can change without
     touching code (edit the file, restart the backend):

         backend/chat_content/chat_brief.txt

  2. The three fixed replies, put into the brief where it says
     [urgent reply], [medical_advice reply] and [off_topic reply]. They come
     from fixed_replies.csv (chat_replies.py), so when the model turns a
     message down it uses the same words as the two checks before it.

  3. What the model is told about the user. One of two, by the route:

     POST /api/chat/memory   the user's data as the backend read it from
                             Memory and worked it out (memory_chat.py), as JSON.
                             This is what the app uses.
     POST /api/chat          what the caller sends as `system`: its own notes
                             and the user's data (buildSystemPrompt in
                             src/services/prompts.ts). The brief comes first
                             and wins where the two differ.

The brief repeats the two checks on purpose. A message reaches the model only
after the urgent keywords and Jev's three questions let it through; the brief
is the third and last line.

Open question for the team: the brief is a first draft and has not had a
clinical review.
"""
import json
from pathlib import Path
from typing import Any, Dict, Optional, Union

from .chat_replies import REPLIES

BRIEF_PATH = Path(__file__).resolve().parents[1] / "chat_content" / "chat_brief.txt"

# Where each fixed reply goes in the brief: "[urgent reply]", "[medical_advice reply]", "[off_topic reply]".
MARKERS = {name: f"[{name} reply]" for name in REPLIES}

APP_NOTES = (
    "The app's own notes and the user's data follow. "
    "Where they say something different from the rules above, follow the rules above."
)
USER_DATA = "The user's data, from the app's own records, as JSON. \"today\" is the user's today."


class BriefFileError(ValueError):
    """The brief can't be used as it is. The message says why."""


def read_brief(path: Optional[Union[str, Path]] = None) -> str:
    """The brief (from BRIEF_PATH unless another file is given), checked: not empty, and with a place for each fixed reply."""
    path = Path(path or BRIEF_PATH)
    try:
        # utf-8-sig: a file saved from some Windows editors starts with a hidden mark; this drops it.
        brief = path.read_text(encoding="utf-8-sig").strip()
    except FileNotFoundError:
        raise BriefFileError(f"Chat brief not found: {path}") from None
    if not brief:
        raise BriefFileError(f"{path.name} is empty")
    absent = [marker for marker in MARKERS.values() if marker not in brief]
    if absent:
        raise BriefFileError(f"{path.name}: no place for: {', '.join(absent)}")
    return brief


def build_system(
    brief: str, replies: Dict[str, str], app_system: str = "", user_data: Optional[Dict[str, Any]] = None,
) -> str:
    """The whole system prompt: the brief with the fixed replies in it, then what the model is told about the user.

    `user_data` is what memory_chat.user_data() read from Memory; `app_system` is what a caller of POST /api/chat sent.
    """
    system = brief
    for name, marker in MARKERS.items():
        system = system.replace(marker, replies[name])
    if user_data is not None:
        system += f"\n\n{USER_DATA}\n\n{json.dumps(user_data, indent=2, ensure_ascii=False)}"
    app_system = (app_system or "").strip()
    if app_system:
        system += f"\n\n{APP_NOTES}\n\n{app_system}"
    return system
