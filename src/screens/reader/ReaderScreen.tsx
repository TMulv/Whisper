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
import ReaderControls from '@/components/reader/ReaderControls';
import ImmersionBar from '@/components/reader/ImmersionBar';
import { useAuth } from '@/hooks/useAuth';
import { useEpubPosition } from '@/hooks/useEpubPosition';
import { useImmersionReading } from '@/hooks/useImmersionReading';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { readSyncState } from '@/services/firebase/firestoreService';
import { getCachedPath } from '@/services/storage/localStorageService';
import { EpubPosition } from '@/types/position';
import { FirestorePosition } from '@/types/firebase';
import { pushPosition } from '@/services/sync/syncEngine';
import { logger } from '@/utils/logger';
import type { LibraryStackParamList } from '@/navigation/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Props = NativeStackScreenProps<LibraryStackParamList, 'Reader'>;

const DEVICE_ID_KEY = '@whisper/device_id';
const FONT_SIZE_KEY = '@whisper/font_size';

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
  const [controlsVisible, setControlsVisible] = useState(false);
  const [syncBannerData, setSyncBannerData] = useState<FirestorePosition | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [immersionActive, setImmersionActive] = useState(false);
  const [immersionRate, setImmersionRate] = useState(1.0);

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

  // ── Mount: load device ID, persisted font size, initial position ───────────
  useEffect(() => {
    getOrCreateDeviceId().then(setDeviceId);
    AsyncStorage.getItem(FONT_SIZE_KEY).then((v) => {
      if (v) setFontSize(parseInt(v, 10));
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
          logger.warn('ReaderScreen: epub not cached', { bookId: params.bookId });
          setErrorMsg('EPUB file not found locally. Please download the book first.');
          setLoading(false);
          return;
        }

        logger.info('ReaderScreen: handing epub uri to WebView', { uri: epubUri });
        webViewRef.current?.loadBookFromUri(epubUri);

        webViewRef.current?.setFontSize(fontSize);
        webViewRef.current?.setTheme(theme);

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
        onError={setErrorMsg}
      />

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <AnimatedLoader
            variant="book"
            color={theme === 'dark' ? '#C9A96E' : '#1A1A2E'}
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
              onFontSizeChange={handleFontSizeChange}
              onThemeChange={handleThemeChange}
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

      {/* Immersion toggle (top-right) — only shown when audio is loaded */}
      {hasAudio && (
        <TouchableOpacity
          style={[styles.immersionIcon, { top: insets.top + 8 }]}
          onPress={() => setImmersionActive((v) => !v)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={[styles.backIconBubble, immersionActive && styles.immersionIconActive]}>
            <Text style={styles.backIconText}>{immersionActive ? '🎧' : '🎧'}</Text>
          </View>
        </TouchableOpacity>
      )}

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

  // Immersion mode toggle
  immersionIcon: {
    position: 'absolute',
    right: 12,
    zIndex: 30,
  },
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
