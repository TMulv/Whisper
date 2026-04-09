import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { useBooks } from '@/hooks/useBook';
import { useFileStorage } from '@/hooks/useFileStorage';
import BookCard from '@/components/common/BookCard';
import { LocalBook } from '@/types/book';
import { writeBook } from '@/services/firebase/firestoreService';
import type { LibraryStackParamList } from '@/navigation/types';
import * as Crypto from 'expo-crypto';

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'LibraryHome'>;

// ── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonCover} />
      <View style={styles.skeletonMeta}>
        <View style={[styles.skeletonLine, { width: '80%' }]} />
        <View style={[styles.skeletonLine, { width: '50%', marginTop: 6 }]} />
        <View style={[styles.skeletonLine, { width: '30%', marginTop: 12 }]} />
      </View>
    </View>
  );
}

// ── Add Book modal helpers ───────────────────────────────────────────────────

function AddBookButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity
      style={[styles.fab, { bottom: insets.bottom + 20 }]}
      onPress={onPress}
      activeOpacity={0.85}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.fabIcon}>+</Text>
    </TouchableOpacity>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavProp>();
  const { books, loading, error } = useBooks(user?.uid ?? null);
  const { pickEpub, pickAudio } = useFileStorage();
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleAddBook = useCallback(async () => {
    if (!user) return;
    setAdding(true);

    try {
      Alert.alert(
        'Add Book',
        'Pick your EPUB and audio files to add a book.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setAdding(false) },
          {
            text: 'Pick Files',
            onPress: async () => {
              try {
                const bookId = Crypto.randomUUID();

                const epubResult = await pickEpub(bookId);
                if (!epubResult) {
                  setAdding(false);
                  return;
                }

                const audioResult = await pickAudio(bookId);
                if (!audioResult) {
                  setAdding(false);
                  return;
                }

                // Derive title from epub filename (strip extension)
                const epubName = epubResult.name.replace(/\.epub$/i, '');
                const title = epubName || 'Untitled Book';

                const now = Date.now();
                const newBook = {
                  title,
                  author: '',
                  coverUrl: '',
                  epubPath: epubResult.uri,
                  audioPath: audioResult.uri,
                  syncMapPath: null,
                  totalChapters: 1,
                  totalDurationSeconds: 0,
                  syncMode: 'chapter' as const,
                  addedAt: now,
                  updatedAt: now,
                };

                await writeBook(user.uid, bookId, newBook);
                navigation.navigate('BookDetail', { bookId });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                Alert.alert('Error', `Failed to add book: ${msg}`);
              } finally {
                setAdding(false);
              }
            },
          },
        ],
      );
    } catch {
      setAdding(false);
    }
  }, [user, pickEpub, pickAudio, navigation]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // useBooks will re-fetch from Firestore on next render cycle
    // For now, just reset the refreshing indicator after a moment
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const renderBook = useCallback(
    ({ item }: { item: LocalBook }) => (
      <BookCard
        book={item}
        onPress={() => navigation.navigate('BookDetail', { bookId: item.id })}
      />
    ),
    [navigation],
  );

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No books yet</Text>
        <Text style={styles.emptySubtitle}>
          Tap + to add your first epub + audiobook pair.
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
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
            <View>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />

      <AddBookButton onPress={handleAddBook} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  list: { paddingTop: 8, paddingBottom: 96 },

  // Skeleton
  skeletonCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
  },
  skeletonCover: {
    width: 64,
    height: 88,
    borderRadius: 6,
    backgroundColor: '#E8E8E8',
    marginRight: 14,
  },
  skeletonMeta: { flex: 1, justifyContent: 'flex-start', paddingTop: 4 },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#E8E8E8',
  },

  // Empty state
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },

  // Error
  errorBanner: {
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FFCDD2',
  },
  errorText: { color: '#C62828', fontSize: 13, textAlign: 'center' },
});
