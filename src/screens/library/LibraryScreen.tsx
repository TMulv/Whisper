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
  Platform,
  Dimensions,
  Easing,
} from 'react-native';
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
import { buildCachePath, ensureCacheDir } from '@/services/storage/localStorageService';
import { formatDuration } from '@/utils/timeUtils';

const ICLOUD_ENABLED_KEY = '@whisper/icloud_enabled';

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'LibraryHome'>;
type LibraryHomeRoute = RouteProp<LibraryStackParamList, 'LibraryHome'>;

// ── Aesthetic tokens ──────────────────────────────────────────────────────────
// A warm, paper-in-lamplight dark palette. Generous whitespace carries the design;
// accents are restrained to thin gold hairlines and a single cream "ink" tone.

const C = {
  bg: '#09090F',
  bgWarm: '#0D0B0E',
  surface: '#14131A',
  shelf: '#2A241C',        // warm shelf hairline
  shelfGlow: 'rgba(201,169,110,0.14)',
  gold: '#C9A96E',
  goldSoft: '#B09666',
  goldDim: '#6A5832',
  ink: '#F2E8D5',          // primary cream text
  inkMuted: '#9A8E7D',
  inkFaint: '#4A4238',
  shadow: '#000',
  error: '#E85555',
};

// Platform-aware editorial serif. Apple ships "New York" — a literary display face
// designed for book-like UI. We fall back to Georgia elsewhere.
const SERIF = Platform.select({ ios: 'New York', android: 'serif', default: 'Georgia' });
const SERIF_ITALIC = Platform.select({ ios: 'New York Italic', android: 'serif', default: 'Georgia' });

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
// The defining visual: a thin gold line each row of books "stands" on.
// A soft glow beneath sells the illusion of weight without any wood texture.

function ShelfLine({ inset = 0 }: { inset?: number }) {
  return (
    <View style={[styles.shelfWrap, { marginHorizontal: inset }]}>
      <View style={styles.shelfLine} />
      <View style={styles.shelfGlow} />
    </View>
  );
}

// ── Single book on the shelf ──────────────────────────────────────────────────

function ShelfBook({
  book,
  onPress,
  onLongPress,
}: {
  book: LocalBook;
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
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverInitial}>
              {book.title[0]?.toUpperCase() ?? '?'}
            </Text>
            <View style={styles.coverRule} />
            <Text style={styles.coverMark}>WHISPER</Text>
          </View>
        )}
        {/* Thin spine highlight down the left edge — pure CSS depth */}
        <View pointerEvents="none" style={styles.coverSpine} />
        {/* Gloss/vignette */}
        <View pointerEvents="none" style={styles.coverGloss} />
        {!book.isDownloaded && <View style={styles.cloudDot} />}
      </Animated.View>

      <Text numberOfLines={2} style={styles.shelfTitle}>
        {book.title}
      </Text>
      {book.author ? (
        <Text numberOfLines={1} style={styles.shelfAuthor}>
          {book.author}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── A row of up to COLS books, animated into place ────────────────────────────

function ShelfRow({
  row,
  index,
  onOpen,
  onDelete,
}: {
  row: LocalBook[];
  index: number;
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

  return (
    <Animated.View
      style={[styles.heroWrap, { opacity: anim, transform: [{ translateY }] }]}
    >
      <Text style={styles.sectionEyebrow}>Currently Reading</Text>

      <Pressable onPress={onOpen} style={styles.heroCard}>
        <View style={styles.heroCoverShadow}>
          {book.coverUri ? (
            <Image source={{ uri: book.coverUri }} style={styles.heroCover} resizeMode="cover" />
          ) : (
            <View style={[styles.heroCover, styles.coverPlaceholder]}>
              <Text style={styles.coverInitial}>
                {book.title[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <View pointerEvents="none" style={styles.heroSpine} />
          <View pointerEvents="none" style={styles.heroGloss} />
        </View>

        <View style={styles.heroMeta}>
          <Text style={styles.heroTitle} numberOfLines={3}>
            {book.title}
          </Text>
          {book.author ? (
            <Text style={styles.heroAuthor} numberOfLines={1}>
              {book.author}
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
      {/* A single empty shelf — even emptiness honors the concept */}
      <View style={styles.emptyShelfFrame}>
        <View style={styles.emptyGap} />
        <ShelfLine />
      </View>

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
          <Text style={styles.wordmark}>WHISPER</Text>
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

      <Text style={styles.displayTitle}>Library</Text>
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
  const insets = useSafeAreaInsets();

  const handleOpenModal = useCallback(async () => {
    const [nc, gd, icloudPref] = await Promise.all([
      isNextcloudAuthenticated(),
      isGDriveAuthenticated(),
      AsyncStorage.getItem(ICLOUD_ENABLED_KEY),
    ]);
    setHasNextcloud(nc);
    setHasGDrive(gd);
    setHasICloud(isICloudAvailable() && icloudPref === 'true');
    setPendingBookId(Crypto.randomUUID());
    setModalVisible(true);
  }, []);

  const openAddSignal = route.params?.openAdd;
  useEffect(() => {
    if (!openAddSignal) return;
    handleOpenModal();
    navigation.setParams({ openAdd: undefined });
  }, [openAddSignal, handleOpenModal, navigation]);

  // Refetch books when the library comes back into focus so deletions
  // performed in BookDetail or elsewhere are reflected here.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      refreshBooks();
    });
    return unsub;
  }, [navigation, refreshBooks]);

  const handlePickEpub = useCallback(async () => {
    if (!user) return null;
    const result = await pickEpub(pendingBookId);
    if (!result) return null;
    return { name: result.name, uri: result.uri };
  }, [user, pendingBookId, pickEpub]);

  const handlePickAudio = useCallback(async () => {
    if (!user) return null;
    const result = await pickAudio(pendingBookId);
    if (!result) return null;
    return { name: result.name, uri: result.uri };
  }, [user, pendingBookId, pickAudio]);

  const handleConfirm = useCallback(
    async (epub: { name: string; uri: string }, audio: { name: string; uri: string }) => {
      if (!user) return;
      setAdding(true);
      try {
        const bookId = pendingBookId;
        const title = epub.name.replace(/\.epub$/i, '') || 'Untitled Book';
        const now = Date.now();
        const bookData = {
          title,
          author: '',
          coverUrl: '',
          epubPath: epub.uri,
          audioPath: audio.uri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds: 0,
          syncMode: 'chapter' as const,
          addedAt: now,
          updatedAt: now,
        };
        await localWriteBook(user.uid, bookId, bookData);
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
    [user, pendingBookId, navigation],
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
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds: 0,
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
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds: 0,
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
        const now = Date.now();
        const bookData = {
          title: folder.name,
          author: '',
          coverUrl: '',
          epubPath: epubUri,
          audioPath: audioUri,
          syncMapPath: null,
          totalChapters: 1,
          totalDurationSeconds: 0,
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
      Alert.alert('Remove Book', `Remove "${book.title}"?`, [
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
      <ShelfRow row={item} index={index} onOpen={handleOpenBook} onDelete={handleDeleteBook} />
    ),
    [handleOpenBook, handleDeleteBook],
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
                The Shelf
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
            tintColor={C.gold}
            colors={[C.gold]}
            progressBackgroundColor={C.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <AddBookModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
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
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
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
    width: 5,
    height: 5,
    backgroundColor: C.gold,
    marginRight: 10,
    transform: [{ rotate: '45deg' }],
  },
  wordmark: {
    fontSize: 10.5,
    fontWeight: '700',
    color: C.gold,
    letterSpacing: 3.8,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bgWarm,
  },
  addBtnGlyph: {
    color: C.gold,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '300',
    marginTop: -1,
  },
  displayTitle: {
    fontFamily: SERIF_ITALIC,
    fontStyle: 'italic',
    fontSize: 48,
    lineHeight: 52,
    color: C.ink,
    letterSpacing: -1.2,
  },
  displayMeta: {
    marginTop: 10,
    fontSize: 12.5,
    color: C.inkMuted,
    letterSpacing: 0.6,
    fontWeight: '500',
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.shelf,
    marginTop: 4,
    marginBottom: 28,
  },

  sectionEyebrow: {
    fontSize: 10.5,
    fontWeight: '700',
    color: C.gold,
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
    shadowColor: C.shadow,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  heroCover: {
    width: 118,
    height: 177,
    borderRadius: 3,
    backgroundColor: C.surface,
  },
  heroSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  heroGloss: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 12,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  heroMeta: { flex: 1, paddingTop: 4 },
  heroTitle: {
    fontFamily: SERIF,
    fontSize: 22,
    lineHeight: 27,
    color: C.ink,
    letterSpacing: -0.3,
    fontWeight: '500',
  },
  heroAuthor: {
    marginTop: 6,
    fontSize: 13.5,
    color: C.inkMuted,
    letterSpacing: 0.2,
  },
  heroDivider: {
    marginTop: 14,
    marginBottom: 12,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.shelf,
    width: 40,
  },
  heroStats: { flexDirection: 'row', alignItems: 'center' },
  heroStat: {
    fontSize: 12,
    color: C.inkMuted,
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  heroStatDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: C.inkFaint,
    marginHorizontal: 9,
  },
  heroCta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: C.gold,
    paddingLeft: 12,
    paddingRight: 16,
    paddingVertical: 9,
    borderRadius: 22,
  },
  heroPlayDot: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: C.bg,
    marginRight: 8,
  },
  heroCtaText: {
    color: C.bg,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
    shadowColor: C.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    marginBottom: 12,
  },
  cover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 2.5,
    backgroundColor: C.surface,
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.goldDim,
  },
  coverInitial: {
    fontFamily: SERIF_ITALIC,
    fontStyle: 'italic',
    fontSize: 44,
    color: C.gold,
  },
  coverRule: {
    width: 24,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.goldDim,
    marginVertical: 10,
  },
  coverMark: {
    fontSize: 8,
    color: C.goldDim,
    letterSpacing: 2.4,
    fontWeight: '700',
  },
  coverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 2.5,
    borderBottomLeftRadius: 2.5,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  coverGloss: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 8,
    borderTopRightRadius: 2.5,
    borderBottomRightRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  cloudDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.gold,
    opacity: 0.85,
  },
  shelfTitle: {
    fontSize: 11.5,
    color: C.ink,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 0.1,
  },
  shelfAuthor: {
    marginTop: 3,
    fontSize: 10.5,
    color: C.inkMuted,
    letterSpacing: 0.3,
  },

  // Shelf line
  shelfWrap: {
    paddingTop: 2,
    marginBottom: 26,
  },
  shelfLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.shelf,
  },
  shelfGlow: {
    height: 1,
    marginTop: 1,
    backgroundColor: C.shelfGlow,
    opacity: 0.5,
  },

  // Skeleton
  skeletonCover: {
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.shelf,
  },

  // Empty
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 8,
  },
  emptyShelfFrame: {
    width: '100%',
    marginBottom: 40,
  },
  emptyGap: {
    height: COVER_H * 0.75,
  },
  emptyBtn: {
    marginTop: 32,
    backgroundColor: C.gold,
    borderRadius: 24,
    paddingVertical: 13,
    paddingHorizontal: 30,
  },
  emptyBtnText: {
    color: C.bg,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Errors
  errorBanner: {
    backgroundColor: '#1A0505',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#4A1010',
  },
  errorText: { color: C.error, fontSize: 13, textAlign: 'center' },
});
