import { useEffect, useRef, useState, RefObject } from 'react';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { EpubWebViewRef } from '@/components/reader/EpubWebView';
import { M4BChapter, BookAlignment } from '@/types/sync';
import { getAlignment } from '@/services/sync/alignmentStore';

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

// Immersion mode is "audio plays, reader follows along." Phase 1 scope is
// chapter-level: when the audio chapter changes, navigate the reader to the
// matching epub chapter (looked up via the handoff alignment so M != N books
// are handled correctly). The old sub-chapter per-2-second seekToPercent has
// been removed — that was live-sync territory and relied on whole-book
// percent drift that no longer exists.
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

  // Keep the reader's progress highlight cleared when immersion isn't active.
  useEffect(() => {
    if (!enabled || !isPlaying) {
      webViewRef.current?.clearHighlight();
    }
  }, [enabled, isPlaying, webViewRef]);

  return { isPlaying, position, duration, currentAudioChapter };
}
