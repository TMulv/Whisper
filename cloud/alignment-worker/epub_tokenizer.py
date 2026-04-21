"""
Extract sentence-tagged tokens from an epub for DTW alignment.

The tokenizer walks the spine in document order, splits each chapter into
sentences, and emits `EpubToken`s with monotone char offsets and a stable
per-sentence id. The cfi field is a deterministic pseudo-CFI based on the
spine index + sentence number — the RN reader maps these back to real CFIs
at read time (epub.js can resolve CFIs, python can't easily).

Whole-book percent is computed from cumulative character count, matching
the RN layer-0 convention.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ebooklib import epub, ITEM_DOCUMENT
from bs4 import BeautifulSoup

from aligner import EpubToken


SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")
WORD_RE = re.compile(r"[\w']+", re.UNICODE)


@dataclass
class ChapterText:
    index: int
    title: str
    text: str
    start_char_offset: int  # cumulative into book


def load_chapters(epub_path: str) -> list[ChapterText]:
    book = epub.read_epub(epub_path)
    chapters: list[ChapterText] = []
    running_offset = 0
    idx = 0
    for item in book.get_items_of_type(ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator=" ", strip=True)
        if not text:
            continue
        title = soup.title.string if soup.title else f"Chapter {idx + 1}"
        chapters.append(
            ChapterText(
                index=idx,
                title=title,
                text=text,
                start_char_offset=running_offset,
            )
        )
        running_offset += len(text)
        idx += 1
    return chapters


def tokenize_chapter(
    chapter: ChapterText,
    total_book_chars: int,
) -> list[EpubToken]:
    tokens: list[EpubToken] = []
    sentences = SENTENCE_SPLIT_RE.split(chapter.text)
    cursor = 0
    for s_idx, sentence in enumerate(sentences):
        cfi = f"pseudo:ch{chapter.index}/s{s_idx}"
        for m in WORD_RE.finditer(sentence):
            abs_offset = chapter.start_char_offset + cursor + m.start()
            percent = abs_offset / max(total_book_chars, 1)
            tokens.append(
                EpubToken(
                    text=m.group(0),
                    char_offset=abs_offset,
                    cfi=cfi,
                    percent_complete=percent,
                    sentence_id=s_idx,
                )
            )
        cursor += len(sentence) + 1  # account for the split whitespace
    return tokens


def tokenize_book(epub_path: str) -> dict[int, list[EpubToken]]:
    chapters = load_chapters(epub_path)
    total = sum(len(c.text) for c in chapters) or 1
    return {c.index: tokenize_chapter(c, total) for c in chapters}
