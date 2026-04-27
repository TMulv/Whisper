import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  BackHandler,
  StatusBar,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { AnimatedLoader } from '@/components/common/AnimatedLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EpubWebView, { EpubWebViewRef, EpubChapter, EpubTheme } from '@/components/reader/EpubWebView';
import SyncBanner from '@/components/reader/SyncBanner';
import ReaderDrawer, {
  ReaderFontFamily,
  ReaderMargin,
  FONT_FAMILY_VALUES,
  MARGIN_VALUES,
} from '@/components/reader/ReaderDrawer';
import TopDrawerModal from '@/components/reader/TopDrawerModal';
import WordLookupModal from '@/components/reader/WordLookupModal';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { useAuth } from '@/hooks/useAuth';
import { useEpubPosition } from '@/hooks/useEpubPosition';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { readSyncState } from '@/services/firebase/firestoreService';
import { localListBooks } from '@/services/book/localBookStore';
import { getCachedPath } from '@/services/storage/localStorageService';
import { prepareBookForPlayback } from '@/services/audio/prepareBookForPlayback';
import { File, Directory, Paths } from 'expo-file-system';
import { CACHE_DIR, POSITIONS_CACHE_KEY } from '@/constants/config';
import { EpubPosition } from '@/types/position';
import { FirestorePosition } from '@/types/firebase';
import { pushPosition } from '@/services/sync/syncEngine';
import { seekToTimestamp } from '@/services/audio/trackPlayerService';
import { getOrBuildLayer0, ensureLayer0Fresh } from '@/services/sync/alignmentStore';
import { readerToAudio, audioToReader } from '@/services/sync/handoff';
import {
  hasCachedChapterText,
  writeCachedChapterText,
} from '@/services/sync/chapterTextCache';
import { getAlignerQueue } from '@/services/sync/onDeviceAligner';
import { logger } from '@/utils/logger';
import type { LibraryStackParamList } from '@/navigation/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Props = NativeStackScreenProps<LibraryStackParamList, 'Reader'>;

const DEVICE_ID_KEY = '@whisper/device_id';
const FONT_SIZE_KEY = '@whisper/font_size';
const FONT_FAMILY_KEY = '@whisper/font_family';
const MARGIN_KEY = '@whisper/margin';
const THEME_KEY = '@whisper/theme';

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now()}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Per-book guard so a remount of ReaderScreen doesn't spawn a second copy
// of the cascade (the first run completes quickly once the cache is warm).
const cascadesInFlight = new Set<string>();

/**
 * Walk the epub spine, extract plain text for each chapter via the WebView
 * bridge, and write it to the on-disk chapter-text cache. Runs
 * sequentially and is best-effort — any per-chapter failure is logged and
 * skipped. Once a chapter is cached, the aligner queue is notified so
 * opportunistic alignment can start on background-queued chapters even
 * while the user is still reading this one.
 */
function cacheChaptersInBackground(
  bookId: string,
  chapterCount: number,
  webViewRef: React.RefObject<EpubWebViewRef | null>,
): void {
  if (cascadesInFlight.has(bookId)) return;
  cascadesInFlight.add(bookId);
  (async () => {
    try {
      for (let i = 0; i < chapterCount; i++) {
        if (hasCachedChapterText(bookId, i)) continue;
        const view = webViewRef.current;
        if (!view) break;
        try {
          const text = await view.getChapterText(i);
          // Empty chapter (e.g. cover-only spine entry) — still cache so
          // we don't retry endlessly; tokenizer returns [] which the
          // aligner handles as a no-op.
          await writeCachedChapterText(bookId, i, text ?? '');
          // Notify the aligner that new chapter text may be alignable.
          // enqueueAllPending is idempotent + skips chapters that already
          // have anchors, so calling it per-chapter just kicks the queue
          // without duplicating work.
          getAlignerQueue()?.enqueueAllPending(bookId).catch(() => {});
        } catch (err) {
          logger.warn('cacheChaptersInBackground: chapter failed', {
            bookId,
            chapterIndex: i,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // Yield to the UI thread between chapters so scrolling stays
        // responsive. 50 ms is conservative — getChapterText is already
        // the long part of each iteration.
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      cascadesInFlight.delete(bookId);
    }
  })();
}

export default function ReaderScreen() {
  const { params } = useRoute<Props['route']>();
  const navigation = useNavigation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<EpubWebViewRef>(null);

  // State
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState(16);
  const [theme, setTheme] = useState<EpubTheme>('light');
  const [fontFamily, setFontFamily] = useState<ReaderFontFamily>('serif');
  const [margin, setMargin] = useState<ReaderMargin>('normal');
  const [lookupWordValue, setLookupWordValue] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [syncBannerData, setSyncBannerData] = useState<FirestorePosition | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [tapSeekToast, setTapSeekToast] = useState(false);
  const [bookHasAudio, setBookHasAudio] = useState(false);
  const [startingAudio, setStartingAudio] = useState(false);
  const [bookTitle, setBookTitle] = useState<string | undefined>(undefined);
  const [locationsReady, setLocationsReady] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);

  const { chapters: audioChapters, book: nowPlayingBook, startPlayback } = useNowPlaying();
  // Audio is "live" for this book only when *this* book's audio is loaded in
  // the player — any other state (nothing loaded, or a different book) means
  // we should offer to start audio rather than act on stale chapters.
  const audioLoadedForThisBook = nowPlayingBook?.id === params.bookId && audioChapters.length > 0;
  const hasAudio = audioLoadedForThisBook;

  // Live audio position — used for reader↔audio handoff and the transport UI.
  const { position: audioPosition, duration: audioDuration } = useProgress(1000);
  const playbackState = usePlaybackState();
  const isAudioPlaying = playbackState.state === State.Playing;
  const currentAudioChapter = audioChapters.length > 0
    ? audioChapters.reduce((best, ch) => (ch.startSeconds <= audioPosition ? ch : best), audioChapters[0])
    : null;

  const readyRef = useRef(false);
  const lastEpubChapterRef = useRef(-1);
  const { position: livePosition, onPositionChange, loadLocalPosition } = useEpubPosition(params.bookId, user?.uid ?? null);

  // ── Mount: load device ID, persisted font size, initial position ───────────
  useEffect(() => {
    getOrCreateDeviceId().then(setDeviceId);
    AsyncStorage.getItem(FONT_SIZE_KEY).then((v) => {
      if (v) setFontSize(parseInt(v, 10));
    });
    AsyncStorage.getItem(FONT_FAMILY_KEY).then((v) => {
      if (v === 'serif' || v === 'sans' || v === 'palatino' || v === 'mono') {
        setFontFamily(v);
      }
    });
    AsyncStorage.getItem(MARGIN_KEY).then((v) => {
      if (v === 'narrow' || v === 'normal' || v === 'wide') setMargin(v);
    });
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'sepia' || v === 'eink') setTheme(v);
    });

    // Safety net: if the WebView bridge never fires BRIDGE_LOADED, surface an error
    const timeout = setTimeout(() => {
      if (!readyRef.current) {
        setErrorMsg('Reader failed to initialize. Please go back and try again.');
        setLoading(false);
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, []);

  // Check whether this book has an audio file downloaded so we can offer a
  // "Start Audio" button inside the reader (without bouncing to BookDetail).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const books = await localListBooks(user.uid);
        const meta = books.find((b) => b.id === params.bookId);
        if (!cancelled && meta?.title) setBookTitle(meta.title);
        if (!meta?.audioPath) return;
        let resolved: string | null = null;
        try {
          const f = new File(meta.audioPath);
          if (f.exists && (f.size ?? 0) > 0) resolved = meta.audioPath;
        } catch { /* fall through to reconstruction */ }
        if (!resolved) {
          const ext = meta.audioPath.split('.').pop() ?? 'm4b';
          resolved = await getCachedPath(params.bookId, 'audio', ext);
        }
        if (!cancelled && resolved) setBookHasAudio(true);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [user, params.bookId]);

  // ── After bridge ready: load the epub and check for audio sync position ────
  useEffect(() => {
    if (!ready || !user) return;

    (async () => {
      try {
        logger.info('ReaderScreen: bridge ready, loading epub', { bookId: params.bookId });
        // Prefer the saved path from book metadata over reconstructing
        // `{bookId}_epub.epub`. The reconstruction was a footgun when the
        // bookId drifted between import and save (fixed, but older books
        // may still have mismatched paths, and the saved path is always
        // the authoritative answer).
        const booksForEpub = await localListBooks(user.uid);
        const metaForEpub = booksForEpub.find((b) => b.id === params.bookId);
        let epubUri: string | null = null;
        if (metaForEpub?.epubPath) {
          try {
            const f = new File(metaForEpub.epubPath);
            if (f.exists && (f.size ?? 0) > 0) epubUri = metaForEpub.epubPath;
          } catch { /* fall through */ }
        }
        if (!epubUri) {
          epubUri = await getCachedPath(params.bookId, 'epub', 'epub');
        }
        if (!epubUri) {
          // Diagnostic: list the cache dir and the book's metadata so we can
          // see what's actually there vs. what the reader expected.
          let cacheListing: string[] = [];
          try {
            const dir = new Directory(Paths.document, CACHE_DIR);
            cacheListing = dir.exists
              ? dir.list().map((f) => f.uri.split('/').pop() ?? f.uri)
              : ['<cache dir missing>'];
          } catch (err) {
            cacheListing = [`<list failed: ${String(err)}>`];
          }
          let bookMeta: unknown = null;
          try {
            const books = await localListBooks(user.uid);
            bookMeta = books.find((b) => b.id === params.bookId) ?? null;
          } catch (err) {
            bookMeta = `<read failed: ${String(err)}>`;
          }
          logger.warn('ReaderScreen: epub not cached', {
            bookId: params.bookId,
            expectedFile: `${params.bookId}_epub.epub`,
            cacheListing,
            bookMeta,
          });
          // NOTE: self-heal (localDeleteBook + deleteBook) is disabled while
          // diagnosing — deleting the book destroys the evidence we need to
          // see why the epub path doesn't match the bookId.
          setErrorMsg(
            `Missing EPUB for bookId=${params.bookId}. Cache dir: ${cacheListing.join(', ') || '<empty>'}`,
          );
          setLoading(false);
          return;
        }

        // Sanity-check size before handing off to the WebView. A valid EPUB
        // is a small ZIP (typically < 50 MB); anything above ~200 MB is almost
        // certainly a mispaired audio file and will OOM the WebView.
        const MAX_EPUB_BYTES = 200 * 1024 * 1024;
        try {
          const size = new File(epubUri).size ?? 0;
          if (size > MAX_EPUB_BYTES) {
            logger.error('ReaderScreen: epub file too large, likely mispaired', {
              bookId: params.bookId,
              size,
            });
            setErrorMsg(
              `This book's ebook file is ${Math.round(size / (1024 * 1024))} MB — too large to be a valid .epub. It may have been paired with the wrong file. Remove it and re-add with the correct .epub.`,
            );
            setLoading(false);
            return;
          }
        } catch (err) {
          logger.warn('ReaderScreen: could not stat epub file', err);
        }

        logger.info('ReaderScreen: handing epub uri to WebView', { uri: epubUri });
        webViewRef.current?.loadBookFromUri(epubUri);

        webViewRef.current?.setFontSize(fontSize);
        webViewRef.current?.setTheme(theme);
        webViewRef.current?.setFontFamily(FONT_FAMILY_VALUES[fontFamily]);
        webViewRef.current?.setMargin(MARGIN_VALUES[margin]);

        const saved = await loadLocalPosition();

        // Resolve the audio timestamp to navigate to: prefer live position
        // (audio is currently loaded and playing/paused in this session),
        // then fall back to the persisted position from the last audio session.
        let audioTimestampForHandoff = audioPosition;
        if (params.resumeFromAudio && audioTimestampForHandoff === 0) {
          try {
            const audioKey = `${POSITIONS_CACHE_KEY}:${params.bookId}:audio`;
            const raw = await AsyncStorage.getItem(audioKey);
            if (raw) {
              const parsed = JSON.parse(raw) as { timestampSeconds: number };
              audioTimestampForHandoff = parsed.timestampSeconds ?? 0;
            }
          } catch { /* use 0 */ }
        }

        if (params.resumeFromAudio && audioTimestampForHandoff > 0 && audioChapters.length > 0) {
          // Navigate the reader to wherever audio currently is, using the
          // handoff resolver (chapter-accurate; sentence-accurate once L1
          // anchors exist for the current chapter).
          const alignment = await getOrBuildLayer0(
            params.bookId,
            audioChapters,
            chapters.length > 0 ? chapters.length : audioChapters.length,
          );
          // Derive chapter index from chapters when immersion isn't active
          const audioChapterIdx = currentAudioChapter?.index
            ?? audioChapters.reduce(
                (best, ch) => (ch.startSeconds <= audioTimestampForHandoff ? ch : best),
                audioChapters[0],
              ).index;
          const target = audioToReader(
            {
              chapterIndex: audioChapterIdx,
              timestampSeconds: audioTimestampForHandoff,
              percentComplete: 0,
            },
            alignment,
          );
          setTimeout(() => {
            if (target.cfi) webViewRef.current?.goTo(target.cfi);
            // No real CFI from the handoff (L0 fallback / no alignment) —
            // navigate by chapter. seekToPercent would require locations to
            // already be generated, which isn't true on a cold load.
            else webViewRef.current?.goToChapter(target.chapterIndex);
          }, 1000);
        } else if (saved) {
          setTimeout(() => webViewRef.current?.goTo(saved.cfi), 800);
        }

        const syncState = await readSyncState(user.uid, params.bookId);
        if (syncState?.source === 'audio' && syncState.audioTimestamp > 0) {
          setSyncBannerData(syncState);
        }
      } catch (err) {
        logger.error('ReaderScreen: failed to load epub', err);
        setErrorMsg('Failed to load book. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, user, params.bookId, params.resumeFromAudio]);

  // ── Auto-save position on reader close (beforeRemove) ────────────────────
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      // Fire-and-forget: save position so audio can resume from here.
      (async () => {
        try {
          const pos = await webViewRef.current?.getCurrentPosition();
          if (!pos || pos.percentComplete === 0) return;
          const key = `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`;
          await AsyncStorage.setItem(key, JSON.stringify({ ...pos, savedAt: Date.now() }));
        } catch { /* silent — LOCATIONS_READY write is the safety net */ }
      })();
    });
    return unsub;
  }, [navigation, params.bookId]);

  // ── Auto-save position on app background ─────────────────────────────────
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState !== 'background' && nextState !== 'inactive') return;
      (async () => {
        try {
          const pos = await webViewRef.current?.getCurrentPosition();
          if (!pos || pos.percentComplete === 0) return;
          const key = `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`;
          await AsyncStorage.setItem(key, JSON.stringify({ ...pos, savedAt: Date.now() }));
        } catch { /* silent */ }
      })();
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [params.bookId]);

  // ── Android back: save position before leaving ─────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack();
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  // ── Hide the parent tab bar while reader is focused ───────────────────────
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

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handlePositionChange = useCallback(
    (position: EpubPosition, programmatic: boolean) => {
      setCurrentChapterIndex(position.chapterIndex);

      // When user manually navigates to a different chapter (not via immersion
      // sync) and audio is loaded, seek audio to match the new reader
      // position via the handoff resolver. Previously we clobbered the
      // resolver's answer with `audioStartSeconds`, which threw away L1
      // anchor accuracy. Now we trust the resolver: L0 still returns the
      // chapter start (correct), L0.5/L1 return a sub-chapter timestamp
      // (also correct).
      if (!programmatic && hasAudio && audioChapters.length > 0) {
        const epubChIdx = position.chapterIndex;
        if (epubChIdx !== lastEpubChapterRef.current) {
          lastEpubChapterRef.current = epubChIdx;
          getOrBuildLayer0(
            params.bookId,
            audioChapters,
            chapters.length > 0 ? chapters.length : audioChapters.length,
          )
            .then((alignment) => {
              const target = readerToAudio(
                {
                  chapterIndex: epubChIdx,
                  cfi: position.cfi,
                  charOffset: 0,
                  chapterFraction: -1,
                  percentComplete: position.percentComplete,
                },
                alignment,
              );
              return seekToTimestamp(Math.max(0, target.timestampSeconds));
            })
            .catch(() => {});
        }
      }

      onPositionChange(position, async (pos) => {
        if (!user || !deviceId) return;
        try {
          const syncedPos = {
            bookId: params.bookId,
            deviceId,
            chapterIndex: pos.chapterIndex,
            epubCfi: pos.cfi,
            charOffset: pos.charOffset,
            audioTimestamp: 0,
            percentComplete: pos.percentComplete,
            source: 'epub' as const,
            updatedAt: Date.now(),
          };
          await pushPosition(user.uid, params.bookId, deviceId, syncedPos);
        } catch (err) {
          logger.warn('Failed to push epub position', err);
        }
      });
    },
    [user, deviceId, params.bookId, onPositionChange, hasAudio, audioChapters, chapters.length],
  );

  const handleFontSizeChange = useCallback((px: number) => {
    setFontSize(px);
    webViewRef.current?.setFontSize(px);
    AsyncStorage.setItem(FONT_SIZE_KEY, String(px));
  }, []);

  const handleThemeChange = useCallback((t: EpubTheme) => {
    setTheme(t);
    webViewRef.current?.setTheme(t);
    AsyncStorage.setItem(THEME_KEY, t);
  }, []);

  const handleFontFamilyChange = useCallback((f: ReaderFontFamily) => {
    setFontFamily(f);
    webViewRef.current?.setFontFamily(FONT_FAMILY_VALUES[f]);
    AsyncStorage.setItem(FONT_FAMILY_KEY, f);
  }, []);

  const handleMarginChange = useCallback((m: ReaderMargin) => {
    setMargin(m);
    webViewRef.current?.setMargin(MARGIN_VALUES[m]);
    AsyncStorage.setItem(MARGIN_KEY, m);
  }, []);

  const handleChapterSelect = useCallback((index: number) => {
    webViewRef.current?.goToChapter(index);
    setCurrentChapterIndex(index);
  }, []);

  const handleParagraphTap = useCallback((percentComplete: number, chapterIndex: number) => {
    if (!hasAudio || audioChapters.length === 0) return;
    // Ignore pct<=0 — that means locations weren't ready, and seeking to 0
    // is almost certainly not what the user wants.
    if (percentComplete <= 0) return;
    getOrBuildLayer0(
      params.bookId,
      audioChapters,
      chapters.length > 0 ? chapters.length : audioChapters.length,
    )
      .then((alignment) => {
        const target = readerToAudio(
          { chapterIndex, cfi: '', charOffset: 0, chapterFraction: -1, percentComplete },
          alignment,
        );
        return seekToTimestamp(Math.max(0, target.timestampSeconds));
      })
      .catch(() => {});
    setTapSeekToast(true);
    setTimeout(() => setTapSeekToast(false), 1800);
  }, [hasAudio, audioChapters, chapters.length, params.bookId]);

  const handleSyncResume = useCallback(() => {
    if (!syncBannerData) return;
    setSyncBannerData(null);
    if (syncBannerData.epubCfi) {
      webViewRef.current?.goTo(syncBannerData.epubCfi);
    } else {
      webViewRef.current?.goToChapter(syncBannerData.chapterIndex);
    }
  }, [syncBannerData]);

  // Start audio for this book. Reads the saved epub position from AsyncStorage
  // directly — no livePosition dependency, no locationsReady gate.
  const handleStartAudio = useCallback(async () => {
    if (!user || startingAudio) return;
    setStartingAudio(true);
    try {
      // Read the last saved epub position (written by LOCATIONS_READY, beforeRemove,
      // AppState background listener, or Pin position). Falls back to 0 if absent.
      let epubPos: EpubPosition | undefined;
      try {
        const key = `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`;
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as EpubPosition;
          if (parsed.percentComplete > 0 || parsed.cfi) epubPos = parsed;
        }
      } catch { /* fall back to start */ }

      const prepared = await prepareBookForPlayback(user.uid, params.bookId, epubPos);
      if (!prepared) return;
      await startPlayback(prepared.localBook, prepared.chapters, prepared.startTimestamp);
    } catch (err) {
      logger.warn('ReaderScreen: start audio failed', err);
    } finally {
      setStartingAudio(false);
    }
  }, [user, params.bookId, startPlayback, startingAudio]);

  // Pin the current reader position so audio knows exactly where to resume from.
  const handlePinPosition = useCallback(async () => {
    try {
      const pos = await webViewRef.current?.getCurrentPosition();
      if (!pos || pos.percentComplete === 0) return;
      const key = `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`;
      await AsyncStorage.setItem(key, JSON.stringify({ ...pos, savedAt: Date.now() }));
      setPinSaved(true);
      setTimeout(() => setPinSaved(false), 2000);
    } catch (err) {
      logger.warn('ReaderScreen: pin position failed', err);
    }
  }, [params.bookId]);

  // ── Render ────────────────────────────────────────────────────────────────
  const bgColor = theme === 'dark' ? '#121212' : theme === 'sepia' ? '#f5efe0' : '#ffffff';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar hidden />

      {/* Epub WebView */}
      <EpubWebView
        ref={webViewRef}
        onReady={() => { readyRef.current = true; setReady(true); }}
        onPositionChange={handlePositionChange}
        onLocationsReady={() => setLocationsReady(true)}
        onChapterList={(list) => {
          setChapters(list);
          // The reader is the only place we know the real epub spine count.
          // Refresh L0 now so handoff math uses the accurate chapter count.
          if (audioChapters.length > 0) {
            ensureLayer0Fresh(params.bookId, audioChapters, list.length).catch(() => {});
          }
          // Kick off opportunistic chapter-text caching for the on-device
          // aligner. Runs sequentially in the background — we don't want to
          // queue 40+ WebView calls at once and starve the user's reading.
          cacheChaptersInBackground(params.bookId, list.length, webViewRef);
        }}
        onWordLookup={setLookupWordValue}
        onParagraphTap={handleParagraphTap}
        onError={setErrorMsg}
      />

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <AnimatedLoader
            variant="random"
            color={theme === 'dark' ? '#C9A96E' : '#1A2438'}
            accent={theme === 'dark' ? '#F0E6D4' : '#E8DFC8'}
            size={72}
            message="Turning to your page"
          />
        </View>
      )}

      {/* Error state */}
      {errorMsg && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sync banner */}
      {syncBannerData && !loading && (
        <View style={{ marginTop: insets.top }}>
          <SyncBanner
            audioTimestamp={syncBannerData.audioTimestamp}
            onResume={handleSyncResume}
            onDismiss={() => setSyncBannerData(null)}
          />
        </View>
      )}

      {/* Top tap strip — Kindle-style. Tap opens the drawer. Starts below
          the status bar to avoid conflicting with iOS Control Center /
          Android notification shade pulls. */}
      <TouchableOpacity
        style={[styles.topTapStrip, { top: insets.top }]}
        onPress={() => setControlsVisible(true)}
        activeOpacity={1}
        accessibilityLabel="Open reader options"
      />

      {/* Top drawer with all controls (Audio / Display / Chapters) */}
      <TopDrawerModal
        visible={controlsVisible}
        onDismiss={() => setControlsVisible(false)}
      >
        <ReaderDrawer
          chapters={chapters}
          currentChapterIndex={currentChapterIndex}
          fontSize={fontSize}
          theme={theme}
          fontFamily={fontFamily}
          margin={margin}
          onFontSizeChange={handleFontSizeChange}
          onThemeChange={handleThemeChange}
          onFontFamilyChange={handleFontFamilyChange}
          onMarginChange={handleMarginChange}
          onChapterSelect={(idx) => { handleChapterSelect(idx); setControlsVisible(false); }}
          onClose={() => setControlsVisible(false)}
          bookTitle={bookTitle}
          onHome={() => { setControlsVisible(false); navigation.goBack(); }}
          hasAudio={hasAudio}
          bookHasAudio={bookHasAudio}
          isPlaying={isAudioPlaying}
          position={audioPosition}
          duration={audioDuration}
          currentChapter={currentAudioChapter}
          audioChapters={audioChapters}
          playbackRate={playbackRate}
          onRateChange={setPlaybackRate}
          startingAudio={startingAudio}
          locationsReady={locationsReady}
          onStartAudio={handleStartAudio}
          onPinPosition={handlePinPosition}
        />
      </TopDrawerModal>

      {/* Tap-to-seek toast */}
      {tapSeekToast && (
        <View style={styles.tapSeekToast} pointerEvents="none">
          <Text style={styles.tapSeekToastText}>▶ Audio jumping here</Text>
        </View>
      )}

      {/* Pin position toast */}
      {pinSaved && (
        <View style={[styles.tapSeekToast, styles.pinSavedToast]} pointerEvents="none">
          <Text style={styles.tapSeekToastText}>📍 Position saved</Text>
        </View>
      )}

      {/* Word lookup modal */}
      <WordLookupModal word={lookupWordValue} onClose={() => setLookupWordValue(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },

  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  errorText: { fontSize: 15, color: '#C62828', textAlign: 'center', marginBottom: 24 },
  backBtn: {
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },

  topTapStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 72,
    zIndex: 20,
  },

  tapSeekToast: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(26,26,46,0.92)',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    zIndex: 50,
  },
  tapSeekToastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  pinSavedToast: {
    bottom: 120,
  },
});
