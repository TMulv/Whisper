import { useEffect, useRef, useState, RefObject } from 'react';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { EpubWebViewRef } from '@/components/reader/EpubWebView';
import { M4BChapter, BookAlignment } from '@/types/sync';
import { getAlignment } from '@/services/sync/alignmentStore';
import { audioToReader } from '@/services/sync/handoff';

interface ImmersionReadingOptions {
  webViewRef: RefObject<EpubWebViewRef | null>;
  bookId: string | null;
  audioChapters: M4BChapter[];
  epubChapterCount: number;
  enabled: boolean;
}

export interface ImmersionState {
  isPlaying: boolean;
  position: number;
  duration: number;
  currentAudioChapter: M4BChapter | null;
}

// Immersion mode is "audio plays, reader follows along." Two loops run while
// enabled:
//
//   1. Chapter-switch loop — when the audio chapter index flips, navigate the
//      reader to the matching epub chapter via the handoff alignment.
//   2. Live-follow loop — every 500 ms (from useProgress) compute the
//      paragraph fraction inside the current audio chapter and ask the epub
//      WebView to highlight + smooth-scroll that paragraph. The bridge's
//      `highlightProgress(ratio)` picks the block at index `r * blocks.length`
//      inside the current chapter, which gives us paragraph-granular
//      follow-along today — no Whisper, no CFI round-trip required.
//
// When L1 anchors (or L0.5 paragraph weights) exist for this chapter,
// `audioToReader` returns a real CFI; a future bridge method `scrollToCfi`
// would make the follow-along sentence-accurate. Until then, chapter-fraction
// is a significant upgrade over the previous chapter-only behaviour.
export function useImmersionReading({
  webViewRef,
  bookId,
  audioChapters,
  epubChapterCount,
  enabled,
}: ImmersionReadingOptions): ImmersionState {
  const { position, duration } = useProgress(500);
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;

  const [alignment, setAlignment] = useState<BookAlignment | null>(null);
  const lastEpubChapterRef = useRef(-1);

  // Load alignment once per book. Safe to be optimistic — if it's missing the
  // resolver falls back to proportional mapping driven by chapter counts.
  useEffect(() => {
    let cancelled = false;
    if (!bookId) {
      setAlignment(null);
      return;
    }
    getAlignment(bookId).then((a) => {
      if (!cancelled) setAlignment(a);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const currentAudioChapter: M4BChapter | null =
    audioChapters.length > 0
      ? audioChapters.reduce((best, ch) => {
          if (ch.startSeconds <= position) return ch;
          return best;
        }, audioChapters[0])
      : null;

  // When the audio chapter changes, navigate the reader to the matching epub
  // chapter. Prefer the alignment's mapping; fall back to proportional if
  // alignment hasn't loaded yet.
  useEffect(() => {
    if (!enabled || !currentAudioChapter) return;
    const audioIdx = currentAudioChapter.index;
    let epubIdx: number;
    const aligned = alignment?.chapters.find(
      (c) => c.audioChapterIndex === audioIdx,
    );
    if (aligned) {
      epubIdx = aligned.epubChapterIndex;
    } else if (epubChapterCount > 0) {
      epubIdx =
        audioChapters.length === epubChapterCount
          ? audioIdx
          : Math.round(
              (audioIdx / Math.max(audioChapters.length - 1, 1)) *
                (epubChapterCount - 1),
            );
    } else {
      return;
    }
    if (epubIdx !== lastEpubChapterRef.current) {
      lastEpubChapterRef.current = epubIdx;
      webViewRef.current?.goToChapter(epubIdx);
    }
  }, [
    enabled,
    currentAudioChapter?.index,
    alignment,
    audioChapters.length,
    epubChapterCount,
    webViewRef,
  ]);

  // Live-follow: every 500 ms, ask the reader to highlight the paragraph that
  // matches the current audio position inside its chapter. Chapter-fraction is
  // derived from the audio timestamp relative to the current audio chapter's
  // span, which makes this robust across M != N books (where audio chapter
  // index doesn't match epub chapter index).
  //
  // Throttled on "paragraph changed": we only reissue the highlight when the
  // rounded block index would move. That keeps the WebView's smooth-scroll
  // from stuttering on every 500 ms tick.
  const lastBlockRef = useRef<number>(-1);
  // Book-wide page bucket — drives page-turn navigation so the reader
  // advances through the book as audio plays, not just at chapter boundaries.
  // 500 buckets ≈ 0.2% of the book per step, ≈ one page at typical audiobook
  // pacing.
  const lastPageBucketRef = useRef<number>(-1);
  useEffect(() => {
    if (!enabled || !isPlaying || !currentAudioChapter) return;

    // Prefer the resolver's percentComplete (honours L1 anchors + L0.5
    // weights when available), falling back to chapter-local fraction.
    let fraction = 0;
    let bookPercent: number | null = null;
    if (alignment) {
      const resolved = audioToReader(
        {
          chapterIndex: currentAudioChapter.index,
          timestampSeconds: position,
          percentComplete: 0,
        },
        alignment,
      );
      bookPercent = resolved.percentComplete;
      const ch = alignment.chapters.find(
        (c) => c.audioChapterIndex === currentAudioChapter.index,
      );
      if (ch) {
        const span = ch.epubPercentEnd - ch.epubPercentStart;
        if (span > 0) {
          fraction = (resolved.percentComplete - ch.epubPercentStart) / span;
        }
      }
    }
    if (!alignment || !Number.isFinite(fraction) || fraction < 0) {
      const chSpan =
        currentAudioChapter.endSeconds - currentAudioChapter.startSeconds;
      fraction =
        chSpan > 0
          ? (position - currentAudioChapter.startSeconds) / chSpan
          : 0;
    }
    fraction = Math.max(0, Math.min(1, fraction));

    // Page-follow: turn the reader's page as audio advances within the
    // chapter. Without this the reader sits on the first page of each
    // chapter until the chapter-switch effect fires. Bucketed so we only
    // issue a navigation when the rounded page index would change.
    if (bookPercent !== null && Number.isFinite(bookPercent)) {
      const clamped = Math.max(0, Math.min(1, bookPercent));
      const pageBucket = Math.round(clamped * 500);
      if (pageBucket !== lastPageBucketRef.current) {
        lastPageBucketRef.current = pageBucket;
        webViewRef.current?.scrollToBookPercent(clamped);
      }
    }

    // Approx paragraph index assuming ~20 visible blocks per chapter rendered
    // in the current viewport. This is a heuristic bucket for throttling —
    // the bridge picks the exact block from live DOM counts.
    const bucket = Math.round(fraction * 40);
    if (bucket === lastBlockRef.current) return;
    lastBlockRef.current = bucket;
    webViewRef.current?.highlightProgress(fraction);
  }, [
    enabled,
    isPlaying,
    position,
    alignment,
    currentAudioChapter?.index,
    currentAudioChapter?.startSeconds,
    currentAudioChapter?.endSeconds,
    webViewRef,
  ]);

  // Keep the reader's progress highlight cleared when immersion isn't active.
  useEffect(() => {
    if (!enabled || !isPlaying) {
      webViewRef.current?.clearHighlight();
      lastBlockRef.current = -1;
      lastPageBucketRef.current = -1;
    }
  }, [enabled, isPlaying, webViewRef]);

  return { isPlaying, position, duration, currentAudioChapter };
}
