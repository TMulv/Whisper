import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Alert,
  RefreshControl,
  Animated,
  Image,
  Dimensions,
  Easing,
} from 'react-native';
import {
  VoidColors,
  VoidFonts,
  VoidWeight,
  VoidRadius,
  pickAccent,
} from '@/constants/voidTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { useBooks } from '@/hooks/useBook';
import { useFileStorage } from '@/hooks/useFileStorage';
import { useNowPlaying } from '@/context/NowPlayingContext';
import AddBookModal from '@/components/library/AddBookModal';
import { LocalBook } from '@/types/book';
import { writeBook, deleteBook } from '@/services/firebase/firestoreService';
import { localWriteBook, localDeleteBook } from '@/services/book/localBookStore';
import {
  isAuthenticated as isNextcloudAuthenticated,
  listBooks as listNextcloudBooks,
  listBookFiles as listNextcloudBookFiles,
  downloadFile as downloadNextcloudFile,
  NextcloudEntry,
} from '@/services/storage/nextcloudService';
import {
  isAuthenticated as isGDriveAuthenticated,
  listBooks as listGDriveBooks,
  listBookFiles as listGDriveBookFiles,
  downloadFile as downloadGDriveFile,
  DriveEntry,
} from '@/services/storage/googleDriveService';
import {
  isAvailable as isICloudAvailable,
  listICloudBooks,
  listICloudBookFiles,
  copyFromICloud,
  ICloudEntry,
} from '@/services/storage/icloudService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LibraryStackParamList } from '@/navigation/types';
import * as Crypto from 'expo-crypto';
import {
  buildCachePath,
  cacheFile,
  ensureCacheDir,
  deleteCacheFilesForBookId,
} from '@/services/storage/localStorageService';
import { logger } from '@/utils/logger';
import { probeAudioDuration } from '@/services/audio/audioProbe';
import {
  subscribeToPendingImport,
  takePendingImport,
} from '@/services/pendingImportStore';
import { formatDuration } from '@/utils/timeUtils';
import { getBookDisplay } from '@/utils/bookDisplay';
import BookSyncIndicator from '@/components/library/BookSyncIndicator';

const ICLOUD_ENABLED_KEY = '@whisper/icloud_enabled';

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'LibraryHome'>;
type LibraryHomeRoute = RouteProp<LibraryStackParamList, 'LibraryHome'>;

// ── Aesthetic tokens ──────────────────────────────────────────────────────────
// "Vivid Retro-Digital" / "Luminous Industrial Void". Black canvas, white text,
// one accent per surface (per-book accent via pickAccent). Tokens come from
// @/constants/voidTheme — never redefine inline.

const { width: SCREEN_W } = Dimensions.get('window');
const H_PAD = 24;
const COL_GAP = 18;
const COLS = 3;
const COVER_W = Math.floor((SCREEN_W - H_PAD * 2 - COL_GAP * (COLS - 1)) / COLS);
const COVER_H = Math.round(COVER_W * 1.5); // classic 2:3 book proportion

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function totalHours(books: LocalBook[]): number {
  const s = books.reduce((acc, b) => acc + (b.totalDurationSeconds || 0), 0);
  return Math.round(s / 3600);
}

// ── Shelf hairline ────────────────────────────────────────────────────────────
// A flat 1px divider in ghostlyDim. No gold, no glow — the void aesthetic uses
// solid color shifts, not subtle gradients.

function ShelfLine({ inset = 0 }: { inset?: number }) {
  return (
    <View style={[styles.shelfWrap, { marginHorizontal: inset }]}>
      <View style={styles.shelfLine} />
    </View>
  );
}

// ── Single book on the shelf ──────────────────────────────────────────────────

function ShelfBook({
  book,
  userId,
  onPress,
  onLongPress,
}: {
  book: LocalBook;
  userId: string | null;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const press = useRef(new Animated.Value(0)).current;

  const handlePressIn = () =>
    Animated.timing(press, { toValue: 1, duration: 140, useNativeDriver: true }).start();
  const handlePressOut = () =>
    Animated.timing(press, { toValue: 0, duration: 220, useNativeDriver: true }).start();

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });
  const lift = press.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  const display = getBookDisplay(book);
  const accent = pickAccent(book.id);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.shelfBookSlot}
    >
      <Animated.View
        style={[
          styles.coverShadowWrap,
          { transform: [{ scale }, { translateY: lift }] },
        ]}
      >
        {book.coverUri ? (
          <Image source={{ uri: book.coverUri }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: accent }]}>
            <Text style={styles.coverInitial}>
              {display.title[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
        )}
        {/* Solid 3px accent stripe down the left edge — no gloss, no spine shadow */}
        <View
          pointerEvents="none"
          style={[styles.coverAccentStripe, { backgroundColor: accent }]}
        />
        {!book.isDownloaded && <View style={styles.cloudDot} />}
        <BookSyncIndicator userId={userId} bookId={book.id} />
      </Animated.View>

      <Text numberOfLines={2} style={styles.shelfTitle}>
        {display.title}
      </Text>
      {display.author ? (
        <Text numberOfLines={1} style={styles.shelfAuthor}>
          {display.author}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── A row of up to COLS books, animated into place ────────────────────────────

function ShelfRow({
  row,
  index,
  userId,
  onOpen,
  onDelete,
}: {
  row: LocalBook[];
  index: number;
  userId: string | null;
  onOpen: (b: LocalBook) => void;
  onDelete: (b: LocalBook) => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 520,
      delay: 60 + index * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  const slots = useMemo(() => {
    const filled: (LocalBook | null)[] = [...row];
    while (filled.length < COLS) filled.push(null);
    return filled;
  }, [row]);

  return (
    <Animated.View style={[styles.row, { opacity: anim, transform: [{ translateY }] }]}>
      {slots.map((b, i) =>
        b ? (
          <ShelfBook
            key={b.id}
            book={b}
            userId={userId}
            onPress={() => onOpen(b)}
            onLongPress={() => onDelete(b)}
          />
        ) : (
          <View key={`empty-${i}`} style={styles.shelfBookSlot} />
        ),
      )}
    </Animated.View>
  );
}

// ── Skeleton shelf ────────────────────────────────────────────────────────────

function SkeletonShelf() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <>
      {[0, 1].map((r) => (
        <View key={r}>
          <View style={styles.row}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.shelfBookSlot}>
                <Animated.View
                  style={[styles.cover, styles.skeletonCover, { opacity: pulse }]}
                />
              </View>
            ))}
          </View>
          <ShelfLine />
        </View>
      ))}
    </>
  );
}

// ── Currently Reading hero ────────────────────────────────────────────────────
// A single featured book — either the now-playing title or the most recently
// updated one. Styled as an editorial plate: full-bleed cover, refined meta.

function CurrentlyReading({
  book,
  onOpen,
}: {
  book: LocalBook;
  onOpen: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 700,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  const display = getBookDisplay(book);
  const accent = pickAccent(book.id);

  return (
    <Animated.View
      style={[styles.heroWrap, { opacity: anim, transform: [{ translateY }] }]}
    >
      <Text style={styles.sectionEyebrow}>CURRENTLY READING</Text>

      <Pressable onPress={onOpen} style={styles.heroCard}>
        <View style={styles.heroCoverShadow}>
          {book.coverUri ? (
            <Image source={{ uri: book.coverUri }} style={styles.heroCover} resizeMode="cover" />
          ) : (
            <View style={[styles.heroCover, styles.coverPlaceholder, { backgroundColor: accent }]}>
              <Text style={styles.coverInitial}>
                {display.title[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          {/* Accent stripe down the spine — no gloss */}
          <View
            pointerEvents="none"
            style={[styles.heroAccentStripe, { backgroundColor: accent }]}
          />
        </View>

        <View style={styles.heroMeta}>
          <Text style={styles.heroTitle} numberOfLines={3}>
            {display.title}
          </Text>
          {display.author ? (
            <Text style={styles.heroAuthor} numberOfLines={1}>
              {display.author}
            </Text>
          ) : null}

          <View style={styles.heroDivider} />

          <View style={styles.heroStats}>
            <Text style={styles.heroStat}>
              {formatDuration(book.totalDurationSeconds)}
            </Text>
            <View style={styles.heroStatDot} />
            <Text style={styles.heroStat}>
              {book.totalChapters} ch
            </Text>
          </View>

          <View style={styles.heroCta}>
            <View style={styles.heroPlayDot} />
            <Text style={styles.heroCtaText}>Continue</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyShelf({ onAdd }: { onAdd: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 700,
      delay: 80,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  return (
    <Animated.View style={[styles.emptyWrap, { opacity: anim }]}>
      <Image
        source={require('../../../assets/Moe.png')}
        style={styles.emptyMoe}
        resizeMode="contain"
      />
      <Text style={styles.emptyHeading}>YOUR SHELF IS QUIET</Text>
      <Text style={styles.emptyBody}>
        Drop in a book and let Moe get to work.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onAdd} activeOpacity={0.85}>
        <Text style={styles.emptyBtnText}>Pair your first book</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({
  bookCount,
  hours,
  onAdd,
}: {
  bookCount: number;
  hours: number;
  onAdd: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  const countLine =
    bookCount === 0
      ? 'Your shelf is empty'
      : `${bookCount} ${bookCount === 1 ? 'volume' : 'volumes'}${
          hours > 0 ? `  ·  ${hours} ${hours === 1 ? 'hour' : 'hours'} of listening` : ''
        }`;

  return (
    <Animated.View style={[styles.headerWrap, { opacity: anim, transform: [{ translateY }] }]}>
      <View style={styles.topBar}>
        <View style={styles.wordmarkWrap}>
          <View style={styles.wordmarkDot} />
          <Text style={styles.wordmark}>GNO MOE</Text>
        </View>

        <TouchableOpacity
          onPress={onAdd}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.addBtn}
        >
          <Text style={styles.addBtnGlyph}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.displayTitle}>LIBRARY</Text>
      <Text style={styles.displayMeta}>{countLine}</Text>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavProp>();
  const route = useRoute<LibraryHomeRoute>();
  const { books, loading, error, removeBook, refresh: refreshBooks } = useBooks(user?.uid ?? null);
  const { book: nowPlayingBook } = useNowPlaying();
  const { pickEpub, pickAudio } = useFileStorage();
  const [modalVisible, setModalVisible] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasNextcloud, setHasNextcloud] = useState(false);
  const [hasGDrive, setHasGDrive] = useState(false);
  const [hasICloud, setHasICloud] = useState(false);
  const [pendingBookId, setPendingBookId] = useState(() => Crypto.randomUUID());
  /** Pre-selected file from an "Open with" / share-sheet action. Passed to
   *  AddBookModal so the matching slot is already filled in. */
  const [preselectedIncoming, setPreselectedIncoming] = useState<{
    kind: 'audio' | 'epub';
    uri: string;
    name: string;
  } | null>(null);
  /** Guards `handleIncomingFile` against double-processing the same file.
   *  If the store ever delivers a URI we've handled in the last 10s, skip it. */
  const processedIncomingRef = useRef<{ uri: string; ts: number } | null>(null);
  /** Source of truth for the current "add book" session's bookId. Stays stable
   *  across modal-open, multiple drops, and inside-modal file picks so every
   *  cacheFile call within one session lands at `{sameId}_*.*`. Cleared on
   *  confirm-success or modal dismiss. */
  const sessionBookIdRef = useRef<string | null>(null);
  const insets = useSafeAreaInsets();

  const startOrReuseSession = useCallback((): string => {
    if (sessionBookIdRef.current) return sessionBookIdRef.current;
    const id = Crypto.randomUUID();
    sessionBookIdRef.current = id;
    setPendingBookId(id);
    return id;
  }, []);

  const endSession = useCallback((): void => {
    sessionBookIdRef.current = null;
  }, []);

  const handleOpenModal = useCallback(async () => {
    const [nc, gd, icloudPref] = await Promise.all([
      isNextcloudAuthenticated(),
      isGDriveAuthenticated(),
      AsyncStorage.getItem(ICLOUD_ENABLED_KEY),
    ]);
    setHasNextcloud(nc);
    setHasGDrive(gd);
    setHasICloud(isICloudAvailable() && icloudPref === 'true');
    startOrReuseSession();
    setModalVisible(true);
  }, [startOrReuseSession]);

  /** Handle a file delivered via iOS "Open with" or the simulator drag-and-drop.
   *  Copies the file to the local cache, opens AddBookModal, and pre-populates
   *  the matching slot so the user only needs to supply the other file. */
  const handleIncomingFile = useCallback(
    async (incoming: { uri: string; name: string; kind: 'audio' | 'epub' }) => {
      if (!user) return;
      const now = Date.now();
      const last = processedIncomingRef.current;
      if (last && last.uri === incoming.uri && now - last.ts < 10_000) {
        logger.info('[incoming] dedupe hit, skipping', { uri: incoming.uri });
        return;
      }
      processedIncomingRef.current = { uri: incoming.uri, ts: now };

      const bookId = startOrReuseSession();
      logger.info('[incoming] begin', { bookId, incoming });
      const [nc, gd, icloudPref] = await Promise.all([
        isNextcloudAuthenticated(),
        isGDriveAuthenticated(),
        AsyncStorage.getItem(ICLOUD_ENABLED_KEY),
      ]);
      setHasNextcloud(nc);
      setHasGDrive(gd);
      setHasICloud(isICloudAvailable() && icloudPref === 'true');
      try {
        // Normalise the extension to lowercase so it matches the canonical
        // path the reader rebuilds via getCachedPath(bookId, 'epub', 'epub').
        const rawExt = incoming.name.split('.').pop();
        const ext = (rawExt || (incoming.kind === 'audio' ? 'm4b' : 'epub')).toLowerCase();
        const fileType = incoming.kind === 'audio' ? 'audio' : 'epub';
        const cachedUri = await cacheFile(incoming.uri, bookId, fileType, ext);
        logger.info('[incoming] cached', { bookId, fileType, ext, cachedUri });
        setPreselectedIncoming({ kind: incoming.kind, uri: cachedUri, name: incoming.name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[incoming] cacheFile failed', err);
        Alert.alert('Import Error', `Could not read the incoming file.\n\n${msg}`);
      }
      setModalVisible(true);
    },
    [user, startOrReuseSession],
  );

  // ── openAdd route-param signal ─────────────────────────────────────────────
  const openAddSignal = route.params?.openAdd;
  useEffect(() => {
    if (!openAddSignal) return;
    handleOpenModal();
    navigation.setParams({ openAdd: undefined });
  }, [openAddSignal, handleOpenModal, navigation]);

  // ── pendingImportStore: single source of truth ────────────────────────────
  // App.tsx's Linking listener funnels every incoming file into the store.
  // We subscribe for live deliveries (warm-start while the screen is already
  // mounted) and also drain any file queued before subscription (cold-start
  // or post-login mount) from the store on each focus.
  useEffect(() => {
    const unsubStore = subscribeToPendingImport((file) => {
      // Clear the store-held copy so the focus-drain below doesn't re-fire it.
      takePendingImport();
      handleIncomingFile(file);
    });
    const unsubFocus = navigation.addListener('focus', () => {
      const pending = takePendingImport();
      if (pending) handleIncomingFile(pending);
    });
    return () => {
      unsubStore();
      unsubFocus();
    };
  }, [navigation, handleIncomingFile]);

  // Refetch books on focus (deletions in BookDetail should be reflected here).
  useEffect(() => {
    const unsub = navigation.addListener('focus', refreshBooks);
    return unsub;
  }, [navigation, refreshBooks]);

  const handlePickEpub = useCallback(async () => {
    if (!user) return null;
    const result = await pickEpub(startOrReuseSession());
    if (!result) return null;
    return { name: result.name, uri: result.uri };
  }, [user, pickEpub, startOrReuseSession]);

  const handlePickAudio = useCallback(async () => {
    if (!user) return null;
    const result = await pickAudio(startOrReuseSession());
    if (!result) return null;
    return { name: result.name, uri: result.uri };
  }, [user, pickAudio, startOrReuseSession]);

  const handleConfirm = useCallback(
    async (epub: { name: string; uri: string }, audio: { name: string; uri: string }) => {
      if (!user) return;
      setAdding(true);
      try {
        const bookId = sessionBookIdRef.current ?? pendingBookId;
        logger.info('[confirm] saving book', {
          bookId,
          expectedEpub: buildCachePath(bookId, 'epub', 'epub'),
          epubUri: epub.uri,
          audioUri: audio.uri,
        });
        const title = epub.name.replace(/\.epub$/i, '') || 'Untitled Book';
        const totalDurationSeconds = await probeAudioDuration(audio.uri);
        if (totalDurationSeconds <= 0) {
          Alert.alert(
            "Couldn't read audio duration",
            "Reader↔audio sync may be inaccurate for this book until the file is replaced.",
          );
        }
        const now = Date.now();
        const bookData = {
          title,
          author: '',
          coverUrl: '',
          epubPath: epub.uri,
          audioPath: audio.uri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds,
          syncMode: 'chapter' as const,
          addedAt: now,
          updatedAt: now,
        };
        await localWriteBook(user.uid, bookId, bookData);
        endSession();
        setPreselectedIncoming(null);
        setModalVisible(false);
        navigation.navigate('BookDetail', { bookId });
        writeBook(user.uid, bookId, bookData).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert('Error', `Failed to add book: ${msg}`);
      } finally {
        setAdding(false);
      }
    },
    [user, pendingBookId, navigation, endSession],
  );

  const handleImportNextcloud = useCallback(async () => {
    if (!user) return;
    setAdding(true);
    try {
      const folders = await listNextcloudBooks();
      if (folders.length === 0) {
        Alert.alert(
          'No Books Found',
          'No folders in your Nextcloud "Books" folder.\n\nCreate one folder per book with an .epub and audio file.',
        );
        setAdding(false);
        return;
      }
      const buttons = folders.map((folder) => ({
        text: folder.name,
        onPress: () => importNextcloudFolder(folder),
      }));
      buttons.push({ text: 'Cancel', onPress: () => setAdding(false) } as never);
      Alert.alert('Select a Book Folder', 'Choose a folder to import:', buttons);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Nextcloud Error', msg);
      setAdding(false);
    }
  }, [user]);

  const importNextcloudFolder = useCallback(
    async (folder: NextcloudEntry) => {
      if (!user) return;
      try {
        const files = await listNextcloudBookFiles(folder.path);
        const epub = files.find((f) => f.name.toLowerCase().endsWith('.epub'));
        const audio = files.find((f) => /\.(m4b|mp3|m4a|aac|ogg|flac)$/i.test(f.name));
        if (!epub || !audio) {
          Alert.alert('Incomplete Folder', `"${folder.name}" needs both an .epub and an audio file.`);
          setAdding(false);
          return;
        }
        const bookId = Crypto.randomUUID();
        const ext = audio.name.split('.').pop() ?? 'm4b';
        await ensureCacheDir();
        const epubUri = buildCachePath(bookId, 'epub', 'epub');
        const audioUri = buildCachePath(bookId, 'audio', ext);
        await downloadNextcloudFile(epub.path, epubUri);
        await downloadNextcloudFile(audio.path, audioUri);
        const totalDurationSeconds = await probeAudioDuration(audioUri);
        if (totalDurationSeconds <= 0) {
          Alert.alert(
            "Couldn't read audio duration",
            "Reader↔audio sync may be inaccurate for this book until the file is replaced.",
          );
        }
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds,
          syncMode: 'chapter' as const,
          addedAt: now,
          updatedAt: now,
        };
        await localWriteBook(user.uid, bookId, bookData);
        writeBook(user.uid, bookId, bookData).catch(() => {});
        navigation.navigate('BookDetail', { bookId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert('Import Failed', msg);
      } finally {
        setAdding(false);
      }
    },
    [user, navigation],
  );

  const handleImportGDrive = useCallback(async () => {
    if (!user) return;
    setAdding(true);
    try {
      const folders = await listGDriveBooks();
      if (folders.length === 0) {
        Alert.alert(
          'No Books Found',
          'No folders in your Google Drive "Books" folder.\n\nCreate one folder per book with an .epub and audio file.',
        );
        setAdding(false);
        return;
      }
      const buttons = folders.map((folder) => ({
        text: folder.name,
        onPress: () => importGDriveFolder(folder),
      }));
      buttons.push({ text: 'Cancel', onPress: () => setAdding(false) } as never);
      Alert.alert('Select a Book Folder', 'Choose a folder to import:', buttons);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Google Drive Error', msg);
      setAdding(false);
    }
  }, [user]);

  const importGDriveFolder = useCallback(
    async (folder: DriveEntry) => {
      if (!user) return;
      try {
        const files = await listGDriveBookFiles(folder.id);
        const epub = files.find((f) => f.name.toLowerCase().endsWith('.epub'));
        const audio = files.find((f) => /\.(m4b|mp3|m4a|aac|ogg|flac)$/i.test(f.name));
        if (!epub || !audio) {
          Alert.alert('Incomplete Folder', `"${folder.name}" needs both an .epub and an audio file.`);
          setAdding(false);
          return;
        }
        const bookId = Crypto.randomUUID();
        const ext = audio.name.split('.').pop() ?? 'm4b';
        await ensureCacheDir();
        const epubUri = buildCachePath(bookId, 'epub', 'epub');
        const audioUri = buildCachePath(bookId, 'audio', ext);
        await downloadGDriveFile(epub.id, epubUri);
        await downloadGDriveFile(audio.id, audioUri);
        const totalDurationSeconds = await probeAudioDuration(audioUri);
        if (totalDurationSeconds <= 0) {
          Alert.alert(
            "Couldn't read audio duration",
            "Reader↔audio sync may be inaccurate for this book until the file is replaced.",
          );
        }
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds,
          syncMode: 'chapter' as const,
          addedAt: now,
          updatedAt: now,
        };
        await localWriteBook(user.uid, bookId, bookData);
        writeBook(user.uid, bookId, bookData).catch(() => {});
        navigation.navigate('BookDetail', { bookId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert('Import Failed', msg);
      } finally {
        setAdding(false);
      }
    },
    [user, navigation],
  );

  const handleImportICloud = useCallback(async () => {
    if (!user) return;
    setAdding(true);
    try {
      const folders = listICloudBooks();
      if (folders.length === 0) {
        Alert.alert(
          'No Books Found',
          'No folders found in iCloud Drive / Books.\n\nCreate one folder per book with an .epub and audio file.',
        );
        setAdding(false);
        return;
      }
      const buttons = folders.map((folder) => ({
        text: folder.name,
        onPress: () => importICloudFolder(folder),
      }));
      buttons.push({ text: 'Cancel', onPress: () => setAdding(false) } as never);
      Alert.alert('Select a Book Folder', 'Choose a folder to import:', buttons);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('iCloud Error', msg);
      setAdding(false);
    }
  }, [user]);

  const importICloudFolder = useCallback(
    async (folder: ICloudEntry) => {
      if (!user) return;
      try {
        const files = listICloudBookFiles(folder.uri);
        const epub = files.find((f) => f.name.toLowerCase().endsWith('.epub'));
        const audio = files.find((f) => /\.(m4b|mp3|m4a|aac|ogg|flac)$/i.test(f.name));
        if (!epub || !audio) {
          Alert.alert('Incomplete Folder', `"${folder.name}" needs both an .epub and an audio file.`);
          setAdding(false);
          return;
        }
        const bookId = Crypto.randomUUID();
        const ext = audio.name.split('.').pop() ?? 'm4b';
        await ensureCacheDir();
        const epubUri = buildCachePath(bookId, 'epub', 'epub');
        const audioUri = buildCachePath(bookId, 'audio', ext);
        copyFromICloud(epub.uri, epubUri);
        copyFromICloud(audio.uri, audioUri);
        const totalDurationSeconds = await probeAudioDuration(audioUri);
        if (totalDurationSeconds <= 0) {
          Alert.alert(
            "Couldn't read audio duration",
            "Reader↔audio sync may be inaccurate for this book until the file is replaced.",
          );
        }
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds,
          syncMode: 'chapter' as const,
          addedAt: now,
          updatedAt: now,
        };
        await localWriteBook(user.uid, bookId, bookData);
        writeBook(user.uid, bookId, bookData).catch(() => {});
        navigation.navigate('BookDetail', { bookId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert('Import Failed', msg);
      } finally {
        setAdding(false);
      }
    },
    [user, navigation],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleDeleteBook = useCallback(
    (book: LocalBook) => {
      Alert.alert('Remove Book', `Remove "${getBookDisplay(book).title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            await removeBook(book.id);
            deleteBook(user.uid, book.id).catch(() => {});
          },
        },
      ]);
    },
    [user, removeBook],
  );

  // Choose the hero book: prefer the now-playing one, else the most recently
  // updated. The rest populate the shelves below.
  const { heroBook, shelfBooks } = useMemo(() => {
    if (books.length === 0) return { heroBook: null, shelfBooks: [] as LocalBook[] };
    const sorted = [...books].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const preferred =
      (nowPlayingBook && sorted.find((b) => b.id === nowPlayingBook.id)) ?? sorted[0];
    return {
      heroBook: preferred,
      shelfBooks: sorted.filter((b) => b.id !== preferred.id),
    };
  }, [books, nowPlayingBook]);

  const rows = useMemo(() => chunk(shelfBooks, COLS), [shelfBooks]);

  const handleOpenBook = useCallback(
    (b: LocalBook) => navigation.navigate('BookDetail', { bookId: b.id }),
    [navigation],
  );

  const renderRow = useCallback(
    ({ item, index }: { item: LocalBook[]; index: number }) => (
      <ShelfRow
        row={item}
        index={index}
        userId={user?.uid ?? null}
        onOpen={handleOpenBook}
        onDelete={handleDeleteBook}
      />
    ),
    [handleOpenBook, handleDeleteBook, user?.uid],
  );

  const renderHeader = () => {
    if (loading && books.length === 0) {
      return (
        <View>
          <Header bookCount={0} hours={0} onAdd={handleOpenModal} />
          <View style={styles.divider} />
          <SkeletonShelf />
        </View>
      );
    }

    if (!loading && books.length === 0) {
      return (
        <View>
          <Header bookCount={0} hours={0} onAdd={handleOpenModal} />
          <View style={styles.divider} />
          <EmptyShelf onAdd={handleOpenModal} />
        </View>
      );
    }

    return (
      <View>
        <Header bookCount={books.length} hours={totalHours(books)} onAdd={handleOpenModal} />
        <View style={styles.divider} />
        {heroBook ? (
          <>
            <CurrentlyReading book={heroBook} onOpen={() => handleOpenBook(heroBook)} />
            {shelfBooks.length > 0 ? (
              <Text style={[styles.sectionEyebrow, styles.shelvesEyebrow]}>
                THE SHELF
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(_, i) => `row-${i}`}
        renderItem={renderRow}
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={ShelfLine}
        ListFooterComponent={rows.length > 0 ? <ShelfLine /> : null}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 48 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={VoidColors.pureWhite}
            colors={[VoidColors.pureWhite]}
            progressBackgroundColor={VoidColors.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <AddBookModal
        visible={modalVisible}
        onClose={() => {
          // If the session still has a bookId here, the user dismissed
          // without saving — any files cached under that id (an incoming
          // "Open with" file or picker selections) are orphans. Clean
          // them up before the ref clears.
          const orphanBookId = sessionBookIdRef.current;
          setModalVisible(false);
          setPreselectedIncoming(null);
          endSession();
          if (orphanBookId) {
            deleteCacheFilesForBookId(orphanBookId).catch((err) =>
              logger.warn('orphan cleanup on dismiss failed', err),
            );
          }
        }}
        onPickEpub={handlePickEpub}
        onPickAudio={handlePickAudio}
        onConfirm={handleConfirm}
        recentBooks={books}
        hasNextcloud={hasNextcloud}
        onImportNextcloud={handleImportNextcloud}
        hasGoogleDrive={hasGDrive}
        onImportGoogleDrive={handleImportGDrive}
        hasICloud={hasICloud}
        onImportICloud={handleImportICloud}
        initialSelection={preselectedIncoming}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: VoidColors.void },
  list: { paddingHorizontal: H_PAD },

  // Header
  headerWrap: { paddingTop: 8, paddingBottom: 22 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 28,
  },
  wordmarkWrap: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: {
    width: 4,
    height: 4,
    backgroundColor: VoidColors.luminousGreen,
    marginRight: 10,
  },
  wordmark: {
    fontSize: 10.5,
    fontWeight: VoidWeight.bold,
    color: VoidColors.pureWhite,
    letterSpacing: 3.8,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: VoidColors.pureWhite,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  addBtnGlyph: {
    color: VoidColors.pureWhite,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '300',
    marginTop: -1,
  },
  displayTitle: {
    fontFamily: VoidFonts.display,
    fontWeight: VoidWeight.black,
    fontSize: 78,
    lineHeight: 92,
    color: VoidColors.pureWhite,
    letterSpacing: -2.5,
  },
  displayMeta: {
    marginTop: 10,
    fontSize: 12.5,
    color: VoidColors.mutedAsh,
    letterSpacing: 0.6,
    fontWeight: VoidWeight.medium,
  },

  divider: {
    height: 1,
    backgroundColor: VoidColors.ghostlyDim,
    marginTop: 4,
    marginBottom: 28,
  },

  sectionEyebrow: {
    fontSize: 10.5,
    fontWeight: VoidWeight.bold,
    color: VoidColors.pureWhite,
    letterSpacing: 2.8,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  shelvesEyebrow: {
    marginTop: 34,
    marginBottom: 18,
  },

  // Currently Reading hero
  heroWrap: { marginBottom: 24 },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroCoverShadow: {
    width: 118,
    height: 177,
    marginRight: 22,
    shadowOpacity: 0,
  },
  heroCover: {
    width: 118,
    height: 177,
    borderRadius: VoidRadius.card,
    backgroundColor: VoidColors.surface,
  },
  heroAccentStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: VoidRadius.card,
    borderBottomLeftRadius: VoidRadius.card,
  },
  heroMeta: { flex: 1, paddingTop: 4 },
  heroTitle: {
    fontFamily: VoidFonts.display,
    fontWeight: VoidWeight.extrabold,
    fontSize: 28,
    lineHeight: 30,
    color: VoidColors.pureWhite,
    letterSpacing: -0.5,
  },
  heroAuthor: {
    marginTop: 6,
    fontSize: 13.5,
    color: VoidColors.mutedAsh,
    letterSpacing: 0.2,
  },
  heroDivider: {
    marginTop: 14,
    marginBottom: 12,
    height: 1,
    backgroundColor: VoidColors.ghostlyDim,
    width: 40,
  },
  heroStats: { flexDirection: 'row', alignItems: 'center' },
  heroStat: {
    fontSize: 12,
    color: VoidColors.mutedAsh,
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  heroStatDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: VoidColors.inkFaint,
    marginHorizontal: 9,
  },
  heroCta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: VoidColors.pureWhite,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: VoidRadius.pill,
  },
  heroPlayDot: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: VoidColors.void,
    marginRight: 8,
  },
  heroCtaText: {
    color: VoidColors.void,
    fontSize: 13,
    fontWeight: VoidWeight.extrabold,
    letterSpacing: 0.8,
  },

  // Shelves
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingBottom: 18,
  },
  shelfBookSlot: {
    width: COVER_W,
    marginRight: COL_GAP,
  },
  coverShadowWrap: {
    width: COVER_W,
    height: COVER_H,
    shadowOpacity: 0,
    elevation: 0,
    marginBottom: 12,
  },
  cover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: VoidRadius.card,
    backgroundColor: VoidColors.surface,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    fontFamily: VoidFonts.display,
    fontWeight: VoidWeight.black,
    fontSize: 44,
    color: VoidColors.void,
  },
  coverAccentStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: VoidRadius.card,
    borderBottomLeftRadius: VoidRadius.card,
  },
  cloudDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: VoidColors.luminousGreen,
    opacity: 0.85,
  },
  shelfTitle: {
    fontSize: 12,
    color: VoidColors.pureWhite,
    fontWeight: VoidWeight.bold,
    lineHeight: 15,
    letterSpacing: 0.1,
  },
  shelfAuthor: {
    marginTop: 3,
    fontSize: 10.5,
    color: VoidColors.mutedAsh,
    letterSpacing: 0.3,
  },

  // Shelf line
  shelfWrap: {
    paddingTop: 2,
    marginBottom: 26,
  },
  shelfLine: {
    height: 1,
    backgroundColor: VoidColors.ghostlyDim,
  },

  // Skeleton
  skeletonCover: {
    backgroundColor: VoidColors.surface,
  },

  // Empty
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 8,
  },
  emptyMoe: {
    width: 220,
    height: 220,
    marginBottom: 28,
  },
  emptyHeading: {
    fontFamily: VoidFonts.display,
    fontWeight: VoidWeight.black,
    fontSize: 39,
    lineHeight: 35,
    letterSpacing: -0.78,
    color: VoidColors.pureWhite,
    textAlign: 'center',
  },
  emptyBody: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: VoidColors.mutedAsh,
    textAlign: 'center',
    maxWidth: 280,
  },
  emptyBtn: {
    marginTop: 28,
    backgroundColor: VoidColors.pureWhite,
    borderRadius: VoidRadius.pill,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  emptyBtnText: {
    color: VoidColors.void,
    fontSize: 13,
    fontWeight: VoidWeight.extrabold,
    letterSpacing: 0.8,
  },

  // Errors
  errorBanner: {
    backgroundColor: VoidColors.void,
    padding: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: VoidColors.vividCrimson,
    borderBottomColor: VoidColors.vividCrimson,
  },
  errorText: { color: VoidColors.vividCrimson, fontSize: 13, textAlign: 'center' },
});
