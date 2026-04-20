import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  lookupWord,
  DictionaryEntry,
  LookupSource,
  getOfflineOnly,
} from '@/services/dictionary/dictionaryService';

interface Props {
  word: string | null;
  onClose: () => void;
}

export default function WordLookupModal({ word, onClose }: Props) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [source, setSource] = useState<LookupSource>('none');
  const [offlineMode, setOfflineMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!word) {
      setEntry(null);
      setSource('none');
      setNotFound(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEntry(null);
    setNotFound(false);
    (async () => {
      const off = await getOfflineOnly();
      if (cancelled) return;
      setOfflineMode(off);
      const r = await lookupWord(word);
      if (cancelled) return;
      setEntry(r.entry);
      setSource(r.source);
      setNotFound(!r.entry);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [word]);

  return (
    <Modal
      visible={!!word}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              <View style={styles.header}>
                <Text style={styles.word}>{word}</Text>
                {entry?.phonetic ? (
                  <Text style={styles.phonetic}>{entry.phonetic}</Text>
                ) : null}
                <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 16 }}>
                {loading && <ActivityIndicator style={{ marginTop: 12 }} />}
                {!loading && notFound && (
                  <Text style={styles.notFound}>
                    {offlineMode
                      ? 'Not available offline. Disable offline-only mode in Settings or preload common words.'
                      : 'No definition found.'}
                  </Text>
                )}
                {!loading && entry && source === 'cache' && (
                  <Text style={styles.sourceTag}>Offline · cached</Text>
                )}
                {!loading && entry?.definitions.map((def, i) => (
                  <View key={i} style={styles.defRow}>
                    <Text style={styles.partOfSpeech}>{def.partOfSpeech}</Text>
                    <Text style={styles.definition}>
                      {i + 1}. {def.definition}
                    </Text>
                    {def.example ? (
                      <Text style={styles.example}>"{def.example}"</Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  word: { fontSize: 22, fontWeight: '700', color: '#1A1A2E' },
  phonetic: { fontSize: 14, color: '#888', marginLeft: 10 },
  closeBtn: { marginLeft: 'auto', padding: 4 },
  closeBtnText: { fontSize: 18, color: '#888' },
  body: { paddingHorizontal: 20, paddingTop: 12 },
  notFound: { fontSize: 14, color: '#888', fontStyle: 'italic', lineHeight: 19 },
  sourceTag: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  defRow: { marginBottom: 14 },
  partOfSpeech: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9A3412',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  definition: { fontSize: 15, color: '#222', lineHeight: 21 },
  example: { fontSize: 13, color: '#666', fontStyle: 'italic', marginTop: 4 },
});
