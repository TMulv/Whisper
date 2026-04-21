"""
DTW alignment and sentence anchor extraction.

Mirrors src/services/sync/dtw.ts in Python. Inputs are whisper's word-level
timestamps and epub tokens tagged with sentence ids; output is a list of
SentenceAnchor dicts suitable for direct write-through to Firestore.

The cost model and banded search are intentionally identical to the TS
implementation so on-device and cloud anchors are interchangeable.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Iterable


PUNCT_RE = re.compile(r"[^\w']", re.UNICODE)


def normalize_token(s: str) -> str:
    return PUNCT_RE.sub("", s.lower()).strip()


@dataclass
class WhisperToken:
    text: str
    start_seconds: float
    end_seconds: float
    confidence: float = 1.0


@dataclass
class EpubToken:
    text: str
    char_offset: int
    cfi: str
    percent_complete: float
    sentence_id: int


@dataclass
class SentenceAnchor:
    audio_seconds: float
    epub_cfi: str
    char_offset: int
    percent_complete: float
    confidence: float

    def to_firestore(self) -> dict:
        return {
            "audioSeconds": self.audio_seconds,
            "epubCfi": self.epub_cfi,
            "charOffset": self.char_offset,
            "percentComplete": self.percent_complete,
            "confidence": self.confidence,
        }


def align_tokens(
    audio: list[WhisperToken],
    epub: list[EpubToken],
    band_fraction: float = 0.15,
) -> tuple[list[tuple[int, int]], float]:
    """Banded DTW. Returns a monotone list of (audio_idx, epub_idx) pairs + total cost."""
    n, m = len(audio), len(epub)
    if n == 0 or m == 0:
        return [], 0.0

    band = max(32, math.ceil(band_fraction * max(n, m)))

    audio_norm = [normalize_token(t.text) for t in audio]
    epub_norm = [normalize_token(t.text) for t in epub]

    INF = float("inf")
    cols = m + 1
    cost = [INF] * ((n + 1) * cols)
    back = [0] * ((n + 1) * cols)
    cost[0] = 0.0

    for i in range(1, n + 1):
        j_min = max(1, i - band)
        j_max = min(m, i + band)
        for j in range(j_min, j_max + 1):
            c = 0.0 if audio_norm[i - 1] == epub_norm[j - 1] else 1.0
            diag = cost[(i - 1) * cols + (j - 1)] + c
            up = cost[(i - 1) * cols + j] + 1.0
            left = cost[i * cols + (j - 1)] + 1.0
            best, choice = diag, 0
            if up < best:
                best, choice = up, 1
            if left < best:
                best, choice = left, 2
            cost[i * cols + j] = best
            back[i * cols + j] = choice

    total = cost[n * cols + m]
    if math.isinf(total):
        if band_fraction < 0.5:
            return align_tokens(audio, epub, band_fraction=0.5)
        return [], math.inf

    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        step = back[i * cols + j]
        if step == 0:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif step == 1:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs, total


def extract_anchors(
    audio: list[WhisperToken],
    epub: list[EpubToken],
    pairs: Iterable[tuple[int, int]],
    min_confidence: float = 0.35,
) -> list[SentenceAnchor]:
    by_sentence: dict[int, dict] = {}
    audio_norm = [normalize_token(t.text) for t in audio]
    epub_norm = [normalize_token(t.text) for t in epub]

    for a_idx, e_idx in pairs:
        ep = epub[e_idx]
        matched = 1 if audio_norm[a_idx] == epub_norm[e_idx] else 0
        acc = by_sentence.get(ep.sentence_id)
        if acc is None:
            by_sentence[ep.sentence_id] = {
                "first_audio_idx": a_idx,
                "first_epub": ep,
                "matched": matched,
                "total": 1,
            }
        else:
            acc["matched"] += matched
            acc["total"] += 1
            if a_idx < acc["first_audio_idx"]:
                acc["first_audio_idx"] = a_idx
                acc["first_epub"] = ep

    anchors: list[SentenceAnchor] = []
    for acc in by_sentence.values():
        confidence = acc["matched"] / acc["total"] if acc["total"] else 0.0
        if confidence < min_confidence:
            continue
        a_token = audio[acc["first_audio_idx"]]
        ep: EpubToken = acc["first_epub"]
        anchors.append(
            SentenceAnchor(
                audio_seconds=a_token.start_seconds,
                epub_cfi=ep.cfi,
                char_offset=ep.char_offset,
                percent_complete=ep.percent_complete,
                confidence=confidence,
            )
        )
    anchors.sort(key=lambda a: a.audio_seconds)
    return anchors
