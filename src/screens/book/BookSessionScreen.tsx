import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  BackHandler,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList, BookSessionMode } from '@/navigation/types';
import { useAuth } from '@/hooks/useAuth';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { localListBooks } from '@/services/book/localBookStore';
import { getCachedPath } from '@/services/storage/localStorageService';
import { prepareBookForPlayback } from '@/services/audio/prepareBookForPlayback';
import { seekToTimestamp } from '@/services/audio/trackPlayerService';
import {
  loadCachedAssemblyAiWords,
} from '@/services/sync/assemblyAiAdapter';
import {
  findAudioWordMatch,
  tokenizeSnippet,
  readerToAudio,
} from '@/services/sync/handoff';
import { getOrBuildLayer0 } from '@/services/sync/alignmentStore';
import TrackPlayer from 'react-native-track-player';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
import { logger } from '@/utils/logger';
import ReaderView, { ReaderViewRef } from '@/components/book/ReaderView';
import ListenView from '@/components/book/ListenView';
import ModeToggle from '@/components/book/ModeToggle';

type Props = NativeStackScreenProps<RootStackParamList, 'BookSession'>;

const FADE_MS = 180;

export default function BookSessionScreen() {
  const { params } = useRoute<Props['route']>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { book: nowPlayingBook, chapters: audioChapters, startPlayback } = useNowPlaying();

  const [mode, setMode] = useState<BookSessionMode>(params.mode);
  const [hasEpub, setHasEpub] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [switching, setSwitching] = useState(false);
  const resumeFromAudio = !!params.resumeFromAudio;

  const readerRef = useRef<ReaderViewRef>(null);
  const readerOpacity = useRef(new Animated.Value(params.mode === 'read' ? 1 : 0)).current;
  const listenOpacity = useRef(new Animated.Value(params.mode === 'listen' ? 1 : 0)).current;

  const audioLoadedForThisBook = nowPlayingBook?.id === params.bookId;

  // Refs mirror live audio state so beforeRemove can read them without
  // re-registering the listener on every chapter/load change.
  const audioLoadedRef = useRef(audioLoadedForThisBook);
  const audioChaptersRef = useRef(audioChapters);
  useEffect(() => { audioLoadedRef.current = audioLoadedForThisBook; }, [audioLoadedForThisBook]);
  useEffect(() => { audioChaptersRef.current = audioChapters; }, [audioChapters]);
  const showToggle = hasEpub && hasAudio;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const books = await localListBooks(user.uid);
        const meta = books.find((b) => b.id === params.bookId);
        if (cancelled || !meta) return;
        const epubExists = !!meta.epubPath;
        let audioExists = false;
        if (meta.audioPath) {
          const ext = meta.audioPath.split('.').pop() ?? 'm4b';
          const audioUri = await getCachedPath(params.bookId, 'audio', ext);
          audioExists = !!audioUri;
        }
        if (!cancelled) {
          setHasEpub(epubExists);
          setHasAudio(audioExists);
        }
      } catch (err) {
        logger.warn('BookSession: failed to detect available formats', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user, params.bookId]);

  useEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => {
      parent?.setOptions({
        tabBarStyle: {
          borderTopWidth: 0,
          backgroundColor: '#FAF7F1',
          height: 64 + (Platform.OS === 'ios' ? 18 : 0),
          paddingTop: 6,
        },
      });
    };
  }, [navigation]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack();
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      // Epub — synchronous ref read; safe even as WebView begins unmounting.
      const epubPos = readerRef.current?.getLastKnownPosition();
      if (epubPos?.cfi) {
        AsyncStorage.setItem(
          `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`,
          JSON.stringify({ ...epubPos, savedAt: Date.now() }),
        ).catch(() => {});
      }

      // Audio — fire-and-forget; TrackPlayer is an app-level singleton and
      // stays alive after this screen unmounts, so the async call is safe.
      // This covers the window where the debounced save in NowPlayingContext
      // hasn't fired yet (up to ~7 s while playing).
      if (audioLoadedRef.current) {
        TrackPlayer.getProgress()
          .then((p) => {
            if (p.position <= 0) return;
            const chs = audioChaptersRef.current;
            const chapter = chs.length > 0
              ? chs.reduce((best, ch) => (ch.startSeconds <= p.position ? ch : best), chs[0])
              : null;
            return AsyncStorage.setItem(
              `${POSITIONS_CACHE_KEY}:${params.bookId}:audio`,
              JSON.stringify({
                bookId: params.bookId,
                timestampSeconds: p.position,
                chapterIndex: chapter?.index ?? 0,
                updatedAt: Date.now(),
              }),
            );
          })
          .catch(() => {});
      }
    });
    return unsub;
  }, [navigation, params.bookId]);

  const animateTo = useCallback((next: BookSessionMode) => {
    Animated.parallel([
      Animated.timing(readerOpacity, {
        toValue: next === 'read' ? 1 : 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(listenOpacity, {
        toValue: next === 'listen' ? 1 : 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [readerOpacity, listenOpacity]);

  const handleSwitchMode = useCallback(async (next: BookSessionMode) => {
    if (next === mode || switching) return;

    if (next === 'listen') {
      if (!user || !hasAudio) {
        setMode(next);
        animateTo(next);
        return;
      }
      setSwitching(true);
      try {
        // Flush the last known reader position synchronously before any async
        // work so the AsyncStorage fallback inside prepareBookForPlayback is
        // fresh even if the 2 s debounce hasn't fired yet.
        const snapPos = readerRef.current?.getLastKnownPosition();
        if (snapPos?.cfi) {
          AsyncStorage.setItem(
            `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`,
            JSON.stringify({ ...snapPos, savedAt: Date.now() }),
          ).catch(() => {});
        }

        const livePos = await readerRef.current?.getCurrentPosition();
        // Fall back to the synchronous ref when the async bridge returns empty
        // (common before epub.js locations.generate() finishes).
        const epubPos =
          (livePos && (livePos.percentComplete > 0 || livePos.cfi))
            ? livePos
            : (readerRef.current?.getLastKnownPosition() ?? undefined);

        const wordMatch = async (
          audioPath: string | null | undefined,
          hintSeconds: number,
        ): Promise<number | null> => {
          if (!audioPath) return null;
          try {
            const cachedWords = await loadCachedAssemblyAiWords(audioPath);
            const snippetWords = await readerRef.current?.getVisibleSnippet(8, 1500);
            if (!cachedWords || cachedWords.length === 0) return null;
            if (!snippetWords || snippetWords.length < 3) return null;
            const tokens = tokenizeSnippet(snippetWords.join(' '));
            return findAudioWordMatch(tokens, cachedWords, hintSeconds);
          } catch (err) {
            logger.warn('BookSession: word-match failed', err);
            return null;
          }
        };

        if (audioLoadedForThisBook && audioChapters.length > 0 && epubPos) {
          // Audio already loaded — just seek to the reader's current position.
          const alignment = await getOrBuildLayer0(
            params.bookId,
            audioChapters,
            audioChapters.length,
          );
          const target = readerToAudio(
            {
              chapterIndex: epubPos.chapterIndex,
              cfi: epubPos.cfi,
              charOffset: epubPos.charOffset ?? 0,
              chapterFraction: -1,
              percentComplete: epubPos.percentComplete,
            },
            alignment,
          );
          const audioPath = nowPlayingBook?.localAudioUri ?? null;
          const matched = await wordMatch(audioPath, target.timestampSeconds);
          const seekTs = Math.max(0, matched ?? target.timestampSeconds);
          logger.info('BookSession: seeking loaded audio to reader position', {
            l0: target.timestampSeconds,
            matched,
            seekTs,
          });
          await seekToTimestamp(seekTs);
        } else if (!audioLoadedForThisBook) {
          // Audio not loaded — prepare from disk, then start at the reader's
          // position (word-matched if AAI cache available, else L0).
          const prepared = await prepareBookForPlayback(user.uid, params.bookId, epubPos ?? undefined);
          if (prepared) {
            const audioPath = prepared.localBook.localAudioUri;
            const matched = await wordMatch(audioPath, prepared.startTimestamp);
            const startTs = matched ?? prepared.startTimestamp;
            logger.info('BookSession: starting audio at reader position', {
              hint: prepared.startTimestamp,
              matched,
              startTs,
            });
            await startPlayback(prepared.localBook, prepared.chapters, startTs);
          }
        }
      } catch (err) {
        logger.warn('BookSession: failed to align audio on switch', err);
      } finally {
        setSwitching(false);
      }
    } else if (next === 'read') {
      if (audioLoadedForThisBook && audioChapters.length > 0) {
        try {
          const audioPos = await TrackPlayer.getProgress().then((p) => p.position).catch(() => 0);
          // Only sync reader if audio has actually played. If the user switched
          // to audio but didn't listen (audioPos=0), the reader stays at its
          // current page — correct because manual user nav cleared pendingCfi.
          if (audioPos > 0) {
            const audioChIdx = audioChapters.reduce(
              (best, ch) => (ch.startSeconds <= audioPos ? ch : best),
              audioChapters[0],
            ).index;
            await readerRef.current?.syncToAudio(audioPos, audioChIdx);
          }
        } catch (err) {
          logger.warn('BookSession: failed to sync reader to audio', err);
        }
      }
    }

    setMode(next);
    animateTo(next);
  }, [mode, switching, audioLoadedForThisBook, audioChapters, hasAudio, user, params.bookId, nowPlayingBook, startPlayback, animateTo]);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close book"
          accessibilityRole="button"
        >
          <Text style={styles.backIcon}>⌄</Text>
        </TouchableOpacity>

        <View style={styles.toggleSlot}>
          {showToggle && (
            <ModeToggle
              mode={mode}
              onChange={handleSwitchMode}
              outOfSync={false}
            />
          )}
        </View>

        <View style={styles.rightSlot} />
      </View>

      <View style={styles.body}>
        {hasEpub && (
          <Animated.View
            style={[styles.viewLayer, { opacity: readerOpacity }]}
            pointerEvents={mode === 'read' ? 'auto' : 'none'}
          >
            <ReaderView
              ref={readerRef}
              bookId={params.bookId}
              resumeFromAudio={resumeFromAudio}
              onClose={() => navigation.goBack()}
            />
          </Animated.View>
        )}

        {hasAudio && (
          <Animated.View
            style={[styles.viewLayer, { opacity: listenOpacity }]}
            pointerEvents={mode === 'listen' ? 'auto' : 'none'}
          >
            <ListenView bookId={params.bookId} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 28,
    color: '#fff',
    lineHeight: 28,
    marginTop: -6,
  },
  toggleSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightSlot: {
    width: 40,
    height: 40,
  },
  body: {
    flex: 1,
    position: 'relative',
  },
  viewLayer: {
    ...StyleSheet.absoluteFillObject,
  },
});
