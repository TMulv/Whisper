import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import TrackPlayer, { useProgress, usePlaybackState, State } from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { SyncedPosition } from '@/types/position';
import { setupPlayer, loadBook, play } from '@/services/audio/trackPlayerService';
import { pushPosition } from '@/services/sync/syncEngine';
import { POSITIONS_CACHE_KEY, DEVICE_ID_KEY } from '@/constants/config';

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
  const isRestoringAudioRef = useRef(false);
  const deviceIdRef = useRef<string>('');

  // Load device ID once on mount so it's available synchronously in saveAudioPosition
  useEffect(() => {
    AsyncStorage.getItem(DEVICE_ID_KEY).then((id) => {
      if (id) deviceIdRef.current = id;
    }).catch(() => {});
  }, []);

  // Persist audio position so the reader can resume from the right spot
  // even after the app is closed or audio is paused and not replayed.
  const { position: audioPosition } = useProgress(5000);
  const playbackState = usePlaybackState();
  const audioSaveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveAudioPosition = useCallback(
    (pos: number) => {
      if (!book || pos <= 0) return;
      if (isRestoringAudioRef.current) return;
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

      const uid = getAuth().currentUser?.uid;
      const devId = deviceIdRef.current;
      if (uid && devId) {
        const synced: SyncedPosition = {
          bookId: book.id,
          deviceId: devId,
          chapterIndex: currentChapter?.index ?? 0,
          epubCfi: '',
          charOffset: 0,
          audioTimestamp: pos,
          percentComplete: book.totalDurationSeconds > 0 ? pos / book.totalDurationSeconds : 0,
          source: 'audio',
          updatedAt: Date.now(),
        };
        pushPosition(uid, book.id, devId, synced).catch(() => {});
      }
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

  // AppState → background: flush the latest audio position. Closes the
  // ~7s force-quit gap left by the useProgress(5000)+2s debounce loop.
  // Mirrors the equivalent listener on the EPUB side in ReaderView.
  useEffect(() => {
    const onAppState = (s: AppStateStatus) => {
      if (s !== 'background' && s !== 'inactive') return;
      saveAudioPosition(audioPosition);
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [audioPosition, saveAudioPosition]);

  const startPlayback = useCallback(async (
    newBook: LocalBook,
    newChapters: M4BChapter[],
    startTimestamp: number = 0,
  ) => {
    isRestoringAudioRef.current = true;
    if (!playerReady.current) {
      const ok = await setupPlayer();
      if (!ok) throw new Error('Failed to initialise audio player');
      playerReady.current = true;
    }
    await loadBook(newBook, newChapters, startTimestamp);
    setBook(newBook);
    setChapters(newChapters);
    await play();
    setTimeout(() => { isRestoringAudioRef.current = false; }, 2000);
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
