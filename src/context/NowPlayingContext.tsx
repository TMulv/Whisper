import React, { createContext, useContext, useState, useCallback } from 'react';
import TrackPlayer from 'react-native-track-player';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { setupPlayer, loadBook, play } from '@/services/audio/trackPlayerService';

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
