import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { useBooks } from '@/hooks/useBook';
import { useFileStorage } from '@/hooks/useFileStorage';
import BookCard from '@/components/common/BookCard';
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
import { Paths } from 'expo-file-system';

const ICLOUD_ENABLED_KEY = '@whisper/icloud_enabled';

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'LibraryHome'>;
type LibraryHomeRoute = RouteProp<LibraryStackParamList, 'LibraryHome'>;

const C = {
  bg: '#09090F',
  surface: '#0F0F1A',
  border: '#1C1C2E',
  gold: '#C9A96E',
  goldDim: '#6A5832',
  text: '#F0E6D4',
  textMuted: '#7A6E62',
  textFaint: '#3A3530',
  error: '#E85555',
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  const pulse = React.useRef(new Animated.Value(0.4)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity: pulse }]}>
      <View style={styles.skeletonCover} />
      <View style={styles.skeletonMeta}>
        <View style={[styles.skeletonLine, { width: '75%' }]} />
        <View style={[styles.skeletonLine, { width: '45%', marginTop: 8 }]} />
        <View style={styles.skeletonPills}>
          <View style={styles.skeletonPill} />
          <View style={styles.skeletonPill} />
        </View>
      </View>
    </Animated.View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyLibrary({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrap}>
        <Text style={styles.emptyIcon}>⊕</Text>
      </View>
      <Text style={styles.emptyTitle}>Your library is empty</Text>
      <Text style={styles.emptySub}>
        Pair an audiobook with its ebook to start reading and listening in sync.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onAdd} activeOpacity={0.8}>
        <Text style={styles.emptyBtnText}>Pair your first book</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Library header ────────────────────────────────────────────────────────────

function LibraryHeader({ bookCount, onAdd }: { bookCount: number; onAdd: () => void }) {
  return (
    <View style={styles.listHeader}>
      <View>
        <Text style={styles.libraryLabel}>LIBRARY</Text>
        <Text style={styles.bookCountText}>
          {bookCount === 0
            ? 'No books yet'
            : `${bookCount} book${bookCount !== 1 ? 's' : ''} paired`}
        </Text>
      </View>
      <TouchableOpacity style={styles.addBtn} onPress={onAdd} activeOpacity={0.8}>
        <Text style={styles.addBtnIcon}>+</Text>
        <Text style={styles.addBtnText}>Pair</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavProp>();
  const route = useRoute<LibraryHomeRoute>();
  const { books, loading, error, removeBook } = useBooks(user?.uid ?? null);
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
    setPendingBookId(Crypto.randomUUID()); // fresh ID each time modal opens
    setModalVisible(true);
  }, []);

  // Open the pair/import modal when the bottom "+" tab is tapped.
  // The Add tab sets route.params.openAdd to a fresh timestamp, so re-tapping
  // always re-fires even if the screen is already focused.
  const openAddSignal = route.params?.openAdd;
  useEffect(() => {
    if (!openAddSignal) return;
    handleOpenModal();
    navigation.setParams({ openAdd: undefined });
  }, [openAddSignal, handleOpenModal, navigation]);

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
        // Write locally first so the app never blocks on network
        await localWriteBook(user.uid, bookId, bookData);
        setModalVisible(false);
        navigation.navigate('BookDetail', { bookId });
        // Sync to Firestore in the background
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
        const epubUri = `${Paths.cache}whisper/${bookId}_epub.epub`;
        const audioUri = `${Paths.cache}whisper/${bookId}_audio.${ext}`;
        await downloadNextcloudFile(epub.path, epubUri);
        await downloadNextcloudFile(audio.path, audioUri);
        const now = Date.now();
        await writeBook(user.uid, bookId, {
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
        });
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

  // ── Google Drive import ────────────────────────────────────────────────────

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
        const epubUri = `${Paths.cache}whisper/${bookId}_epub.epub`;
        const audioUri = `${Paths.cache}whisper/${bookId}_audio.${ext}`;
        await downloadGDriveFile(epub.id, epubUri);
        await downloadGDriveFile(audio.id, audioUri);
        const now = Date.now();
        await writeBook(user.uid, bookId, {
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
        });
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

  // ── iCloud import ──────────────────────────────────────────────────────────

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
        const epubUri = `${Paths.cache}whisper/${bookId}_epub.epub`;
        const audioUri = `${Paths.cache}whisper/${bookId}_audio.${ext}`;
        copyFromICloud(epub.uri, epubUri);
        copyFromICloud(audio.uri, audioUri);
        const now = Date.now();
        await writeBook(user.uid, bookId, {
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
        });
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

  const renderBook = useCallback(
    ({ item }: { item: LocalBook }) => (
      <BookCard
        book={item}
        onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
        onLongPress={() => handleDeleteBook(item)}
      />
    ),
    [navigation, handleDeleteBook],
  );

  const renderEmpty = () => {
    if (loading) return null;
    return <EmptyLibrary onAdd={handleOpenModal} />;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* App title bar */}
      <View style={styles.titleBar}>
        <Text style={styles.appName}>WHISPER</Text>
        <View style={styles.titleDot} />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={loading ? [] : books}
        keyExtractor={(item) => item.id}
        renderItem={renderBook}
        ListEmptyComponent={renderEmpty}
        ListHeaderComponent={
          loading ? (
            <View style={{ paddingTop: 8 }}>
              <LibraryHeader bookCount={0} onAdd={handleOpenModal} />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : (
            <LibraryHeader bookCount={books.length} onAdd={handleOpenModal} />
          )
        }
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.gold}
            colors={[C.gold]}
          />
        }
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  list: { paddingTop: 0, paddingHorizontal: 16 },

  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  appName: {
    fontSize: 13,
    fontWeight: '700',
    color: C.gold,
    letterSpacing: 3.5,
  },
  titleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.gold,
    marginLeft: 10,
    opacity: 0.5,
  },

  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  libraryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textFaint,
    letterSpacing: 2.5,
    marginBottom: 4,
  },
  bookCountText: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    letterSpacing: -0.2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.goldDim,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  addBtnIcon: { color: C.gold, fontSize: 18, lineHeight: 20, marginRight: 4, fontWeight: '300' },
  addBtnText: { color: C.gold, fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },

  skeletonCard: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 14,
    marginVertical: 5,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  skeletonCover: {
    width: 60,
    height: 84,
    borderRadius: 8,
    backgroundColor: C.border,
    marginRight: 14,
  },
  skeletonMeta: { flex: 1, paddingTop: 4 },
  skeletonLine: { height: 13, borderRadius: 6, backgroundColor: C.border },
  skeletonPills: { flexDirection: 'row', marginTop: 14 },
  skeletonPill: {
    width: 48,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.border,
    marginRight: 8,
  },

  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: C.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyIcon: { fontSize: 30, color: C.gold },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: C.text,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  emptySub: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  emptyBtn: {
    backgroundColor: C.gold,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  emptyBtnText: { color: C.bg, fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  errorBanner: {
    backgroundColor: '#1A0505',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#4A1010',
  },
  errorText: { color: C.error, fontSize: 13, textAlign: 'center' },
});
