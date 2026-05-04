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
import { savePosition } from '@/services/storage/positionStore';
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
  markPositionHere: () => boolean;
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
  const [spotSavedToast, setSpotSavedToast] = useState(false);
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { position: livePosition, setFromBridge, loadLocalPosition } = useEpubPosition(bookId);

  useImperativeHandle(ref, () => ({
    getCurrentPosition: async () => {
      try {
        return (await webViewRef.current?.getCurrentPosition()) ?? null;
      } catch {
        return null;
      }
    },
    getLastKnownPosition: () => livePositionRef.current,
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
          webViewRef.current?.goTo(target.cfi);
        } else if (target.chapterIndex > currentChapterIndex) {
          // L0 only: only advance forward.
          webViewRef.current?.goToChapter(target.chapterIndex);
        }
      } catch (err) {
        logger.warn('ReaderView: syncToAudio failed', err);
      }
    },
    markPositionHere: () => {
      const live = livePositionRef.current;
      if (!live?.cfi) {
        logger.warn('ReaderView: markPositionHere skipped (no live position)');
        return false;
      }
      savePosition(
        bookId,
        {
          cfi: live.cfi,
          chapterIndex: live.chapterIndex,
          charOffset: live.charOffset ?? 0,
          percentComplete: live.percentComplete,
          updatedAt: Date.now(),
        },
        {
          userId: user?.uid ?? null,
          deviceId: deviceId ?? null,
          trigger: 'manual-mark',
        },
      );

      if (audioChapters.length > 0) {
        const totalChapters = chapters.length > 0 ? chapters.length : audioChapters.length;
        getOrBuildLayer0(bookId, audioChapters, totalChapters)
          .then((alignment) => {
            const target = readerToAudio(
              {
                chapterIndex: live.chapterIndex,
                cfi: live.cfi,
                charOffset: live.charOffset ?? 0,
                chapterFraction: -1,
                percentComplete: live.percentComplete,
              },
              alignment,
            );
            const audioKey = `${POSITIONS_CACHE_KEY}:${bookId}:audio`;
            return AsyncStorage.setItem(
              audioKey,
              JSON.stringify({
                bookId,
                timestampSeconds: Math.max(0, target.timestampSeconds),
                chapterIndex: target.chapterIndex,
                updatedAt: Date.now(),
              }),
            );
          })
          .catch((err) => logger.warn('markPositionHere: audio cache write failed', err));
      }

      setSpotSavedToast(true);
      setTimeout(() => setSpotSavedToast(false), 1500);
      return true;
    },
  }), [bookId, audioChapters, chapters.length, currentChapterIndex, user?.uid, deviceId]);

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

        // Resolve the start CFI BEFORE handing the EPUB to the bridge. The
        // bridge passes it to rendition.display() so the very first frame
        // opens at the right spot — no chapter-0 flash, no race against
        // locations.generate(), no queued goTo waiting for locationsReady.
        // Three sources, in priority order:
        //   1. Audio handoff (resumeFromAudio): convert audio time → CFI
        //   2. Saved local EPUB position
        //   3. None: open at start of book
        let startCfi: string | undefined;

        if (resumeFromAudio) {
          let audioTimestampForHandoff = audioPosition;
          if (audioTimestampForHandoff === 0) {
            try {
              const audioKey = `${POSITIONS_CACHE_KEY}:${bookId}:audio`;
              const raw = await AsyncStorage.getItem(audioKey);
              if (raw) {
                const parsed = JSON.parse(raw) as { timestampSeconds: number };
                audioTimestampForHandoff = parsed.timestampSeconds ?? 0;
              }
            } catch { /* use 0 */ }
          }
          if (audioTimestampForHandoff > 0 && audioChapters.length > 0) {
            try {
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
              if (target.cfi) startCfi = target.cfi;
            } catch (err) {
              logger.warn('ReaderView: audio handoff alignment failed', err);
            }
          }
        }

        if (!startCfi) {
          const saved = await loadLocalPosition();
          if (saved?.cfi) {
            startCfi = saved.cfi;
            logger.info('ReaderView: opening at saved CFI', {
              cfi: saved.cfi,
              chapterIndex: saved.chapterIndex,
            });
          } else {
            logger.info('ReaderView: no saved CFI — opening at start');
          }
        } else {
          logger.info('ReaderView: opening at audio-handoff CFI', { cfi: startCfi });
        }

        logger.info('ReaderView: handing epub uri to WebView', { uri: epubUri });
        webViewRef.current?.loadBookFromUri(epubUri, startCfi);

        webViewRef.current?.setFontSize(fontSize);
        webViewRef.current?.setLineHeight(lineHeight);
        webViewRef.current?.setTheme(theme);
        webViewRef.current?.setFontFamily(FONT_FAMILY_VALUES[fontFamily]);
        webViewRef.current?.setMargin(MARGIN_VALUES[margin]);
      } catch (err) {
        logger.error('ReaderView: failed to load epub', err);
        setErrorMsg('Failed to load book. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, user, bookId, resumeFromAudio]);

  // Save the current live position. Debounced 1.5s so a fast burst of page
  // turns coalesces into a single AsyncStorage write. Single trigger, no
  // gates: every accepted POSITION_CHANGE feeds this.
  const scheduleSave = useCallback((position: EpubPosition) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePosition(
        bookId,
        {
          cfi: position.cfi,
          chapterIndex: position.chapterIndex,
          charOffset: position.charOffset ?? 0,
          percentComplete: position.percentComplete,
          updatedAt: Date.now(),
        },
        {
          userId: user?.uid ?? null,
          deviceId: deviceId ?? null,
          trigger: 'page-turn',
        },
      );
    }, 1500);
  }, [bookId, user?.uid, deviceId]);

  // AppState → background: flush whatever we have right now. Catches force-
  // quits and OS-initiated backgrounds that wouldn't survive the debounce.
  useEffect(() => {
    const onAppState = (s: AppStateStatus) => {
      if (s !== 'background' && s !== 'inactive') return;
      const live = livePositionRef.current;
      if (!live?.cfi) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      savePosition(
        bookId,
        {
          cfi: live.cfi,
          chapterIndex: live.chapterIndex,
          charOffset: live.charOffset ?? 0,
          percentComplete: live.percentComplete,
          updatedAt: Date.now(),
        },
        {
          userId: user?.uid ?? null,
          deviceId: deviceId ?? null,
          trigger: 'appstate-background',
        },
      );
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [bookId, user?.uid, deviceId]);

  // Cleanup the save timer on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handlePositionChange = useCallback(
    (position: EpubPosition, programmatic: boolean) => {
      // Mirror into React state + ref unconditionally so the chrome and
      // beforeRemove always see the latest position, even during the brief
      // initial-render window before locations.generate() finishes.
      livePositionRef.current = position;
      setCurrentChapterIndex(position.chapterIndex);
      setFromBridge(position);

      // Don't save during the bridge's startup events: the very first
      // rendition.display() — even when handed startCfi — fires a few
      // programmatic relocates before settling. Letting them through would
      // overwrite the saved CFI with a stale earlier one. Once the rendition
      // is stable, programmatic is false for natural user pagination.
      if (programmatic) return;

      // Audio↔EPUB live cross-sync: if reading mode is active and audio is
      // loaded, keep the audio cursor near the visible chapter so a switch
      // to listen mode resumes near the current page.
      if (hasAudio && audioChapters.length > 0) {
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

      scheduleSave(position);
    },
    [bookId, setFromBridge, hasAudio, audioChapters, chapters.length, scheduleSave],
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

      {spotSavedToast && (
        <View style={styles.tapSeekToast} pointerEvents="none">
          <Text style={styles.tapSeekToastText}>📍 Spot saved</Text>
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
