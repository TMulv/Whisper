import {
  BookAlignment,
  ChapterAlignment,
  ParagraphWeight,
  SentenceAnchor,
} from '@/types/sync';
import { EpubPosition, AudioPosition } from '@/types/position';
import {
  audioSecondsToParagraphCfi,
  paragraphPositionToAudioSeconds,
} from './paragraphWeights';
import type { AssemblyWord } from './assemblyAiAdapter';

// Single source of truth for bi-directional audiobook ↔ ebook handoff.
// Replaces the old percent-of-book math that lived in prepareBookForPlayback,
// useImmersionReading, and ReaderScreen. See
// docs/superpowers/specs/2026-04-20-audiobook-ebook-sync-design.md.

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

// ── Chapter lookups ─────────────────────────────────────────────────────────

function findChapterByEpubIndex(
  alignment: BookAlignment,
  epubChapterIndex: number,
): ChapterAlignment | null {
  return (
    alignment.chapters.find((c) => c.epubChapterIndex === epubChapterIndex) ??
    null
  );
}

function findChapterByEpubPercent(
  alignment: BookAlignment,
  percent: number,
): ChapterAlignment | null {
  const clamped = clamp(percent, 0, 1);
  // Chapters are stored in audio order; search by percent span.
  for (const ch of alignment.chapters) {
    if (clamped >= ch.epubPercentStart && clamped < ch.epubPercentEnd) {
      return ch;
    }
  }
  return alignment.chapters[alignment.chapters.length - 1] ?? null;
}

function findChapterByAudioSeconds(
  alignment: BookAlignment,
  seconds: number,
): ChapterAlignment | null {
  for (const ch of alignment.chapters) {
    if (seconds >= ch.audioStartSeconds && seconds < ch.audioEndSeconds) {
      return ch;
    }
  }
  return alignment.chapters[alignment.chapters.length - 1] ?? null;
}

// ── L1 anchor interpolation ─────────────────────────────────────────────────

/**
 * Binary-search the anchor list for the largest anchor whose key is <= `key`.
 * Returns the index of that anchor (or 0 if all anchors are past `key`, or -1
 * if the list is empty).
 */
function floorIndex(
  anchors: SentenceAnchor[],
  key: number,
  pick: (a: SentenceAnchor) => number,
): number {
  if (anchors.length === 0) return -1;
  let lo = 0;
  let hi = anchors.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pick(anchors[mid]) <= key) lo = mid;
    else hi = mid - 1;
  }
  return pick(anchors[lo]) <= key ? lo : 0;
}

function anchorsForChapter(
  alignment: BookAlignment,
  audioChapterIndex: number,
): SentenceAnchor[] {
  const list = alignment.l1Anchors[audioChapterIndex];
  return list && list.length > 0 ? list : [];
}

function weightsForChapter(
  alignment: BookAlignment,
  audioChapterIndex: number,
): ParagraphWeight[] {
  const list = alignment.paragraphWeights?.[audioChapterIndex];
  return list && list.length > 0 ? list : [];
}

// ── Proportional helpers (L0 fallback) ──────────────────────────────────────

function chapterProgressFromEpubPercent(
  ch: ChapterAlignment,
  epubPercent: number,
): number {
  const span = ch.epubPercentEnd - ch.epubPercentStart;
  if (span <= 0) return 0;
  return clamp((epubPercent - ch.epubPercentStart) / span, 0, 1);
}

function chapterProgressFromAudioSeconds(
  ch: ChapterAlignment,
  seconds: number,
): number {
  const span = ch.audioEndSeconds - ch.audioStartSeconds;
  if (span <= 0) return 0;
  return clamp((seconds - ch.audioStartSeconds) / span, 0, 1);
}

// ── Public resolver ─────────────────────────────────────────────────────────

export function readerToAudio(
  epub: EpubPosition,
  alignment: BookAlignment | null,
): AudioPosition {
  if (!alignment || alignment.chapters.length === 0) {
    // No alignment at all — callers should avoid this path, but if they hit it
    // we return a zero position rather than the old percent-of-book math.
    return { chapterIndex: 0, timestampSeconds: 0, percentComplete: 0 };
  }

  // When percentComplete is available, always use percent-based chapter lookup.
  // epub.js reports chapterIndex by counting spine items, but the L0 alignment
  // uses TOC-chapter counting — the two systems disagree for books with front
  // matter or appendices, so the index lookup maps to the wrong audio chapter.
  // percentComplete is a book-wide fraction that is independent of either
  // counting scheme and always maps correctly.
  const ch = epub.percentComplete > 0
    ? findChapterByEpubPercent(alignment, epub.percentComplete)
    : (findChapterByEpubIndex(alignment, epub.chapterIndex) ??
       findChapterByEpubPercent(alignment, epub.percentComplete));

  if (!ch) {
    console.error('[readerToAudio] no chapter found', {
      epubPercent: epub.percentComplete,
      epubChapterIndex: epub.chapterIndex,
      alignmentSize: alignment.chapters.length,
      chapters: alignment.chapters.slice(0, 3).map(c => ({
        audioChapterIndex: c.audioChapterIndex,
        epubPercentStart: c.epubPercentStart,
        epubPercentEnd: c.epubPercentEnd,
      })),
    });
    return { chapterIndex: 0, timestampSeconds: 0, percentComplete: 0 };
  }

  // Pre-L0: Use epub.js's paginated displayed.page/displayed.total as the chapter
  // fraction when percentComplete is unavailable (0 before locations.generate()
  // completes). Only valid when there are multiple audio chapters — for single-
  // chapter audio the fraction is chapter-local and cannot be mapped to book-wide
  // time without the total epub chapter count (which isn't stored in the alignment).
  if (
    epub.percentComplete === 0 &&
    epub.chapterFraction >= 0 &&
    alignment.chapters.length > 1
  ) {
    const timestampSeconds =
      ch.audioStartSeconds +
      epub.chapterFraction * (ch.audioEndSeconds - ch.audioStartSeconds);
    return {
      chapterIndex: ch.audioChapterIndex,
      timestampSeconds: clamp(
        timestampSeconds,
        ch.audioStartSeconds,
        ch.audioEndSeconds,
      ),
      percentComplete: epub.percentComplete,
    };
  }

  // L1: use the anchor closest to this epub position if any exist.
  const anchors = anchorsForChapter(alignment, ch.audioChapterIndex);
  if (anchors.length > 0) {
    const idx = floorIndex(anchors, epub.percentComplete, (a) => a.percentComplete);
    const a = anchors[Math.max(0, idx)];
    const b = anchors[Math.min(anchors.length - 1, idx + 1)];
    if (a === b || b.percentComplete <= a.percentComplete) {
      return {
        chapterIndex: ch.audioChapterIndex,
        timestampSeconds: a.audioSeconds,
        percentComplete: epub.percentComplete,
      };
    }
    const t = clamp(
      (epub.percentComplete - a.percentComplete) /
        (b.percentComplete - a.percentComplete),
      0,
      1,
    );
    return {
      chapterIndex: ch.audioChapterIndex,
      timestampSeconds: a.audioSeconds + t * (b.audioSeconds - a.audioSeconds),
      percentComplete: epub.percentComplete,
    };
  }

  // L0.5: paragraph-weighted inside the chapter. If we've rendered this
  // chapter in the reader at least once we have char counts per paragraph,
  // which puts us at paragraph accuracy without any ASR.
  const weights = weightsForChapter(alignment, ch.audioChapterIndex);
  if (weights.length > 0) {
    const chapterFraction = chapterProgressFromEpubPercent(
      ch,
      epub.percentComplete,
    );
    const seconds = paragraphPositionToAudioSeconds(
      weights,
      ch.audioStartSeconds,
      ch.audioEndSeconds,
      { cfi: epub.cfi || undefined, chapterFraction },
    );
    if (seconds !== null) {
      return {
        chapterIndex: ch.audioChapterIndex,
        timestampSeconds: seconds,
        percentComplete: epub.percentComplete,
      };
    }
  }

  // L0: proportional within chapter.
  const progress = chapterProgressFromEpubPercent(ch, epub.percentComplete);
  const timestampSeconds =
    ch.audioStartSeconds +
    progress * (ch.audioEndSeconds - ch.audioStartSeconds);
  if (timestampSeconds === 0 && epub.percentComplete > 0) {
    console.warn('[readerToAudio] L0 tier returned 0 timestamp despite non-zero epub percent', {
      epubPercent: epub.percentComplete,
      chapterIndex: ch.audioChapterIndex,
      epubPercentStart: ch.epubPercentStart,
      epubPercentEnd: ch.epubPercentEnd,
      progress,
      audioStart: ch.audioStartSeconds,
      audioEnd: ch.audioEndSeconds,
    });
  }
  return {
    chapterIndex: ch.audioChapterIndex,
    timestampSeconds,
    percentComplete: epub.percentComplete,
  };
}

export function audioToReader(
  audio: AudioPosition,
  alignment: BookAlignment | null,
): EpubPosition {
  if (!alignment || alignment.chapters.length === 0) {
    return {
      chapterIndex: 0,
      cfi: '',
      charOffset: 0,
      chapterFraction: -1,
      percentComplete: 0,
    };
  }

  const ch = findChapterByAudioSeconds(alignment, audio.timestampSeconds);
  if (!ch) {
    return {
      chapterIndex: 0,
      cfi: '',
      charOffset: 0,
      chapterFraction: -1,
      percentComplete: 0,
    };
  }

  const anchors = anchorsForChapter(alignment, ch.audioChapterIndex);
  if (anchors.length > 0) {
    const idx = floorIndex(anchors, audio.timestampSeconds, (a) => a.audioSeconds);
    const a = anchors[Math.max(0, idx)];
    const b = anchors[Math.min(anchors.length - 1, idx + 1)];
    // Prefer the nearest anchor's CFI directly — interpolation between CFIs is
    // not meaningful, but we can refine percentComplete with a linear blend.
    if (a === b || b.audioSeconds <= a.audioSeconds) {
      return {
        chapterIndex: ch.epubChapterIndex,
        cfi: a.epubCfi,
        charOffset: a.charOffset,
        chapterFraction: -1,
        percentComplete: a.percentComplete,
      };
    }
    const t = clamp(
      (audio.timestampSeconds - a.audioSeconds) /
        (b.audioSeconds - a.audioSeconds),
      0,
      1,
    );
    // Pick the closer anchor for CFI; interpolate percent for continuity.
    const closer = t < 0.5 ? a : b;
    return {
      chapterIndex: ch.epubChapterIndex,
      cfi: closer.epubCfi,
      charOffset: closer.charOffset,
      chapterFraction: -1,
      percentComplete:
        a.percentComplete + t * (b.percentComplete - a.percentComplete),
    };
  }

  // L0.5: paragraph-weighted. If we have char counts for this chapter we can
  // return the CFI of whichever paragraph is currently being narrated, which
  // is what drives the page-follows-audio behaviour during immersion.
  const weights = weightsForChapter(alignment, ch.audioChapterIndex);
  if (weights.length > 0) {
    const cfi = audioSecondsToParagraphCfi(
      weights,
      ch.audioStartSeconds,
      ch.audioEndSeconds,
      audio.timestampSeconds,
    );
    if (cfi) {
      const progress = chapterProgressFromAudioSeconds(
        ch,
        audio.timestampSeconds,
      );
      return {
        chapterIndex: ch.epubChapterIndex,
        cfi,
        charOffset: 0,
        chapterFraction: -1,
        percentComplete:
          ch.epubPercentStart +
          progress * (ch.epubPercentEnd - ch.epubPercentStart),
      };
    }
  }

  // L0: proportional within chapter. No anchors and no weights means we only
  // know the chapter; any CFI we'd synthesize here is a chapter-base-only CFI
  // (no `!` separator / inner path) that epub.js' parser crashes on when
  // handed to rendition.display. Return an empty cfi so callers navigate by
  // chapterIndex instead.
  const progress = chapterProgressFromAudioSeconds(ch, audio.timestampSeconds);
  const percentComplete =
    ch.epubPercentStart + progress * (ch.epubPercentEnd - ch.epubPercentStart);
  return {
    chapterIndex: ch.epubChapterIndex,
    cfi: '',
    charOffset: 0,
    chapterFraction: -1,
    percentComplete,
  };
}

// ── Word-match handoff ──────────────────────────────────────────────────────
//
// When AssemblyAI has produced a word-level transcript for the audio, we can
// bypass L0/L0.5/L1 entirely: take the next 8 words the user is about to
// read, find that sequence in the transcript, and seek to the matched word's
// start time. This is sentence-accurate without requiring DTW pre-alignment.
//
// The match is windowed to ±5 minutes around a hint timestamp (typically the
// L0 result) so we don't accidentally lock onto a duplicate phrase from a
// different chapter. Score is exact-token matches; ties go to the run nearest
// the hint.

const WINDOW_SECONDS = 5 * 60;
const MIN_SCORE = 5; // out of 8 — tolerates narrator skipping a stop-word or two

/** Lowercase, strip non-alphanumeric, drop empty. Keeps numbers + apostrophes. */
function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/g, '');
}

export function tokenizeSnippet(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
}

/**
 * Given a snippet (the next words the user is about to read) and the audio's
 * full word transcript, find the best matching run within ±WINDOW_SECONDS of
 * `hintSeconds`. Returns the start time of the matched run in seconds, or
 * null if no run scores above MIN_SCORE.
 */
export function findAudioWordMatch(
  snippet: string[],
  audioWords: AssemblyWord[],
  hintSeconds: number,
): number | null {
  if (snippet.length < 3 || audioWords.length === 0) return null;

  const target = snippet.slice(0, 8);
  const tLen = target.length;
  if (tLen < 3) return null;

  const lo = (hintSeconds - WINDOW_SECONDS) * 1000;
  const hi = (hintSeconds + WINDOW_SECONDS) * 1000;

  // Pre-normalize transcript words once. Track original indices so we can
  // recover the start time after scoring.
  const normWords: string[] = [];
  const wordIdx: number[] = [];
  for (let i = 0; i < audioWords.length; i++) {
    const w = audioWords[i];
    if (w.end < lo || w.start > hi) continue;
    const n = normalizeToken(w.text);
    if (!n) continue;
    normWords.push(n);
    wordIdx.push(i);
  }
  if (normWords.length < tLen) return null;

  let bestScore = 0;
  let bestStart = -1;
  let bestDistance = Infinity;

  for (let i = 0; i + tLen <= normWords.length; i++) {
    let score = 0;
    for (let j = 0; j < tLen; j++) {
      if (normWords[i + j] === target[j]) score++;
    }
    if (score < MIN_SCORE) continue;

    const wStart = audioWords[wordIdx[i]].start; // ms
    const distance = Math.abs(wStart / 1000 - hintSeconds);
    if (
      score > bestScore ||
      (score === bestScore && distance < bestDistance)
    ) {
      bestScore = score;
      bestStart = wStart / 1000;
      bestDistance = distance;
    }
  }

  return bestStart >= 0 ? bestStart : null;
}
