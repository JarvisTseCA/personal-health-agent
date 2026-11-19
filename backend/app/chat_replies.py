"""
The fixed replies of the Chat tab: what the user reads when a message is
stopped before any model writes.

    urgent          An urgent keyword matched (chat_rules.py), or Jev said the
                    user needs urgent help (chat_gate.py).
    medical_advice  Jev said the user is asking for medical advice.
    off_topic       Jev said the message isn't about exercise, health or this app.

The wording is in one CSV in the repo:

    backend/chat_content/fixed_replies.csv

So it can change without touching code: edit the file, restart the backend.
One line per reply, the text in double quotes because it has commas in it:

    reply,text
    off_topic,"That's outside what I can help with. I'm here for ..."

Open question for the team: the three texts are a first draft and have not
had a clinical review.

Not connected to a route yet.
"""
import csv
from pathlib import Path
from typing import Dict, Optional, Union

CSV_PATH = Path(__file__).resolve().parents[1] / "chat_content" / "fixed_replies.csv"
COLUMNS = ["reply", "text"]

# Every reply the two checks can ask for. The file must have each of them, once.
REPLIES = ("urgent", "medical_advice", "off_topic")


class ReplyFileError(ValueError):
    """The reply CSV can't be used as it is. The message says which line and why."""


def read_csv(path: Optional[Union[str, Path]] = None) -> Dict[str, str]:
    """The text of each fixed reply (from CSV_PATH unless another file is given), checked: {"urgent": "...", ...}."""
    path = Path(path or CSV_PATH)
    try:
        # utf-8-sig: a CSV saved from Excel starts with a hidden mark; this drops it.
        f = open(path, encoding="utf-8-sig", newline="")
    except FileNotFoundError:
        raise ReplyFileError(f"Fixed replies not found: {path}") from None
    with f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ReplyFileError(f"{path.name}: missing column(s): {', '.join(missing)}")
        replies: Dict[str, str] = {}
        for raw in reader:
            name, text = ((raw.get(c) or "").strip() for c in COLUMNS)
            if not name and not text:
                continue  # a line of empty cells, as Excel can leave at the end
            where = f"{path.name} line {reader.line_num}"
            if name not in REPLIES:
                raise ReplyFileError(f"{where}: reply is {name!r}, expected one of: {', '.join(REPLIES)}")
            if name in replies:
                raise ReplyFileError(f"{where}: reply {name!r} is already in the file")
            if not text:
                raise ReplyFileError(f"{where}: the text of {name!r} is empty")
            replies[name] = text
    absent = [name for name in REPLIES if name not in replies]
    if absent:
        raise ReplyFileError(f"{path.name}: no text for: {', '.join(absent)}")
    return replies
