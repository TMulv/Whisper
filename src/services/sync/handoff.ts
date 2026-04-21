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

  const ch =
    findChapterByEpubIndex(alignment, epub.chapterIndex) ??
    findChapterByEpubPercent(alignment, epub.percentComplete);

  if (!ch) {
    return { chapterIndex: 0, timestampSeconds: 0, percentComplete: 0 };
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
    return { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0 };
  }

  const ch = findChapterByAudioSeconds(alignment, audio.timestampSeconds);
  if (!ch) {
    return { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0 };
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
    percentComplete,
  };
}
