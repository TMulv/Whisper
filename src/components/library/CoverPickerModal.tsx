import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import { cacheFile } from '@/services/storage/localStorageService';
import { searchBookCovers, CoverCandidate, CoverLookupError } from '@/services/book/coverLookupService';

const C = {
  bg: '#09090F',
  surface: '#0F0F1A',
  surfaceHigh: '#141426',
  border: '#1C1C2E',
  borderBright: '#2A2A42',
  gold: '#C9A96E',
  goldDim: '#6A5832',
  text: '#F0E6D4',
  textMuted: '#7A6E62',
  textFaint: '#3A3530',
};

interface Props {
  visible: boolean;
  bookId: string;
  initialTitle: string;
  initialAuthor?: string;
  allowSkip?: boolean;
  onSelect: (coverUrl: string, title: string, author: string) => void;
  onSkip?: () => void;
  onClose: () => void;
}

export default function CoverPickerModal({
  visible,
  bookId,
  initialTitle,
  initialAuthor,
  allowSkip = true,
  onSelect,
  onSkip,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState(initialAuthor ?? '');
  const [pasteUrl, setPasteUrl] = useState('');
  const [candidates, setCandidates] = useState<CoverCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorKind, setErrorKind] = useState<'network' | 'server' | null>(null);

  const runSearch = useCallback(async (t: string, a: string) => {
    if (!t.trim()) return;
    setLoading(true);
    setSearched(true);
    setErrorKind(null);
    try {
      const results = await searchBookCovers(t.trim(), a.trim() || undefined, 18);
      setCandidates(results);
    } catch (err) {
      if (err instanceof CoverLookupError) setErrorKind(err.cause);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setTitle(initialTitle);
      setAuthor(initialAuthor ?? '');
      setPasteUrl('');
      setCandidates([]);
      setSearched(false);
      setErrorKind(null);
      runSearch(initialTitle, initialAuthor ?? '');
    }
  }, [visible, initialTitle, initialAuthor, runSearch]);

  const handlePick = (c: CoverCandidate) => {
    onSelect(c.coverUrl, c.title, c.author);
  };

  const handleSkip = () => {
    if (onSkip) onSkip();
    else onClose();
  };

  const handleUsePasteUrl = () => {
    const trimmed = pasteUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      Alert.alert('Invalid URL', 'Must start with http:// or https://');
      return;
    }
    onSelect(trimmed, title.trim() || initialTitle, author.trim());
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const ext = (asset.name.split('.').pop() ?? 'jpg').toLowerCase();
      // Suffix so repeated uploads don't clobber cache-meta for the same book
      const scopedBookId = `${bookId}_${Crypto.randomUUID().slice(0, 8)}`;
      const cachedUri = await cacheFile(asset.uri, scopedBookId, 'cover', ext);
      onSelect(cachedUri, title.trim() || initialTitle, author.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Upload failed', msg);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.headerBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Choose Cover</Text>
          {allowSkip ? (
            <TouchableOpacity onPress={handleSkip} hitSlop={12}>
              <Text style={styles.headerBtn}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 50 }} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Add your own: upload or paste URL */}
          <View style={styles.ownSection}>
            <Text style={styles.sectionLabel}>ADD YOUR OWN</Text>

            <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload} activeOpacity={0.8}>
              <Text style={styles.uploadBtnIcon}>📁</Text>
              <Text style={styles.uploadBtnText}>Upload image from device</Text>
            </TouchableOpacity>

            <View style={styles.pasteRow}>
              <TextInput
                style={styles.pasteInput}
                value={pasteUrl}
                onChangeText={setPasteUrl}
                placeholder="Paste cover image URL"
                placeholderTextColor={C.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={handleUsePasteUrl}
              />
              <TouchableOpacity
                style={[styles.pasteBtn, !pasteUrl.trim() && styles.pasteBtnDisabled]}
                onPress={handleUsePasteUrl}
                disabled={!pasteUrl.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.pasteBtnText}>Use</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchFields}>
            <Text style={styles.sectionLabel}>SEARCH</Text>
            <Text style={styles.label}>TITLE</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Book title"
              placeholderTextColor={C.textFaint}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(title, author)}
            />
            <Text style={[styles.label, { marginTop: 12 }]}>AUTHOR (optional)</Text>
            <TextInput
              style={styles.input}
              value={author}
              onChangeText={setAuthor}
              placeholder="Author name"
              placeholderTextColor={C.textFaint}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(title, author)}
            />

            <TouchableOpacity
              style={styles.searchBtn}
              onPress={() => runSearch(title, author)}
              activeOpacity={0.8}
              disabled={loading || !title.trim()}
            >
              {loading ? (
                <ActivityIndicator size="small" color={C.bg} />
              ) : (
                <Text style={styles.searchBtnText}>Search Covers</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Results */}
          {loading && candidates.length === 0 ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={C.gold} />
              <Text style={styles.emptyText}>Searching…</Text>
            </View>
          ) : errorKind ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {errorKind === 'network' ? 'No internet connection' : 'Search unavailable'}
              </Text>
              <Text style={styles.emptySub}>
                Use the options above to upload or paste a URL, or retry.
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => runSearch(title, author)}
                activeOpacity={0.8}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : candidates.length === 0 && searched ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No covers found.</Text>
              <Text style={styles.emptySub}>
                Try different title/author terms, or upload / paste a URL above.
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {candidates.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.card}
                  onPress={() => handlePick(c)}
                  activeOpacity={0.75}
                >
                  <Image source={{ uri: c.coverUrl }} style={styles.coverImg} resizeMode="cover" />
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {c.title}
                  </Text>
                  {c.author ? (
                    <Text style={styles.cardAuthor} numberOfLines={1}>
                      {c.author}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  headerBtn: { color: C.gold, fontSize: 15, minWidth: 50 },

  content: { padding: 16, paddingBottom: 48 },

  sectionLabel: {
    color: C.gold,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: 10,
  },

  ownSection: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 14,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceHigh,
    borderWidth: 1,
    borderColor: C.borderBright,
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
  },
  uploadBtnIcon: { fontSize: 16 },
  uploadBtnText: { color: C.text, fontWeight: '600', fontSize: 14 },
  pasteRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  pasteInput: {
    flex: 1,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderBright,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
  },
  pasteBtn: {
    backgroundColor: C.gold,
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  pasteBtnDisabled: { backgroundColor: C.goldDim, opacity: 0.5 },
  pasteBtnText: { color: C.bg, fontWeight: '700', fontSize: 14 },

  searchFields: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 16,
  },
  label: { color: C.textMuted, fontSize: 11, letterSpacing: 1.2, fontWeight: '600' },
  input: {
    marginTop: 6,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.borderBright,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 15,
  },
  searchBtn: {
    marginTop: 14,
    backgroundColor: C.gold,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  searchBtnText: { color: C.bg, fontWeight: '700', fontSize: 14 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  card: { width: '31%', marginBottom: 14 },
  coverImg: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: C.surfaceHigh,
    borderRadius: 6,
  },
  cardTitle: { color: C.text, fontSize: 11, fontWeight: '600', marginTop: 6, lineHeight: 14 },
  cardAuthor: { color: C.textMuted, fontSize: 10, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: C.text, fontSize: 15, marginTop: 12 },
  emptySub: {
    color: C.textMuted,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 18,
  },

  retryBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.gold,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: { color: C.gold, fontWeight: '600', fontSize: 13 },
});
