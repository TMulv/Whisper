import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  Modal,
  BackHandler,
  StatusBar,
  Platform,
} from 'react-native';
import { AnimatedLoader } from '@/components/common/AnimatedLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EpubWebView, { EpubWebViewRef, EpubChapter, EpubTheme } from '@/components/reader/EpubWebView';
import SyncBanner from '@/components/reader/SyncBanner';
import ReaderControls, {
  ReaderFontFamily,
  ReaderMargin,
  FONT_FAMILY_VALUES,
  MARGIN_VALUES,
} from '@/components/reader/ReaderControls';
import WordLookupModal from '@/components/reader/WordLookupModal';
import ImmersionBar from '@/components/reader/ImmersionBar';
import AIInsightsModal from '@/components/ai/AIInsightsModal';
import { useAuth } from '@/hooks/useAuth';
import { useEpubPosition } from '@/hooks/useEpubPosition';
import { useImmersionReading } from '@/hooks/useImmersionReading';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { readSyncState, deleteBook } from '@/services/firebase/firestoreService';
import { localDeleteBook, localListBooks } from '@/services/book/localBookStore';
import { getCachedPath } from '@/services/storage/localStorageService';
import { File } from 'expo-file-system';
import { EpubPosition } from '@/types/position';
import { FirestorePosition } from '@/types/firebase';
import { pushPosition } from '@/services/sync/syncEngine';
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
  const [immersionActive, setImmersionActive] = useState(false);
  const [immersionRate, setImmersionRate] = useState(1.0);
  const [aiVisible, setAiVisible] = useState(false);
  const [bookMeta, setBookMeta] = useState<{ title: string; author: string } | null>(null);

  const { chapters: audioChapters } = useNowPlaying();
  const hasAudio = audioChapters.length > 0;

  const immersion = useImmersionReading({
    webViewRef,
    audioChapters,
    epubChapterCount: chapters.length,
    enabled: immersionActive,
  });

  const readyRef = useRef(false);
  const { onPositionChange, loadLocalPosition } = useEpubPosition(params.bookId, user?.uid ?? null);

  // ── Load book metadata (title/author) for AI context ───────────────────────
  useEffect(() => {
    if (!user) return;
    localListBooks(user.uid).then((books) => {
      const found = books.find((b) => b.id === params.bookId);
      if (found) setBookMeta({ title: found.title, author: found.author ?? '' });
    });
  }, [user, params.bookId]);

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

  // ── After bridge ready: load the epub and check for audio sync position ────
  useEffect(() => {
    if (!ready || !user) return;

    (async () => {
      try {
        logger.info('ReaderScreen: bridge ready, loading epub', { bookId: params.bookId });
        const epubUri = await getCachedPath(params.bookId, 'epub', 'epub');
        if (!epubUri) {
          logger.warn('ReaderScreen: epub not cached, self-healing', { bookId: params.bookId });
          try {
            await localDeleteBook(user.uid, params.bookId);
          } catch (err) {
            logger.warn('ReaderScreen: localDeleteBook during self-heal failed', err);
          }
          deleteBook(user.uid, params.bookId).catch(() => {});
          setErrorMsg('This book is missing its EPUB file and has been removed from your library. Please re-add it.');
          setLoading(false);
          setTimeout(() => {
            if (navigation.canGoBack()) navigation.goBack();
          }, 1500);
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
        if (saved && !params.resumeFromAudio) {
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

  // ── Android back: save position before leaving ─────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.goBack();
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handlePositionChange = useCallback(
    (position: EpubPosition) => {
      setCurrentChapterIndex(position.chapterIndex);
      onPositionChange(position, async (pos) => {
        if (!user || !deviceId) return;
        try {
          // We need a BookSyncMap to convert — for now push epub position directly
          // Full sync map integration happens in Phase 5
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
    [user, deviceId, params.bookId, onPositionChange],
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

  const handleSyncResume = useCallback(() => {
    if (!syncBannerData) return;
    setSyncBannerData(null);
    if (syncBannerData.epubCfi) {
      webViewRef.current?.goTo(syncBannerData.epubCfi);
    } else {
      webViewRef.current?.goToChapter(syncBannerData.chapterIndex);
    }
  }, [syncBannerData]);

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
        onChapterList={setChapters}
        onWordLookup={setLookupWordValue}
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

      {/* Top bar: back + settings button (tap centre of screen to show) */}
      <TouchableOpacity
        style={[styles.tapZoneCenter, { top: insets.top }]}
        onPress={() => setControlsVisible(true)}
        activeOpacity={1}
      />

      {/* Settings/controls modal */}
      <Modal
        visible={controlsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setControlsVisible(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setControlsVisible(false)}
        >
          {/* Prevent tap-through to backdrop from the panel itself */}
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <ReaderControls
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
              onChapterSelect={handleChapterSelect}
              onClose={() => setControlsVisible(false)}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Back button (top-left) */}
      <TouchableOpacity
        style={[styles.backIcon, { top: insets.top + 8 }]}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <View style={styles.backIconBubble}>
          <Text style={styles.backIconText}>‹</Text>
        </View>
      </TouchableOpacity>

      {/* Top-right action buttons stack: AI + (optional) immersion */}
      <View style={[styles.topRightStack, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.topRightBtn}
          onPress={() => setAiVisible(true)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.backIconBubble}>
            <Text style={styles.aiIconText}>✨</Text>
          </View>
        </TouchableOpacity>
        {hasAudio && (
          <TouchableOpacity
            style={styles.topRightBtn}
            onPress={() => setImmersionActive((v) => !v)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <View style={[styles.backIconBubble, immersionActive && styles.immersionIconActive]}>
              <Text style={styles.backIconText}>🎧</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* AI insights modal */}
      <AIInsightsModal
        visible={aiVisible}
        onClose={() => setAiVisible(false)}
        chapterContext={{
          bookTitle: bookMeta?.title ?? 'This book',
          author: bookMeta?.author ?? '',
          chapterTitle: chapters[currentChapterIndex]?.title ?? '',
          chapterIndex: currentChapterIndex,
          totalChapters: chapters.length || 1,
        }}
        loadChapterText={async () => {
          try {
            const text = await webViewRef.current?.getChapterText(currentChapterIndex);
            return text && text.length > 0 ? text : null;
          } catch (err) {
            logger.warn('ReaderScreen: getChapterText failed', err);
            return null;
          }
        }}
        onOpenSettings={() => {
          (navigation as any).navigate('Main', { screen: 'Settings' });
        }}
      />


      {/* Word lookup modal */}
      <WordLookupModal word={lookupWordValue} onClose={() => setLookupWordValue(null)} />

      {/* Immersion bar — fixed at bottom when active */}
      {immersionActive && (
        <View style={[styles.immersionBarContainer, { paddingBottom: insets.bottom }]}>
          <ImmersionBar
            theme={theme}
            isPlaying={immersion.isPlaying}
            position={immersion.position}
            duration={immersion.duration}
            currentChapter={immersion.currentAudioChapter}
            chapters={audioChapters}
            playbackRate={immersionRate}
            onRateChange={setImmersionRate}
            onClose={() => setImmersionActive(false)}
          />
        </View>
      )}
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

  // Invisible centre tap zone to open controls
  tapZoneCenter: {
    position: 'absolute',
    left: '30%',
    right: '30%',
    height: 60,
    zIndex: 20,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },

  // Back chevron
  backIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 30,
  },
  backIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIconText: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
    marginLeft: -2,
  },

  // Top-right action stack (AI, immersion)
  topRightStack: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    gap: 8,
    zIndex: 30,
  },
  topRightBtn: {},
  aiIconText: { fontSize: 18, lineHeight: 22 },
  immersionIconActive: {
    backgroundColor: 'rgba(26,26,46,0.85)',
  },

  // Immersion bar anchored at bottom
  immersionBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
});
