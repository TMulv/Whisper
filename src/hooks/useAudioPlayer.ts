import { useState, useCallback } from 'react';
import { State, usePlaybackState, useProgress } from 'react-native-track-player';
import { M4BChapter } from '@/types/sync';
import { useNowPlaying } from '@/context/NowPlayingContext';
import {
  play,
  pause,
  seekToTimestamp,
  seekToChapter,
  skipForward,
  skipBackward,
  setRate,
} from '@/services/audio/trackPlayerService';

interface UseAudioPlayerReturn {
  isPlaying: boolean;
  currentChapter: M4BChapter | null;
  position: number;
  duration: number;
  buffered: number;
  chapters: M4BChapter[];
  playbackRate: number;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  seekToChapter: (chapter: M4BChapter) => Promise<void>;
  skipForward30: () => Promise<void>;
  skipBack30: () => Promise<void>;
  setPlaybackRate: (rate: number) => Promise<void>;
  setChapters: (chapters: M4BChapter[]) => void;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const { chapters, setChapters } = useNowPlaying();
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const { position, duration, buffered } = useProgress();

  const currentChapter: M4BChapter | null = chapters.length > 0
    ? chapters.reduce((best, ch) => (ch.startSeconds <= position ? ch : best), chapters[0])
    : null;

  const handleSetRate = useCallback(async (rate: number) => {
    await setRate(rate);
    setPlaybackRateState(rate);
  }, []);

  return {
    isPlaying,
    currentChapter,
    position,
    duration,
    buffered,
    chapters,
    playbackRate,
    play,
    pause,
    seekTo: seekToTimestamp,
    seekToChapter,
    skipForward30: () => skipForward(30),
    skipBack30: () => skipBackward(30),
    setPlaybackRate: handleSetRate,
    setChapters,
  };
}
