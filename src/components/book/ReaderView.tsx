import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  StatusBar,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { AnimatedLoader } from '@/components/common/AnimatedLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EpubWebView, { EpubWebViewRef, EpubChapter, EpubTheme } from '@/components/reader/EpubWebView';
import EpubSearchDrawer, { EpubSearchDrawerHandle } from '@/components/reader/EpubSearchDrawer';
import ReaderDrawer, {
  ReaderFontFamily,
  ReaderLineHeight,
  ReaderMargin,
  ReaderProgressDisplay,
  FONT_FAMILY_VALUES,
  MARGIN_VALUES,
} from '@/components/reader/ReaderDrawer';
import TopDrawerModal from '@/components/reader/TopDrawerModal';
import WordLookupModal from '@/components/reader/WordLookupModal';
import HighlightMenu from '@/components/reader/HighlightMenu';
import { Highlight } from '@/types/highlight';
import { loadHighlights, saveHighlight, deleteHighlight } from '@/services/book/highlightStore';
import { useProgress } from 'react-native-track-player';
import { useAuth } from '@/hooks/useAuth';
import { useEpubPosition } from '@/hooks/useEpubPosition';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { localListBooks, localWriteBook } from '@/services/book/localBookStore';
import { writeBook } from '@/services/firebase/firestoreService';
import { getCachedPath } from '@/services/storage/localStorageService';
import { File, Directory, Paths } from 'expo-file-system';
import { CACHE_DIR, POSITIONS_CACHE_KEY } from '@/constants/config';
import { VoidColors, VoidRadius } from '@/constants/voidTheme';
import { EpubPosition } from '@/types/position';
import {
  savePosition,
  registerRestoreCheck,
  type EpubLastPosition,
} from '@/services/storage/positionStore';
import { seekToTimestamp } from '@/services/audio/trackPlayerService';
import { getOrBuildLayer0, ensureLayer0Fresh } from '@/services/sync/alignmentStore';
import { readerToAudio, audioToReader } from '@/services/sync/handoff';
import {
  hasCachedChapterText,
  writeCachedChapterText,
} from '@/services/sync/chapterTextCache';
import { getAlignerQueue } from '@/services/sync/onDeviceAligner';
import { logger } from '@/utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@whisper/device_id';
const FONT_SIZE_KEY = '@whisper/font_size';
const LINE_HEIGHT_KEY = '@whisper/line_height';
const FONT_FAMILY_KEY = '@whisper/font_family';
const MARGIN_KEY = '@whisper/margin';
const THEME_KEY = '@whisper/theme';
const PROGRESS_DISPLAY_KEY = '@whisper/progress_display';

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now()}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function persistEpubChapterCount(
  userId: string | undefined,
  bookId: string,
  count: number,
): Promise<void> {
  if (!userId || count <= 0) return;
  try {
    const books = await localListBooks(userId);
    const found = books.find((b) => b.id === bookId);
    if (!found || found.epubChapterCount === count) return;
    const { id: _id, ...rest } = found;
    void _id;
    const updated = { ...rest, epubChapterCount: count, updatedAt: Date.now() };
    await localWriteBook(userId, bookId, updated);
    writeBook(userId, bookId, updated).catch((err) =>
      logger.warn('persistEpubChapterCount: writeBook failed', err),
    );
  } catch (err) {
    logger.warn('persistEpubChapterCount failed', err);
  }
}

const cascadesInFlight = new Set<string>();

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
          await writeCachedChapterText(bookId, i, text ?? '');
          getAlignerQueue()?.enqueueAllPending(bookId).catch(() => {});
        } catch (err) {
          logger.warn('cacheChaptersInBackground: chapter failed', {
            bookId,
            chapterIndex: i,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      cascadesInFlight.delete(bookId);
    }
  })();
}

export interface ReaderViewProps {
  bookId: string;
  resumeFromAudio?: boolean;
  onClose: () => void;
}

export interface ReaderViewRef {
  getCurrentPosition: () => Promise<EpubPosition | null>;
  getLastKnownPosition: () => EpubPosition | null;
  getVisibleSnippet: (n?: number, timeoutMs?: number) => Promise<string[] | null>;
  syncToAudio: (timestampSeconds: number, audioChapterIdx: number) => Promise<void>;
  openMenu: () => void;
  openSearch: () => void;
}

const ReaderView = forwardRef<ReaderViewRef, ReaderViewProps>(function ReaderView(
  { bookId, resumeFromAudio, onClose },
  ref,
) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<EpubWebViewRef>(null);

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState<ReaderLineHeight>(1.6);
  const [theme, setTheme] = useState<EpubTheme>('light');
  const [fontFamily, setFontFamily] = useState<ReaderFontFamily>('serif');
  const [margin, setMargin] = useState<ReaderMargin>('normal');
  const [lookupWordValue, setLookupWordValue] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [tapSeekToast, setTapSeekToast] = useState(false);
  const [bookTitle, setBookTitle] = useState<string | undefined>(undefined);
  const [locationsReady, setLocationsReady] = useState(false);
  const [totalLocations, setTotalLocations] = useState(0);
  const [progressDisplay, setProgressDisplay] = useState<ReaderProgressDisplay>('page');
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [pendingSelection, setPendingSelection] = useState<{ cfiRange: string; text: string; chapterIndex: number } | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const searchDrawerRef = useRef<EpubSearchDrawerHandle>(null);

  const { chapters: audioChapters, book: nowPlayingBook } = useNowPlaying();
  const audioLoadedForThisBook = nowPlayingBook?.id === bookId && audioChapters.length > 0;
  const hasAudio = audioLoadedForThisBook;

  const { position: audioPosition } = useProgress(1000);
  const currentAudioChapter = audioChapters.length > 0
    ? audioChapters.reduce((best, ch) => (ch.startSeconds <= audioPosition ? ch : best), audioChapters[0])
    : null;

  const readyRef = useRef(false);
  const lastEpubChapterRef = useRef(-1);
  const livePositionRef = useRef<EpubPosition | null>(null);
  const [pendingCfi, setPendingCfi] = useState<string | null>(null);
  const { position: livePosition, setFromBridge, loadLocalPosition } = useEpubPosition(bookId);

  useImperativeHandle(ref, () => ({
    getCurrentPosition: async () => {
      try {
        return (await webViewRef.current?.getCurrentPosition()) ?? null;
      } catch {
        return null;
      }
    },
    getLastKnownPosition: () => livePositionRef.current ?? pendingRestorePositionRef.current,
    getVisibleSnippet: async (n = 8, timeoutMs = 2000) => {
      try {
        return (await webViewRef.current?.getVisibleSnippet(n, timeoutMs)) ?? null;
      } catch {
        return null;
      }
    },
    openMenu: () => setControlsVisible(true),
    openSearch: () => setSearchVisible(true),
    syncToAudio: async (timestampSeconds: number, audioChapterIdx: number) => {
      if (audioChapters.length === 0) return;
      try {
        const alignment = await getOrBuildLayer0(
          bookId,
          audioChapters,
          chapters.length > 0 ? chapters.length : audioChapters.length,
        );
        const target = audioToReader(
          {
            chapterIndex: audioChapterIdx,
            timestampSeconds,
            percentComplete: 0,
          },
          alignment,
        );
        if (target.cfi) {
          // Mode-handoff overrides any pending saved-CFI restore. Clearing
          // pendingRestorePositionRef here ensures the goTo's POSITION_CHANGE
          // is NOT treated as a restore-echo and correctly updates livePositionRef.
          pendingRestorePositionRef.current = null;
          pendingCfiRef.current = null;
          setPendingCfi(null);
          webViewRef.current?.goTo(target.cfi);
        } else if (target.chapterIndex > currentChapterIndex) {
          // L0 only: only advance forward.
          pendingRestorePositionRef.current = null;
          pendingCfiRef.current = null;
          setPendingCfi(null);
          webViewRef.current?.goToChapter(target.chapterIndex);
        }
      } catch (err) {
        logger.warn('ReaderView: syncToAudio failed', err);
      }
    },
  }), [bookId, audioChapters, chapters.length, currentChapterIndex]);

  useEffect(() => {
    getOrCreateDeviceId().then(setDeviceId);
    AsyncStorage.getItem(FONT_SIZE_KEY).then((v) => {
      if (v) setFontSize(parseInt(v, 10));
    });
    AsyncStorage.getItem(LINE_HEIGHT_KEY).then((v) => {
      const n = v ? parseFloat(v) : NaN;
      if (n === 1.2 || n === 1.4 || n === 1.6 || n === 1.8 || n === 2.0) setLineHeight(n);
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
    AsyncStorage.getItem(PROGRESS_DISPLAY_KEY).then((v) => {
      if (v === 'page' || v === 'percent') setProgressDisplay(v);
    });

    const timeout = setTimeout(() => {
      if (!readyRef.current) {
        setErrorMsg('Reader failed to initialize. Please go back and try again.');
        setLoading(false);
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const books = await localListBooks(user.uid);
        const meta = books.find((b) => b.id === bookId);
        if (!cancelled && meta?.title) setBookTitle(meta.title);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [user, bookId]);

  useEffect(() => {
    if (!ready || !user) return;

    (async () => {
      try {
        logger.info('ReaderView: bridge ready, loading epub', { bookId });
        const booksForEpub = await localListBooks(user.uid);
        const metaForEpub = booksForEpub.find((b) => b.id === bookId);
        let epubUri: string | null = null;
        if (metaForEpub?.epubPath) {
          try {
            const f = new File(metaForEpub.epubPath);
            if (f.exists && (f.size ?? 0) > 0) epubUri = metaForEpub.epubPath;
          } catch { /* fall through */ }
        }
        if (!epubUri) {
          epubUri = await getCachedPath(bookId, 'epub', 'epub');
        }
        if (!epubUri) {
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
            bookMeta = books.find((b) => b.id === bookId) ?? null;
          } catch (err) {
            bookMeta = `<read failed: ${String(err)}>`;
          }
          logger.warn('ReaderView: epub not cached', {
            bookId,
            expectedFile: `${bookId}_epub.epub`,
            cacheListing,
            bookMeta,
          });
          setErrorMsg(
            `Missing EPUB for bookId=${bookId}. Cache dir: ${cacheListing.join(', ') || '<empty>'}`,
          );
          setLoading(false);
          return;
        }

        const MAX_EPUB_BYTES = 200 * 1024 * 1024;
        try {
          const size = new File(epubUri).size ?? 0;
          if (size > MAX_EPUB_BYTES) {
            logger.error('ReaderView: epub file too large, likely mispaired', {
              bookId,
              size,
            });
            setErrorMsg(
              `This book's ebook file is ${Math.round(size / (1024 * 1024))} MB — too large to be a valid .epub. It may have been paired with the wrong file. Remove it and re-add with the correct .epub.`,
            );
            setLoading(false);
            return;
          }
        } catch (err) {
          logger.warn('ReaderView: could not stat epub file', err);
        }

        logger.info('ReaderView: handing epub uri to WebView', { uri: epubUri });
        webViewRef.current?.loadBookFromUri(epubUri);

        webViewRef.current?.setFontSize(fontSize);
        webViewRef.current?.setLineHeight(lineHeight);
        webViewRef.current?.setTheme(theme);
        webViewRef.current?.setFontFamily(FONT_FAMILY_VALUES[fontFamily]);
        webViewRef.current?.setMargin(MARGIN_VALUES[margin]);

        const saved = await loadLocalPosition();
        logger.info('ReaderView: loaded saved position', {
          hasCfi: !!saved?.cfi,
          cfi: saved?.cfi ?? '(null)',
          chapterIndex: saved?.chapterIndex ?? -1,
        });

        let audioTimestampForHandoff = audioPosition;
        if (resumeFromAudio && audioTimestampForHandoff === 0) {
          try {
            const audioKey = `${POSITIONS_CACHE_KEY}:${bookId}:audio`;
            const raw = await AsyncStorage.getItem(audioKey);
            if (raw) {
              const parsed = JSON.parse(raw) as { timestampSeconds: number };
              audioTimestampForHandoff = parsed.timestampSeconds ?? 0;
            }
          } catch { /* use 0 */ }
        }

        if (resumeFromAudio && audioTimestampForHandoff > 0 && audioChapters.length > 0) {
          setPendingCfi(null);
          const alignment = await getOrBuildLayer0(
            bookId,
            audioChapters,
            chapters.length > 0 ? chapters.length : audioChapters.length,
          );
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
            else webViewRef.current?.goToChapter(target.chapterIndex);
          }, 1000);
        } else if (saved?.cfi) {
          logger.info('ReaderView: setting pendingCfi for restore', { cfi: saved.cfi });
          pendingRestorePositionRef.current = { ...saved, chapterFraction: -1 };
          pendingCfiRef.current = saved.cfi;
          savedChapterIndexRef.current = saved.chapterIndex;
          setPendingCfi(saved.cfi);
        } else {
          logger.info('ReaderView: no saved CFI — opening at chapter 0');
        }
      } catch (err) {
        logger.error('ReaderView: failed to load epub', err);
        setErrorMsg('Failed to load book. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, user, bookId, resumeFromAudio]);

  const pendingCfiRef = useRef<string | null>(null);
  useEffect(() => { pendingCfiRef.current = pendingCfi; }, [pendingCfi]);

  // Full saved position held during the pre-restore window so getLastKnownPosition()
  // can return it to beforeRemove even when livePositionRef is still null (i.e., the
  // user closed before locationsReady fired or before goTo's POSITION_CHANGE arrived).
  const pendingRestorePositionRef = useRef<EpubPosition | null>(null);

  // Tracks locationsReady synchronously so handlePositionChange can gate
  // all events before the book's location index is built — covers both the
  // saved-CFI restore path (pendingCfi) and the resumeFromAudio path (no
  // pendingCfi, but the LOCATIONS_READY synthetic chapter-0 position must
  // not overwrite the saved CFI in AsyncStorage via livePositionRef).
  const locationsReadyRef = useRef(false);
  useEffect(() => { locationsReadyRef.current = locationsReady; }, [locationsReady]);

  // Phase 03 — saved chapter we're restoring to. Used by R7's confirmed-clear
  // rule in handlePositionChange (clear pendingCfi only when chapterIndex
  // reaches the saved chapter).
  const savedChapterIndexRef = useRef<number | null>(null);
  // Phase 03 — last chapterIndex we persisted. When the live chapter differs,
  // the chapter-change trigger fires (D-G2).
  const lastSavedChapterIndexRef = useRef<number | null>(null);
  // Phase 03 — 30s in-foreground debounce timer (D-G2).
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 03 / WR-02 — reset per-book refs when the bookId changes so that
  // crossing books doesn't carry stale chapter indices into the new session.
  useEffect(() => {
    savedChapterIndexRef.current = null;
    lastSavedChapterIndexRef.current = null;
  }, [bookId]);

  // Build an EpubLastPosition from the freshest live position. Returns null
  // if we have nothing safe to save.
  const buildPayload = useCallback((): EpubLastPosition | null => {
    const live = livePositionRef.current;
    if (!live?.cfi) return null;
    return {
      cfi: live.cfi,
      chapterIndex: live.chapterIndex,
      charOffset: live.charOffset,
      percentComplete: live.percentComplete,
      updatedAt: Date.now(),
    };
  }, []);

  const persistNow = useCallback((trigger: string) => {
    const payload = buildPayload();
    logger.debug('persistNow called', {
      trigger,
      payloadExists: !!payload,
      payloadChapter: payload?.chapterIndex,
      pendingCfiRef: pendingCfiRef.current?.substring(0, 20),
    });
    if (!payload) {
      logger.warn('persistNow: no payload to save', { trigger });
      return;
    }
    logger.info('persistNow: calling savePosition', {
      trigger,
      chapter: payload.chapterIndex,
      cfi: payload.cfi.substring(0, 30),
    });
    savePosition(bookId, payload, {
      userId: user?.uid ?? null,
      deviceId: deviceId ?? null,
      trigger,
    });
  }, [bookId, user?.uid, deviceId, buildPayload]);

  const scheduleDebouncedSave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistNow('debounce-30s');
    }, 30_000);
  }, [persistNow]);

  // Register the restore-in-progress check so positionStore knows when to
  // no-op saves (D-G3).
  useEffect(() => {
    registerRestoreCheck(bookId, () => pendingCfiRef.current !== null);
    return () => registerRestoreCheck(bookId, null);
  }, [bookId]);

  // Trigger 1: AppState → 'background' | 'inactive' (R2).
  useEffect(() => {
    const onAppState = (s: AppStateStatus) => {
      if (s === 'background' || s === 'inactive') {
        persistNow('appstate-background');
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [persistNow]);

  // Cleanup the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const handlePositionChange = useCallback(
    (position: EpubPosition, programmatic: boolean) => {
      // Gate ALL events until locations.generate() completes. This covers:
      //   (a) saved-CFI restore: initial chapter-0 render must not clobber
      //       the saved CFI before locationsReady fires goTo(pendingCfi).
      //   (b) resumeFromAudio path: LOCATIONS_READY synthetic chapter-0
      //       position must not write to livePositionRef (and then to
      //       AsyncStorage via beforeRemove) before the audio-derived goTo
      //       fires. Without this gate, session 3+ silently overwrites the
      //       saved CFI with chapter 0 whenever the user closes quickly.
      if (!locationsReadyRef.current) {
        logger.debug('ReaderView: POSITION_CHANGE gated (locationsReady not yet)', {
          incoming: position.cfi,
          programmatic,
        });
        return;
      }
      // After locationsReady, the pendingCfiRef gate has two roles:
      //   1. Drop transient initial-render / LOCATIONS_READY events that
      //      arrive at a chapter < savedChapterIndex (pre-restore noise).
      //   2. Recognize the restore-goTo's own response (chapter ≥ saved)
      //      and clear pendingCfi — the R7 confirmed-clear (closes CR-02
      //      from Phase 01's review). This MUST live inside the gate so
      //      the gate's exit condition is the same event that confirms
      //      the restore.
      if (pendingCfiRef.current) {
        logger.debug('ReaderView: pendingCfiRef gate check', {
          pendingCfiRef: pendingCfiRef.current?.substring(0, 30),
          savedChapterIndexRef: savedChapterIndexRef.current,
          incomingChapterIndex: position.chapterIndex,
        });
        if (
          savedChapterIndexRef.current !== null &&
          position.chapterIndex >= savedChapterIndexRef.current
        ) {
          logger.info('ReaderView: pendingCfi cleared (chapter confirmed)', {
            chapterIndex: position.chapterIndex,
            savedChapter: savedChapterIndexRef.current,
          });
          pendingCfiRef.current = null;
          savedChapterIndexRef.current = null;
          setPendingCfi(null);
          // Fall through — this event is the restore landing and should
          // update livePositionRef / mirror state below.
        } else {
          logger.warn('ReaderView: POSITION_CHANGE gated (pendingCfi active)', {
            incoming: position.cfi,
            pendingCfi: pendingCfiRef.current?.substring(0, 30),
            programmatic,
            incomingChapter: position.chapterIndex,
            savedChapter: savedChapterIndexRef.current,
          });
          return;
        }
      }
      // If pendingRestorePositionRef is still set when a programmatic event
      // arrives, this is the restore-goTo's own POSITION_CHANGE response —
      // don't let it overwrite livePositionRef. Without this guard, a user
      // who navigates to a new chapter faster than the WebView bridge roundtrip
      // would see their chapter overwritten by the restore goTo's late response.
      if (programmatic && pendingRestorePositionRef.current !== null) {
        logger.debug('ReaderView: POSITION_CHANGE accepted (restore-goTo echo, livePositionRef held)', {
          cfi: position.cfi,
        });
        setCurrentChapterIndex(position.chapterIndex);
        setFromBridge(position);
        pendingRestorePositionRef.current = null;
        pendingCfiRef.current = null;
        setPendingCfi(null);
        savedChapterIndexRef.current = null;
        return;
      }

      logger.info('ReaderView: POSITION_CHANGE accepted - updating livePositionRef', {
        cfi: position.cfi.substring(0, 30),
        chapterIndex: position.chapterIndex,
        programmatic,
        pendingCfiRef: pendingCfiRef.current?.substring(0, 20),
        pendingRestorePositionRef: pendingRestorePositionRef.current?.chapterIndex,
      });

      logger.debug('ReaderView: setting livePositionRef', {
        chapter: position.chapterIndex,
        cfi: position.cfi.substring(0, 30),
      });
      livePositionRef.current = position;
      pendingRestorePositionRef.current = null;
      setCurrentChapterIndex(position.chapterIndex);

      if (!programmatic && hasAudio && audioChapters.length > 0) {
        const epubChIdx = position.chapterIndex;
        if (epubChIdx !== lastEpubChapterRef.current) {
          lastEpubChapterRef.current = epubChIdx;
          getOrBuildLayer0(
            bookId,
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

      // Phase 03 R1/R2 — single writer, three triggers. Mirror state into
      // React (chrome consumers read `position`), then route persistence
      // through positionStore.savePosition. Triggers fired here:
      //   • chapter-change — fires immediately on chapter crossing (D-G2)
      //   • debounce-30s — scheduled (or rescheduled) on every accepted event
      // The third trigger (appstate-background) is wired in its own effect.
      setFromBridge(position);
      logger.debug('ReaderView: trigger check', {
        chapterIndex: position.chapterIndex,
        lastSavedChapterIndexRef: lastSavedChapterIndexRef.current,
        willFireChapterChange: position.chapterIndex !== lastSavedChapterIndexRef.current,
      });
      if (position.chapterIndex !== lastSavedChapterIndexRef.current) {
        lastSavedChapterIndexRef.current = position.chapterIndex;
        logger.debug('ReaderView: chapter-change trigger firing', {
          newChapter: position.chapterIndex,
        });
        persistNow('chapter-change');
      }
      scheduleDebouncedSave();
    },
    [
      bookId,
      setFromBridge,
      hasAudio,
      audioChapters,
      chapters.length,
      persistNow,
      scheduleDebouncedSave,
    ],
  );

  const handleFontSizeChange = useCallback((px: number) => {
    setFontSize(px);
    webViewRef.current?.setFontSize(px);
    AsyncStorage.setItem(FONT_SIZE_KEY, String(px));
  }, []);

  const handleLineHeightChange = useCallback((value: ReaderLineHeight) => {
    setLineHeight(value);
    webViewRef.current?.setLineHeight(value);
    AsyncStorage.setItem(LINE_HEIGHT_KEY, String(value));
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

  const handleProgressDisplayChange = useCallback((v: ReaderProgressDisplay) => {
    setProgressDisplay(v);
    AsyncStorage.setItem(PROGRESS_DISPLAY_KEY, v);
  }, []);

  const handleChapterSelect = useCallback((index: number) => {
    // Explicit user nav overrides any pending saved-CFI restore. Update refs
    // synchronously so the resulting POSITION_CHANGE isn't gated.
    pendingRestorePositionRef.current = null;
    pendingCfiRef.current = null;
    setPendingCfi(null);
    setCurrentChapterIndex(index);
    if (ready) {
      webViewRef.current?.goToChapter(index);
    } else {
      setTimeout(() => webViewRef.current?.goToChapter(index), 200);
    }
  }, [ready]);

  const handleParagraphTap = useCallback((percentComplete: number, chapterIndex: number) => {
    if (!hasAudio || audioChapters.length === 0) return;
    if (percentComplete <= 0) return;
    getOrBuildLayer0(
      bookId,
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
  }, [hasAudio, audioChapters, chapters.length, bookId]);

  useEffect(() => {
    if (!locationsReady || !pendingCfi) return;
    logger.info('ReaderView: navigating to saved CFI on locationsReady', { cfi: pendingCfi });
    webViewRef.current?.goTo(pendingCfi);
    // Phase 03 R7 / CR-02: do NOT clear pendingCfi here. It clears only when
    // handlePositionChange confirms the new chapterIndex >= savedChapterIndex.
    // If goTo fails silently, pendingCfi stays set and a subsequent
    // locationsReady cycle (e.g., orientation change) retries the restore.
  }, [locationsReady, pendingCfi]);

  useEffect(() => {
    loadHighlights(bookId).then((hs) => {
      setHighlights(hs);
      if (hs.length > 0 && ready) {
        webViewRef.current?.loadHighlights(hs.map((h) => ({ id: h.id, cfiRange: h.cfiRange, color: h.color })));
      }
    }).catch(() => {});
  }, [bookId, ready]);

  const handleTextSelected = useCallback((cfiRange: string, text: string, chapterIndex: number) => {
    setPendingSelection({ cfiRange, text, chapterIndex });
  }, []);

  const handleHighlightColor = useCallback((hex: string) => {
    if (!pendingSelection) return;
    const highlight: Highlight = {
      id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      cfiRange: pendingSelection.cfiRange,
      text: pendingSelection.text,
      color: hex,
      chapterIndex: pendingSelection.chapterIndex,
      createdAt: Date.now(),
    };
    setPendingSelection(null);
    setHighlights((prev) => [...prev, highlight]);
    webViewRef.current?.addHighlight(highlight.id, highlight.cfiRange, highlight.color);
    saveHighlight(highlight).catch(() => {});
  }, [pendingSelection, bookId]);

  const handleDeleteHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    webViewRef.current?.removeHighlight(id);
    deleteHighlight(bookId, id).catch(() => {});
  }, [bookId]);

  const handleHighlightNavigate = useCallback((cfiRange: string) => {
    const commaIdx = cfiRange.indexOf(',');
    const cfi = commaIdx > 0 ? cfiRange.slice(0, commaIdx) + ')' : cfiRange;
    webViewRef.current?.goTo(cfi);
    setControlsVisible(false);
  }, []);

  const bgColor = theme === 'dark' ? VoidColors.void : theme === 'sepia' ? '#f5efe0' : '#ffffff';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar hidden />

      <EpubWebView
        ref={webViewRef}
        onReady={() => { readyRef.current = true; setReady(true); }}
        onPositionChange={handlePositionChange}
        onLocationsReady={(count) => { setLocationsReady(true); setTotalLocations(count); }}
        onChapterList={(list) => {
          setChapters(list);
          if (audioChapters.length > 0) {
            ensureLayer0Fresh(bookId, audioChapters, list.length).catch(() => {});
          }
          cacheChaptersInBackground(bookId, list.length, webViewRef);
          persistEpubChapterCount(user?.uid, bookId, list.length);
        }}
        onWordLookup={setLookupWordValue}
        onParagraphTap={handleParagraphTap}
        onTextSelected={handleTextSelected}
        onError={setErrorMsg}
        onSearchResults={(requestId, results, done) =>
          searchDrawerRef.current?.receiveResults(requestId, results, done)
        }
        onSearchError={(requestId, error) =>
          searchDrawerRef.current?.receiveError(requestId, error)
        }
      />

      {loading && (
        <View style={[styles.loadingOverlay, { backgroundColor: theme === 'dark' ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.9)' }]}>
          <AnimatedLoader
            variant="random"
            color={theme === 'dark' ? VoidColors.luminousGreen : '#1A2438'}
            accent={theme === 'dark' ? VoidColors.pureWhite : '#E8DFC8'}
            size={72}
            message="Turning to your page"
          />
        </View>
      )}

      {errorMsg && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      <TopDrawerModal
        visible={controlsVisible}
        onDismiss={() => setControlsVisible(false)}
      >
        <ReaderDrawer
          chapters={chapters}
          currentChapterIndex={currentChapterIndex}
          fontSize={fontSize}
          lineHeight={lineHeight}
          theme={theme}
          fontFamily={fontFamily}
          margin={margin}
          onFontSizeChange={handleFontSizeChange}
          onLineHeightChange={handleLineHeightChange}
          onThemeChange={handleThemeChange}
          onFontFamilyChange={handleFontFamilyChange}
          onMarginChange={handleMarginChange}
          progressDisplay={progressDisplay}
          onProgressDisplayChange={handleProgressDisplayChange}
          onChapterSelect={(idx) => { handleChapterSelect(idx); setControlsVisible(false); }}
          onClose={() => setControlsVisible(false)}
          bookTitle={bookTitle}
          onHome={() => { setControlsVisible(false); onClose(); }}
          highlights={highlights}
          onHighlightNavigate={handleHighlightNavigate}
          onHighlightDelete={handleDeleteHighlight}
        />
      </TopDrawerModal>

      {locationsReady && livePosition && livePosition.percentComplete > 0 && (
        <Text
          style={[
            styles.progressLabel,
            {
              bottom: insets.bottom + 12,
              color: theme === 'dark' ? VoidColors.mutedAsh : 'rgba(42,37,32,0.38)',
            },
          ]}
          pointerEvents="none"
        >
          {progressDisplay === 'page' && totalLocations > 0
            ? `Page ${Math.max(1, Math.round(livePosition.percentComplete * totalLocations))} of ${totalLocations}`
            : `${Math.round(livePosition.percentComplete * 100)}%`}
        </Text>
      )}

      {tapSeekToast && (
        <View style={styles.tapSeekToast} pointerEvents="none">
          <Text style={styles.tapSeekToastText}>▶ Audio jumping here</Text>
        </View>
      )}

      {controlsVisible && (
        <TouchableOpacity
          style={[styles.searchBtn, { bottom: insets.bottom + 12 }]}
          onPress={() => { setControlsVisible(false); setSearchVisible(true); }}
          accessibilityLabel="Search in book"
          accessibilityRole="button"
        >
          <Text style={styles.searchBtnText}>🔍</Text>
        </TouchableOpacity>
      )}

      <WordLookupModal word={lookupWordValue} onClose={() => setLookupWordValue(null)} />

      <HighlightMenu
        visible={!!pendingSelection}
        selectedText={pendingSelection?.text ?? ''}
        theme={theme}
        onSelectColor={handleHighlightColor}
        onDismiss={() => setPendingSelection(null)}
      />

      <EpubSearchDrawer
        ref={searchDrawerRef}
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSearch={(query, requestId) =>
          webViewRef.current?.search(query, requestId)
        }
        chapters={chapters}
      />
    </View>
  );
});

export default ReaderView;

const styles = StyleSheet.create({
  container: { flex: 1 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VoidColors.void,
    padding: 32,
  },
  errorText: { fontSize: 15, color: VoidColors.vividCrimson, textAlign: 'center', marginBottom: 24, fontWeight: '700', letterSpacing: 0.2 },
  backBtn: {
    backgroundColor: VoidColors.pureWhite,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: VoidRadius.pill,
  },
  backBtnText: { color: VoidColors.void, fontWeight: '800', letterSpacing: 0.4 },

  progressLabel: {
    position: 'absolute',
    left: 16,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    zIndex: 10,
  },

  tapSeekToast: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: VoidColors.luminousGreen,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: VoidRadius.pill,
    zIndex: 50,
  },
  tapSeekToastText: {
    color: VoidColors.void,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  searchBtn: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    backgroundColor: VoidColors.surface,
    borderRadius: VoidRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  searchBtnText: {
    fontSize: 18,
  },
});
