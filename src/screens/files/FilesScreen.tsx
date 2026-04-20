import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { useAuth } from '@/hooks/useAuth';
import { useBooks } from '@/hooks/useBook';
import {
  listCachedFiles,
  CachedFile,
  PickKind,
} from '@/services/storage/recentPicksService';
import { deleteCachedFile } from '@/services/storage/localStorageService';
import { localWriteBook } from '@/services/book/localBookStore';
import { writeBook } from '@/services/firebase/firestoreService';
import { bytesToMB } from '@/utils/fileUtils';
import type { MainTabParamList } from '@/navigation/types';

type NavProp = NavigationProp<MainTabParamList>;

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
  green: '#6FAE7A',
};

interface FileRow extends CachedFile {
  pairedBookId: string | null;
  pairedBookTitle: string | null;
}

function formatSize(bytes: number): string {
  const mb = bytesToMB(bytes);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function prettyName(name: string): string {
  // cache files look like "<uuid>_epub.epub" or "<uuid>_audio.m4b"
  return name.replace(/^[a-f0-9-]+_(epub|audio)\./i, '').replace(/\.[^.]+$/, '')
    || name;
}

export default function FilesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const navigation = useNavigation<NavProp>();
  const { books } = useBooks(user?.uid ?? null);

  const [files, setFiles] = useState<CachedFile[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null);
  const [selectedEpub, setSelectedEpub] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setFiles(listCachedFiles());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = navigation.addListener('focus', refresh);
    return unsubscribe;
  }, [navigation, refresh]);

  const rows = useMemo<{ audio: FileRow[]; epub: FileRow[] }>(() => {
    const byUri = new Map<string, { id: string; title: string }>();
    for (const b of books) {
      if (b.epubPath) byUri.set(b.epubPath, { id: b.id, title: b.title });
      if (b.audioPath) byUri.set(b.audioPath, { id: b.id, title: b.title });
    }
    const decorate = (f: CachedFile): FileRow => {
      const paired = byUri.get(f.uri) ?? null;
      return {
        ...f,
        pairedBookId: paired?.id ?? null,
        pairedBookTitle: paired?.title ?? null,
      };
    };
    return {
      audio: files.filter((f) => f.kind === 'audio').map(decorate),
      epub: files.filter((f) => f.kind === 'epub').map(decorate),
    };
  }, [files, books]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refresh();
    setTimeout(() => setRefreshing(false), 400);
  }, [refresh]);

  const handleSelect = useCallback((kind: PickKind, uri: string) => {
    if (kind === 'audio') {
      setSelectedAudio((curr) => (curr === uri ? null : uri));
    } else if (kind === 'epub') {
      setSelectedEpub((curr) => (curr === uri ? null : uri));
    }
  }, []);

  const handleDelete = useCallback(
    (row: FileRow) => {
      const msg = row.pairedBookTitle
        ? `"${prettyName(row.name)}" is paired with "${row.pairedBookTitle}". Delete the file anyway? The book will stop working.`
        : `Delete "${prettyName(row.name)}"?`;
      Alert.alert('Delete file', msg, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCachedFile(row.uri);
            if (selectedAudio === row.uri) setSelectedAudio(null);
            if (selectedEpub === row.uri) setSelectedEpub(null);
            refresh();
          },
        },
      ]);
    },
    [refresh, selectedAudio, selectedEpub],
  );

  const handlePair = useCallback(async () => {
    if (!user || !selectedAudio || !selectedEpub) return;
    const audioFile = files.find((f) => f.uri === selectedAudio);
    const epubFile = files.find((f) => f.uri === selectedEpub);
    if (!audioFile || !epubFile) return;

    const bookId = Crypto.randomUUID();
    const title = prettyName(epubFile.name);
    const now = Date.now();
    const bookData = {
      title,
      author: '',
      coverUrl: '',
      epubPath: epubFile.uri,
      audioPath: audioFile.uri,
      syncMapPath: null,
      totalChapters: 1,
      totalDurationSeconds: 0,
      syncMode: 'chapter' as const,
      addedAt: now,
      updatedAt: now,
    };
    try {
      await localWriteBook(user.uid, bookId, bookData);
      writeBook(user.uid, bookId, bookData).catch(() => {});
      setSelectedAudio(null);
      setSelectedEpub(null);
      navigation.navigate('Library', {
        screen: 'BookDetail',
        params: { bookId },
      } as never);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      Alert.alert('Pair failed', m);
    }
  }, [user, selectedAudio, selectedEpub, files, navigation]);

  const renderItem = useCallback(
    ({ item }: { item: FileRow }) => {
      const isSelected =
        (item.kind === 'audio' && selectedAudio === item.uri) ||
        (item.kind === 'epub' && selectedEpub === item.uri);
      return (
        <TouchableOpacity
          style={[styles.row, isSelected && styles.rowSelected]}
          onPress={() => handleSelect(item.kind, item.uri)}
          onLongPress={() => handleDelete(item)}
          delayLongPress={450}
          activeOpacity={0.75}
        >
          <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
            {isSelected ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <View style={styles.rowMeta}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {prettyName(item.name)}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {formatSize(item.sizeBytes)}
              {item.pairedBookTitle
                ? `  •  paired with ${item.pairedBookTitle}`
                : '  •  unpaired'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.trashBtn}
          >
            <Text style={styles.trashIcon}>🗑</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [selectedAudio, selectedEpub, handleSelect, handleDelete],
  );

  const sections = useMemo(
    () => [
      { title: 'Audio', key: 'audio', data: rows.audio },
      { title: 'Documents', key: 'epub', data: rows.epub },
    ],
    [rows],
  );

  const canPair = selectedAudio !== null && selectedEpub !== null;
  const audioCount = rows.audio.length;
  const epubCount = rows.epub.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.titleBar}>
        <Text style={styles.appName}>FILES</Text>
        <View style={styles.titleDot} />
        <Text style={styles.titleStats}>
          {audioCount} audio • {epubCount} docs
        </Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.uri}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length === 0 ? (
            <Text style={styles.emptyText}>
              No {section.title.toLowerCase()} files cached yet.
            </Text>
          ) : null
        }
        contentContainerStyle={{
          paddingBottom: insets.bottom + (canPair ? 96 : 32),
          paddingHorizontal: 16,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.gold}
            colors={[C.gold]}
          />
        }
        stickySectionHeadersEnabled={false}
      />

      {canPair && (
        <View style={[styles.pairBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pairLabel}>READY TO PAIR</Text>
            <Text style={styles.pairText} numberOfLines={1}>
              {prettyName(files.find((f) => f.uri === selectedEpub)?.name ?? '')}
              {'  ↔  '}
              {prettyName(files.find((f) => f.uri === selectedAudio)?.name ?? '')}
            </Text>
          </View>
          <TouchableOpacity style={styles.pairBtn} onPress={handlePair} activeOpacity={0.85}>
            <Text style={styles.pairBtnText}>Pair</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
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
  titleStats: {
    marginLeft: 'auto',
    color: C.textMuted,
    fontSize: 12,
    letterSpacing: 0.3,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 22,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textFaint,
    letterSpacing: 2.5,
  },
  sectionCount: {
    fontSize: 11,
    color: C.textMuted,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    marginVertical: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowSelected: {
    borderColor: C.gold,
    backgroundColor: '#141427',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: C.goldDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxOn: {
    backgroundColor: C.gold,
    borderColor: C.gold,
  },
  checkboxMark: {
    color: C.bg,
    fontSize: 13,
    fontWeight: '700',
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  rowSub: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  trashBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  trashIcon: {
    fontSize: 16,
    opacity: 0.7,
  },

  emptyText: {
    color: C.textFaint,
    fontSize: 13,
    fontStyle: 'italic',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },

  pairBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.goldDim,
    gap: 12,
  },
  pairLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: C.goldDim,
    letterSpacing: 2,
    marginBottom: 3,
  },
  pairText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '500',
  },
  pairBtn: {
    backgroundColor: C.gold,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  pairBtnText: {
    color: C.bg,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
