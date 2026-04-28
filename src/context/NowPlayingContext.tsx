import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import TrackPlayer, { useProgress, usePlaybackState, State } from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { setupPlayer, loadBook, play } from '@/services/audio/trackPlayerService';
import { POSITIONS_CACHE_KEY } from '@/constants/config';

interface NowPlayingState {
  book: LocalBook | null;
  chapters: M4BChapter[];
}

interface NowPlayingContextValue extends NowPlayingState {
  startPlayback: (book: LocalBook, chapters: M4BChapter[], startTimestamp?: number) => Promise<void>;
  clearNowPlaying: () => Promise<void>;
  setChapters: (chapters: M4BChapter[]) => void;
  updateBookCover: (bookId: string, coverUri: string) => void;
}

const NowPlayingContext = createContext<NowPlayingContextValue>({
  book: null,
  chapters: [],
  startPlayback: async () => {},
  clearNowPlaying: async () => {},
  setChapters: () => {},
  updateBookCover: () => {},
});

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const [book, setBook] = useState<LocalBook | null>(null);
  const [chapters, setChapters] = useState<M4BChapter[]>([]);
  const playerReady = React.useRef(false);

  // Persist audio position so the reader can resume from the right spot
  // even after the app is closed or audio is paused and not replayed.
  const { position: audioPosition } = useProgress(5000);
  const playbackState = usePlaybackState();
  const audioSaveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveAudioPosition = useCallback(
    (pos: number) => {
      if (!book || pos <= 0) return;
      const currentChapter = chapters.reduce(
        (best, ch) => (ch.startSeconds <= pos ? ch : best),
        chapters[0] ?? null,
      );
      const key = `${POSITIONS_CACHE_KEY}:${book.id}:audio`;
      AsyncStorage.setItem(
        key,
        JSON.stringify({
          bookId: book.id,
          timestampSeconds: pos,
          chapterIndex: currentChapter?.index ?? 0,
          updatedAt: Date.now(),
        }),
      ).catch(() => {});
    },
    [book, chapters],
  );

  // Debounced save during playback (every ~5 s via useProgress interval)
  useEffect(() => {
    if (!book || audioPosition <= 0) return;
    if (audioSaveDebounce.current) clearTimeout(audioSaveDebounce.current);
    audioSaveDebounce.current = setTimeout(() => saveAudioPosition(audioPosition), 2000);
  }, [audioPosition, book, saveAudioPosition]);

  // Immediate save on pause or stop so position is never lost on exit
  useEffect(() => {
    const state = playbackState.state;
    if (state !== State.Paused && state !== State.Stopped) return;
    saveAudioPosition(audioPosition);
  }, [playbackState.state, audioPosition, saveAudioPosition]);

  const startPlayback = useCallback(async (
    newBook: LocalBook,
    newChapters: M4BChapter[],
    startTimestamp: number = 0,
  ) => {
    if (!playerReady.current) {
      const ok = await setupPlayer();
      if (!ok) throw new Error('Failed to initialise audio player');
      playerReady.current = true;
    }
    await loadBook(newBook, newChapters, startTimestamp);
    setBook(newBook);
    setChapters(newChapters);
    await play();
  }, []);

  const clearNowPlaying = useCallback(async () => {
    await TrackPlayer.reset();
    setBook(null);
    setChapters([]);
  }, []);

  const updateBookCover = useCallback((bookId: string, coverUri: string) => {
    setBook((prev) => (prev?.id === bookId ? { ...prev, coverUri } : prev));
  }, []);

  return (
    <NowPlayingContext.Provider value={{ book, chapters, startPlayback, clearNowPlaying, setChapters, updateBookCover }}>
      {children}
    </NowPlayingContext.Provider>
  );
}

export function useNowPlaying(): NowPlayingContextValue {
  return useContext(NowPlayingContext);
}
