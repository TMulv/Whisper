import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { listBooks, writeBook } from '@/services/firebase/firestoreService';
import { SyncMode } from '@/types/book';
import { FirestoreBook } from '@/types/firebase';
import { formatDuration } from '@/utils/timeUtils';
import type { LibraryStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<LibraryStackParamList, 'BookDetail'>;
type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'BookDetail'>;

const SYNC_MODES: { value: SyncMode; label: string; description: string }[] = [
  {
    value: 'chapter',
    label: 'Chapter',
    description: 'Jump to matching chapter. Works for all files.',
  },
  {
    value: 'percentage',
    label: 'Percentage',
    description: 'Sync by % complete. Good fallback for mismatched chapters.',
  },
  {
    value: 'aeneas',
    label: 'Word-level',
    description: 'Precise sync. Requires running aeneas on your Mac first.',
  },
];

export default function BookDetailScreen() {
  const { params } = useRoute<Props['route']>();
  const navigation = useNavigation<NavProp>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [book, setBook] = useState<(FirestoreBook & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>('chapter');
  const [hasSyncMap, setHasSyncMap] = useState(false);

  useEffect(() => {
    if (!user) return;
    listBooks(user.uid).then((books) => {
      const found = books.find((b) => b.id === params.bookId);
      if (found) {
        setBook(found);
        setSyncMode(found.syncMode);
        setHasSyncMap(!!found.syncMapPath);
      }
      setLoading(false);
    });
  }, [user, params.bookId]);

  const handleSaveSyncMode = async (mode: SyncMode) => {
    if (!user || !book) return;
    setSaving(true);
    setSyncMode(mode);
    try {
      await writeBook(user.uid, book.id, { ...book, syncMode: mode, updatedAt: Date.now() });
    } catch {
      Alert.alert('Error', 'Failed to save sync mode.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReader = () => {
    navigation.navigate('Reader', { bookId: params.bookId });
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1A1A2E" />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.loading}>
        <Text style={styles.notFound}>Book not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      {/* Cover + title */}
      <View style={styles.header}>
        {book.coverUrl ? (
          <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Text style={styles.coverInitial}>{book.title[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        )}
        <Text style={styles.title}>{book.title}</Text>
        <Text style={styles.author}>{book.author}</Text>
        <Text style={styles.meta}>
          {book.totalChapters} chapters · {formatDuration(book.totalDurationSeconds)}
        </Text>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleOpenReader} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Open Reader</Text>
        </TouchableOpacity>
      </View>

      {/* Sync mode picker */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sync Mode</Text>
        {saving && <ActivityIndicator size="small" color="#1A1A2E" style={styles.savingSpinner} />}
        {SYNC_MODES.map((mode) => {
          const isSelected = syncMode === mode.value;
          const isDisabled = mode.value === 'aeneas' && !hasSyncMap;
          return (
            <TouchableOpacity
              key={mode.value}
              style={[
                styles.syncOption,
                isSelected && styles.syncOptionSelected,
                isDisabled && styles.syncOptionDisabled,
              ]}
              onPress={() => !isDisabled && handleSaveSyncMode(mode.value)}
              disabled={isDisabled || saving}
              activeOpacity={0.75}
            >
              <View style={styles.syncRadio}>
                {isSelected && <View style={styles.syncRadioFill} />}
              </View>
              <View style={styles.syncLabel}>
                <Text style={[styles.syncLabelText, isDisabled && styles.syncLabelDisabled]}>
                  {mode.label}
                  {isDisabled ? ' (requires sync_map.json)' : ''}
                </Text>
                <Text style={styles.syncDesc}>{mode.description}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* File info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Files</Text>
        <FileRow label="EPUB" path={book.epubPath} />
        <FileRow label="Audio" path={book.audioPath} />
        {book.syncMapPath && <FileRow label="Sync map" path={book.syncMapPath} />}
      </View>
    </ScrollView>
  );
}

function FileRow({ label, path }: { label: string; path: string }) {
  const filename = path.split('/').pop() ?? path;
  return (
    <View style={styles.fileRow}>
      <Text style={styles.fileLabel}>{label}</Text>
      <Text style={styles.filePath} numberOfLines={1} ellipsizeMode="middle">
        {filename}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: '#666' },

  header: { alignItems: 'center', marginBottom: 28 },
  cover: {
    width: 120,
    height: 168,
    borderRadius: 8,
    marginBottom: 16,
  },
  coverPlaceholder: {
    width: 120,
    height: 168,
    borderRadius: 8,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  coverInitial: { color: '#fff', fontSize: 48, fontWeight: '700' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    lineHeight: 28,
  },
  author: { fontSize: 16, color: '#555', marginTop: 6 },
  meta: { fontSize: 13, color: '#888', marginTop: 4 },

  actions: { marginBottom: 28 },
  primaryBtn: {
    backgroundColor: '#1A1A2E',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  savingSpinner: { position: 'absolute', top: 14, right: 16 },

  syncOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    gap: 12,
  },
  syncOptionSelected: {},
  syncOptionDisabled: { opacity: 0.4 },
  syncRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  syncRadioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1A1A2E',
  },
  syncLabel: { flex: 1 },
  syncLabelText: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  syncLabelDisabled: { color: '#999' },
  syncDesc: { fontSize: 13, color: '#888', marginTop: 2, lineHeight: 18 },

  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    gap: 12,
  },
  fileLabel: { fontSize: 13, fontWeight: '600', color: '#555', width: 56 },
  filePath: { flex: 1, fontSize: 13, color: '#888', textAlign: 'right' },
});
