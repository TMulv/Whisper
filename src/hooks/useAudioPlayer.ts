import { useState, useEffect, useCallback } from 'react';
import TrackPlayer, { Event, State, useTrackPlayerEvents, useProgress } from 'react-native-track-player';
import { M4BChapter } from '@/types/sync';
import {
  play,
  pause,
  seekToTimestamp,
  seekToChapter,
  skipForward,
  skipBackward,
  setRate,
} from '@/services/audio/trackPlayerService';

const TRACKED_EVENTS = [Event.PlaybackState, Event.PlaybackError];

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [chapters, setChapters] = useState<M4BChapter[]>([]);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const { position, duration, buffered } = useProgress();

  useTrackPlayerEvents(TRACKED_EVENTS, (event) => {
    if (event.type === Event.PlaybackState) {
      setIsPlaying(event.state === State.Playing);
    }
  });

  const currentChapter: M4BChapter | null = chapters.length > 0
    ? chapters.reduce((best, ch) => {
        if (ch.startSeconds <= position) return ch;
        return best;
      }, chapters[0])
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
