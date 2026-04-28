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
import { localListBooks } from '@/services/book/localBookStore';
import { getCachedPath } from '@/services/storage/localStorageService';
import { File, Directory, Paths } from 'expo-file-system';
import { CACHE_DIR, POSITIONS_CACHE_KEY } from '@/constants/config';
import { EpubPosition } from '@/types/position';
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
  getVisibleSnippet: (n?: number, timeoutMs?: number) => Promise<string[] | null>;
  syncToAudio: (timestampSeconds: number, audioChapterIdx: number) => Promise<void>;
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

  const { chapters: audioChapters, book: nowPlayingBook } = useNowPlaying();
  const audioLoadedForThisBook = nowPlayingBook?.id === bookId && audioChapters.length > 0;
  const hasAudio = audioLoadedForThisBook;

  const { position: audioPosition } = useProgress(1000);
  const currentAudioChapter = audioChapters.length > 0
    ? audioChapters.reduce((best, ch) => (ch.startSeconds <= audioPosition ? ch : best), audioChapters[0])
    : null;

  const readyRef = useRef(false);
  const lastEpubChapterRef = useRef(-1);
  const [pendingCfi, setPendingCfi] = useState<string | null>(null);
  const { position: livePosition, onPositionChange, loadLocalPosition } = useEpubPosition(bookId, user?.uid ?? null);

  useImperativeHandle(ref, () => ({
    getCurrentPosition: async () => {
      try {
        return (await webViewRef.current?.getCurrentPosition()) ?? null;
      } catch {
        return null;
      }
    },
    getVisibleSnippet: async (n = 8, timeoutMs = 2000) => {
      try {
        return (await webViewRef.current?.getVisibleSnippet(n, timeoutMs)) ?? null;
      } catch {
        return null;
      }
    },
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
        if (target.cfi) webViewRef.current?.goTo(target.cfi);
        else webViewRef.current?.goToChapter(target.chapterIndex);
      } catch (err) {
        logger.warn('ReaderView: syncToAudio failed', err);
      }
    },
  }), [bookId, audioChapters, chapters.length]);

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
          setPendingCfi(saved.cfi);
        }
      } catch (err) {
        logger.error('ReaderView: failed to load epub', err);
        setErrorMsg('Failed to load book. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, user, bookId, resumeFromAudio]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState !== 'background' && nextState !== 'inactive') return;
      (async () => {
        try {
          const pos = await webViewRef.current?.getCurrentPosition();
          if (!pos || pos.percentComplete === 0) return;
          const key = `${POSITIONS_CACHE_KEY}:${bookId}:epub`;
          await AsyncStorage.setItem(key, JSON.stringify({ ...pos, savedAt: Date.now() }));
        } catch { /* silent */ }
      })();
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [bookId]);

  const handlePositionChange = useCallback(
    (position: EpubPosition, programmatic: boolean) => {
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

      onPositionChange(position, async (pos) => {
        if (!user || !deviceId) return;
        try {
          const syncedPos = {
            bookId,
            deviceId,
            chapterIndex: pos.chapterIndex,
            epubCfi: pos.cfi,
            charOffset: pos.charOffset,
            audioTimestamp: 0,
            percentComplete: pos.percentComplete,
            source: 'epub' as const,
            updatedAt: Date.now(),
          };
          await pushPosition(user.uid, bookId, deviceId, syncedPos);
        } catch (err) {
          logger.warn('Failed to push epub position', err);
        }
      });
    },
    [user, deviceId, bookId, onPositionChange, hasAudio, audioChapters, chapters.length],
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
    if (!locationsReady || !pendingCfi) return;
    logger.info('ReaderView: navigating to saved CFI on locationsReady', { cfi: pendingCfi });
    webViewRef.current?.goTo(pendingCfi);
    setPendingCfi(null);
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

  const bgColor = theme === 'dark' ? '#121212' : theme === 'sepia' ? '#f5efe0' : '#ffffff';

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
        }}
        onWordLookup={setLookupWordValue}
        onParagraphTap={handleParagraphTap}
        onTextSelected={handleTextSelected}
        onError={setErrorMsg}
      />

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

      {errorMsg && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.topTapStrip, { top: insets.top }]}
        onPress={() => setControlsVisible(true)}
        activeOpacity={1}
        accessibilityLabel="Open reader options"
      />

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
              color: theme === 'dark' ? 'rgba(232,223,200,0.45)' : 'rgba(42,37,32,0.38)',
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

      <WordLookupModal word={lookupWordValue} onClose={() => setLookupWordValue(null)} />

      <HighlightMenu
        visible={!!pendingSelection}
        selectedText={pendingSelection?.text ?? ''}
        theme={theme}
        onSelectColor={handleHighlightColor}
        onDismiss={() => setPendingSelection(null)}
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
});
