import { useEffect, useRef, useCallback, RefObject } from 'react';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { EpubWebViewRef } from '@/components/reader/EpubWebView';
import { M4BChapter } from '@/types/sync';

const HIGHLIGHT_THROTTLE_MS = 1200;

interface ImmersionReadingOptions {
  webViewRef: RefObject<EpubWebViewRef | null>;
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

export function useImmersionReading({
  webViewRef,
  audioChapters,
  epubChapterCount,
  enabled,
}: ImmersionReadingOptions): ImmersionState {
  const { position, duration } = useProgress(500);
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;

  const lastHighlightRef = useRef(0);
  const lastChapterIndexRef = useRef(-1);

  const currentAudioChapter: M4BChapter | null =
    audioChapters.length > 0
      ? audioChapters.reduce((best, ch) => {
          if (ch.startSeconds <= position) return ch;
          return best;
        }, audioChapters[0])
      : null;

  // Map audio chapter index → epub chapter index
  // If counts match, use 1:1. Otherwise scale proportionally.
  const epubChapterIndex = useCallback(
    (audioIdx: number): number => {
      if (epubChapterCount === 0) return 0;
      if (audioChapters.length === epubChapterCount) return audioIdx;
      return Math.round((audioIdx / Math.max(audioChapters.length - 1, 1)) * (epubChapterCount - 1));
    },
    [audioChapters.length, epubChapterCount],
  );

  // When chapter changes, navigate the reader to that chapter
  useEffect(() => {
    if (!enabled || !currentAudioChapter) return;
    const mappedIdx = epubChapterIndex(currentAudioChapter.index);
    if (mappedIdx !== lastChapterIndexRef.current) {
      lastChapterIndexRef.current = mappedIdx;
      webViewRef.current?.goToChapter(mappedIdx);
    }
  }, [enabled, currentAudioChapter?.index, epubChapterIndex, webViewRef]);

  // Throttled highlight: update within-chapter progress
  useEffect(() => {
    if (!enabled || !isPlaying || !currentAudioChapter) return;

    const now = Date.now();
    if (now - lastHighlightRef.current < HIGHLIGHT_THROTTLE_MS) return;
    lastHighlightRef.current = now;

    const chapterDuration = currentAudioChapter.endSeconds - currentAudioChapter.startSeconds;
    const ratio =
      chapterDuration > 0
        ? Math.max(0, Math.min(1, (position - currentAudioChapter.startSeconds) / chapterDuration))
        : 0;

    webViewRef.current?.highlightProgress(ratio);
  });

  // Clear highlight when immersion mode is disabled or playback stops
  useEffect(() => {
    if (!enabled || !isPlaying) {
      webViewRef.current?.clearHighlight();
    }
  }, [enabled, isPlaying, webViewRef]);

  return { isPlaying, position, duration, currentAudioChapter };
}
