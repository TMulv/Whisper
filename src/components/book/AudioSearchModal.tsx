import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioSearch, ChapterResult } from '@/hooks/useAudioSearch';
import { AudioSearchResult } from '@/services/audio/audioSearch';
import { formatDuration } from '@/utils/timeUtils';
import { M4BChapter } from '@/types/sync';

interface Props {
  visible: boolean;
  onClose: () => void;
  audioPath: string | null;
  chapters: M4BChapter[];
  onSeek: (seconds: number) => void;
}

type AnyResult =
  | { kind: 'transcript'; data: AudioSearchResult }
  | { kind: 'chapter'; data: ChapterResult };

const DEBOUNCE_MS = 150;

export default function AudioSearchModal({
  visible,
  onClose,
  audioPath,
  chapters,
  onSeek,
}: Props) {
  const insets = useSafeAreaInsets();
  const { readiness, search, searchChapters } = useAudioSearch(audioPath, chapters);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnyResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }

      const chapterHits: AnyResult[] = searchChapters(q).map((d) => ({
        kind: 'chapter' as const,
        data: d,
      }));

      if (readiness === 'ready') {
        const transcriptHits: AnyResult[] = search(q).map((d) => ({
          kind: 'transcript' as const,
          data: d,
        }));
        // Chapters first (fast lookup), then transcript hits
        setResults([...chapterHits, ...transcriptHits]);
      } else {
        setResults(chapterHits);
      }
    },
    [readiness, search, searchChapters],
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
    },
    [runSearch],
  );

  const handleSelect = useCallback(
    (seconds: number) => {
      onSeek(seconds);
      onClose();
    },
    [onSeek, onClose],
  );

  const handleClose = useCallback(() => {
    setQuery('');
    setResults([]);
    onClose();
  }, [onClose]);

  const renderItem = useCallback(
    ({ item }: { item: AnyResult }) => {
      if (item.kind === 'chapter') {
        const ch = item.data;
        return (
          <TouchableOpacity
            style={styles.resultRow}
            onPress={() => handleSelect(ch.startSeconds)}
            activeOpacity={0.7}
          >
            <View style={styles.chapterBadge}>
              <Text style={styles.chapterBadgeText}>CH</Text>
            </View>
            <Text style={styles.chapterLabel} numberOfLines={1}>
              {ch.label}
            </Text>
            <Text style={styles.timestamp}>
              {formatDuration(ch.startSeconds)}
            </Text>
          </TouchableOpacity>
        );
      }

      const r = item.data;
      return (
        <TouchableOpacity
          style={styles.resultRow}
          onPress={() => handleSelect(r.startSeconds)}
          activeOpacity={0.7}
        >
          <View style={styles.contextBlock}>
            <Text style={styles.context} numberOfLines={2}>
              {r.contextBefore ? (
                <Text style={styles.contextDim}>{r.contextBefore} </Text>
              ) : null}
              <Text style={styles.match}>{r.matchText}</Text>
              {r.contextAfter ? (
                <Text style={styles.contextDim}> {r.contextAfter}</Text>
              ) : null}
            </Text>
          </View>
          <Text style={styles.timestamp}>{formatDuration(r.startSeconds)}</Text>
        </TouchableOpacity>
      );
    },
    [handleSelect],
  );

  const keyExtractor = useCallback(
    (_: AnyResult, idx: number) => String(idx),
    [],
  );

  const isEmpty = query.trim().length >= 2 && results.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Search Audio</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Search input */}
        <View style={styles.inputRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.input}
            placeholder="Search words or phrases…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={query}
            onChangeText={handleQueryChange}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            selectionColor="#6B9FD4"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => handleQueryChange('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Status bar */}
        {readiness === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
            <Text style={styles.statusText}>Loading transcript…</Text>
          </View>
        )}
        {readiness === 'unavailable' && query.trim().length >= 2 && (
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              No transcript yet — showing chapter matches only
            </Text>
          </View>
        )}

        {/* Results */}
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            isEmpty ? (
              <Text style={styles.emptyText}>No matches found</Text>
            ) : null
          }
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#161628',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },
  clearBtn: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    paddingLeft: 8,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  statusText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },

  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    gap: 10,
  },

  // Transcript result
  contextBlock: {
    flex: 1,
  },
  context: {
    fontSize: 13,
    lineHeight: 18,
  },
  contextDim: {
    color: 'rgba(255,255,255,0.45)',
  },
  match: {
    color: '#fff',
    fontWeight: '700',
  },

  // Chapter result
  chapterBadge: {
    backgroundColor: 'rgba(107,159,212,0.2)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chapterBadgeText: {
    color: '#6B9FD4',
    fontSize: 10,
    fontWeight: '700',
  },
  chapterLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },

  timestamp: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },

  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 32,
  },
});
