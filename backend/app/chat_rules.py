"""
The first check on a Chat message: urgent-symptom keywords.

A message that matches a keyword is stopped here: the user gets the fixed
"urgent" reply and no model is asked. This check is for the plain cases that
must not be missed ("chest pain", "passed out"). Anything subtler is left to
the next check, which asks Jev.

The keywords are in one CSV in the repo:

    backend/chat_content/urgent_keywords.csv

So the list can change without touching code: edit the file, restart the
backend. One line per keyword:

    group,text,together_with
    fainting,passed out,
    chest,chest | heart,pain | pressure | tight

    together_with empty    A phrase. Stops a message that has `text` in it,
                           as whole words: "want to die" doesn't stop
                           "I want to diet".
    together_with filled   A pair. Stops a message that has a word from
                           `text` and a word from `together_with` in the
                           same sentence. A word from `together_with` matches
                           the start of a word (tight: tight, tightness).
                           This is what lets "chest workout" through and
                           stops "pressure in my chest".
    group                  A name for the people reading the list and for
                           the backend terminal. Nothing is decided by it.

Upper and lower case are the same, ' can be left out ("cant breathe"), - reads
as a space, and a plural counts ("seizure" also stops "seizures"). Nothing
else is guessed: "fainted" doesn't stop "fainting" unless that has its own
line. The first line in the file that matches is the one reported.

Not connected to a route yet.
"""
import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple, Union

CSV_PATH = Path(__file__).resolve().parents[1] / "chat_content" / "urgent_keywords.csv"
COLUMNS = ["group", "text", "together_with"]

# The fixed reply a stopped message gets: the same one as a yes to Jev's `urgent` question (chat_gate.py).
REPLY = "urgent"


class KeywordFileError(ValueError):
    """The keyword CSV can't be used as it is. The message says which line and why."""


@dataclass(frozen=True)
class Keyword:
    """One line of the CSV, ready to compare with a message."""
    group: str
    text: str                     # as written in the CSV
    words: Tuple[str, ...]        # a phrase: its words, in order. a pair: the words of `text`
    starts: Tuple[str, ...] = ()  # a pair only: the words of `together_with`. Empty for a phrase


@dataclass(frozen=True)
class Match:
    """Why a message was stopped."""
    group: str
    matched: str  # the phrase as written in the CSV, or the two words of a pair: "chest + pressure"


def _plain(text: str) -> str:
    """Lower case, without ' and with - as a space, so "Can’t", "can't" and "cant" read the same."""
    text = text.lower().replace("’", "'").replace("‘", "'")
    return text.replace("'", "").replace("-", " ")


def _words(text: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", _plain(text))


def _sentences(text: str) -> List[List[str]]:
    """The message as sentences, each a list of words."""
    return [words for words in (_words(part) for part in re.split(r"[.!?\n]+", text)) if words]


def _same(word: str, keyword: str) -> bool:
    """The word in the message is the keyword, or its plural."""
    return word == keyword or word == keyword + "s"


def _cell_words(cell: str) -> Tuple[str, ...]:
    """The words in a pair cell: "chest | heart" → ("chest", "heart")."""
    return tuple(word for word in (" ".join(_words(part)) for part in cell.split("|")) if word)


def _keyword(cells: Dict[str, str], where: str) -> Keyword:
    """One CSV line as a Keyword, or an error that says what is wrong with it."""
    group, text, together_with = (cells[c] for c in COLUMNS)
    if not group:
        raise KeywordFileError(f"{where}: group can't be empty")

    if not together_with:  # a phrase
        words = tuple(_words(text))
        if not words:
            raise KeywordFileError(f"{where}: text is empty")
        return Keyword(group, text, words)

    words, starts = _cell_words(text), _cell_words(together_with)
    if not words:
        raise KeywordFileError(f"{where}: text is empty")
    if not starts:
        raise KeywordFileError(f"{where}: together_with has no words")
    long = [w for w in words + starts if " " in w]
    if long:
        raise KeywordFileError(
            f"{where}: with together_with filled this line is a pair, which takes single words, "
            f"and {long[0]!r} is more than one; leave together_with empty for a phrase"
        )
    return Keyword(group, text, words, starts)


def read_csv(path: Optional[Union[str, Path]] = None) -> List[Keyword]:
    """Every keyword in the CSV (CSV_PATH unless another file is given), checked, in the order of the file."""
    path = Path(path or CSV_PATH)
    try:
        # utf-8-sig: a CSV saved from Excel starts with a hidden mark; this drops it.
        f = open(path, encoding="utf-8-sig", newline="")
    except FileNotFoundError:
        raise KeywordFileError(f"Urgent keyword list not found: {path}") from None
    with f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise KeywordFileError(f"{path.name}: missing column(s): {', '.join(missing)}")
        keywords: List[Keyword] = []
        for raw in reader:
            cells = {c: (raw.get(c) or "").strip() for c in COLUMNS}
            if not any(cells.values()):
                continue  # a line of empty cells, as Excel can leave at the end
            keywords.append(_keyword(cells, f"{path.name} line {reader.line_num}"))
    if not keywords:
        raise KeywordFileError(f"{path.name} has no keywords")
    return keywords


def check(message: str, keywords: Iterable[Keyword]) -> Optional[Match]:
    """The first keyword, in the order of the CSV, that stops this message. None: the message goes on."""
    sentences = _sentences(message)
    for k in keywords:
        for words in sentences:
            if not k.starts:  # a phrase
                n = len(k.words)
                for i in range(len(words) - n + 1):
                    if all(_same(w, kw) for w, kw in zip(words[i:i + n], k.words)):
                        return Match(k.group, k.text)
            else:  # a pair
                body = next((w for w in words if any(_same(w, kw) for kw in k.words)), None)
                symptom = next((w for w in words if w.startswith(k.starts)), None)
                if body and symptom:
                    return Match(k.group, f"{body} + {symptom}")
    return None
