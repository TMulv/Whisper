import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { AnimatedLoader } from '@/components/common/AnimatedLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { writeBook, deleteBook } from '@/services/firebase/firestoreService';
import { localListBooks, localWriteBook, localDeleteBook } from '@/services/book/localBookStore';
import { getCachedPath, writeTextToCache, readTextFromCache } from '@/services/storage/localStorageService';
import { parseChaptersJson, createFallbackChapter, chaptersFromAudnexus, serializeChapters } from '@/services/audio/m4bParser';
import { lookupChapters, lookupChaptersByAsin } from '@/services/audio/chapterLookupService';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { navigateRoot } from '@/navigation/navigationRef';
import CoverPickerModal from '@/components/library/CoverPickerModal';
import { SyncMode, LocalBook } from '@/types/book';
import { FirestoreBook } from '@/types/firebase';
import { formatDuration } from '@/utils/timeUtils';
import type { LibraryStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<LibraryStackParamList, 'BookDetail'>;
type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'BookDetail'>;

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
  bookAccent: '#4A78D8',
  audioAccent: '#3AB87A',
  red: '#E85555',
};

const SYNC_MODES: { value: SyncMode; label: string; description: string }[] = [
  {
    value: 'chapter',
    label: 'Chapter',
    description: 'Jump to matching chapter — works with all files.',
  },
  {
    value: 'percentage',
    label: 'Percentage',
    description: 'Sync by % complete — good fallback for mismatched chapters.',
  },
  {
    value: 'aeneas',
    label: 'Word-level',
    description: 'Precise sync — requires running aeneas on your Mac first.',
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
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [syncMode, setSyncMode] = useState<SyncMode>('chapter');
  const [hasSyncMap, setHasSyncMap] = useState(false);
  const [chapterFileExists, setChapterFileExists] = useState(false);
  const [lookingUpChapters, setLookingUpChapters] = useState(false);
  const [coverPickerVisible, setCoverPickerVisible] = useState(false);
  const { startPlayback, book: nowPlayingBook, clearNowPlaying, updateBookCover } = useNowPlaying();

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(20)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!user) return;
    localListBooks(user.uid).then(async (books) => {
      const found = books.find((b) => b.id === params.bookId);
      if (found) {
        setBook(found);
        setSyncMode(found.syncMode);
        setHasSyncMap(!!found.syncMapPath);
        if (!found.coverUrl) setCoverPickerVisible(true);
      }
      const chaptersUri = await getCachedPath(params.bookId, 'chapters', 'json');
      setChapterFileExists(!!chaptersUri);
      setLoading(false);
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(contentOpacity, { toValue: 1, duration: 600, delay: 150, useNativeDriver: true }),
      ]).start();
    });
  }, [user, params.bookId]);

  const handleSaveSyncMode = async (mode: SyncMode) => {
    if (!user || !book) return;
    setSaving(true);
    setSyncMode(mode);
    try {
      const updated = { ...book, syncMode: mode, updatedAt: Date.now() };
      await localWriteBook(user.uid, book.id, updated);
      writeBook(user.uid, book.id, updated).catch(() => {});
    } catch {
      Alert.alert('Error', 'Failed to save sync mode.');
    } finally {
      setSaving(false);
    }
  };

  const applyChapterResult = async (result: NonNullable<Awaited<ReturnType<typeof lookupChapters>>>) => {
    if (!book || !user) return;
    const { chapters: audnexusChapters, asin, isAccurate } = result;
    const preview = audnexusChapters.slice(0, 5).map((c) => `\u2022 ${c.title}`).join('\n');
    const suffix = audnexusChapters.length > 5 ? `\n\u2026and ${audnexusChapters.length - 5} more` : '';
    const accuracyNote = isAccurate ? '' : '\n\nNote: Audnexus flagged these timestamps as approximate.';
    Alert.alert(
      `Found ${audnexusChapters.length} Chapters`,
      `${preview}${suffix}\n\nASIN: ${asin}${accuracyNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: async () => {
            const m4bChapters = chaptersFromAudnexus(audnexusChapters);
            const json = serializeChapters(m4bChapters);
            await writeTextToCache(json, params.bookId, 'chapters', 'json');
            const updated = { ...book, totalChapters: m4bChapters.length, updatedAt: Date.now() };
            await localWriteBook(user.uid, params.bookId, updated);
            writeBook(user.uid, params.bookId, updated).catch(() => {});
            setBook((prev) => (prev ? { ...prev, totalChapters: m4bChapters.length } : prev));
            setChapterFileExists(true);
            Alert.alert('Chapters Applied', `${m4bChapters.length} chapters loaded.`);
          },
        },
      ],
    );
  };

  const promptManualAsin = () => {
    Alert.prompt(
      'Enter Audible ASIN',
      'Find it in the Audible URL: audible.com/pd/Title/BAXXXXXXXXX',
      async (asin) => {
        if (!asin?.trim()) return;
        setLookingUpChapters(true);
        try {
          const result = await lookupChaptersByAsin(asin);
          if (!result || result.chapters.length < 2) {
            Alert.alert('Not Found', 'No chapter data found for that ASIN in Audnexus.');
            return;
          }
          await applyChapterResult(result);
        } catch {
          Alert.alert('Error', 'Failed to fetch chapters. Check your connection.');
        } finally {
          setLookingUpChapters(false);
        }
      },
      'plain-text',
    );
  };

  const handleFindChapters = async () => {
    if (!book || !user) return;
    setLookingUpChapters(true);
    try {
      const result = await lookupChapters(book.title, book.author, book.audioPath);
      if (!result || result.chapters.length < 2) {
        Alert.alert(
          'Not Found',
          'Could not automatically find this book in Audnexus. You can enter the Audible ASIN manually.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enter ASIN', onPress: promptManualAsin },
          ],
        );
        return;
      }
      await applyChapterResult(result);
    } catch {
      Alert.alert('Error', 'Failed to look up chapters. Check your internet connection.');
    } finally {
      setLookingUpChapters(false);
    }
  };

  const handleOpenReader = () => navigation.navigate('Reader', { bookId: params.bookId });

  const handleCoverSelect = async (coverUrl: string, pickedTitle: string, pickedAuthor: string) => {
    if (!book || !user) return;
    const updated = {
      ...book,
      coverUrl,
      // Auto-fill title/author from the picked edition only if ours are empty/placeholder
      title: book.title && book.title !== 'Untitled Book' ? book.title : pickedTitle,
      author: book.author ? book.author : pickedAuthor,
      updatedAt: Date.now(),
    };
    setBook(updated);
    setCoverPickerVisible(false);
    updateBookCover(book.id, coverUrl);
    await localWriteBook(user.uid, book.id, updated);
    writeBook(user.uid, book.id, updated).catch(() => {});
  };

  const handleDelete = () => {
    Alert.alert('Remove Book', 'Remove this book and all its data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!user) return;
          if (nowPlayingBook?.id === params.bookId) {
            await clearNowPlaying().catch(() => {});
          }
          await localDeleteBook(user.uid, params.bookId);
          deleteBook(user.uid, params.bookId).catch(() => {});
          navigation.goBack();
        },
      },
    ]);
  };

  const handlePlayAudio = async () => {
    if (!book) return;
    setLoadingAudio(true);
    try {
      const ext = book.audioPath.split('.').pop() ?? 'm4b';
      const localAudioUri = await getCachedPath(params.bookId, 'audio', ext);
      if (!localAudioUri) {
        Alert.alert('Not Downloaded', 'Download the audiobook before playing.');
        return;
      }
      let chapters = createFallbackChapter(book.totalDurationSeconds);
      const json = await readTextFromCache(params.bookId, 'chapters', 'json');
      if (json) {
        const parsed = parseChaptersJson(json);
        if (parsed.length > 0) chapters = parsed;
      }
      const localBook: LocalBook = {
        id: params.bookId,
        title: book.title,
        author: book.author,
        coverUri: book.coverUrl ?? null,
        epubPath: book.epubPath,
        audioPath: book.audioPath,
        syncMapPath: book.syncMapPath,
        storageProvider: 'local',
        syncMode: book.syncMode,
        totalChapters: book.totalChapters,
        totalDurationSeconds: book.totalDurationSeconds,
        addedAt: book.addedAt,
        updatedAt: book.updatedAt,
        localEpubUri: null,
        localAudioUri,
        isDownloaded: true,
        downloadProgress: 1,
      };
      await startPlayback(localBook, chapters);
      navigateRoot('Player', { bookId: params.bookId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to start playback: ${msg}`);
    } finally {
      setLoadingAudio(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <AnimatedLoader
          variant="random"
          color={C.gold}
          accent={C.text}
          size={72}
          message="Fetching your book"
        />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.notFound}>Book not found.</Text>
      </View>
    );
  }

  const epubExt = (book.epubPath.split('.').pop() ?? 'epub').toUpperCase();
  const audioExt = (book.audioPath.split('.').pop() ?? 'm4b').toUpperCase();

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <Animated.View
          style={[styles.hero, { opacity: headerOpacity, transform: [{ translateY: headerSlide }] }]}
        >
          <TouchableOpacity
            style={styles.coverStack}
            onPress={() => setCoverPickerVisible(true)}
            activeOpacity={0.8}
          >
            {book.coverUrl ? (
              <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Text style={styles.coverInitial}>{book.title[0]?.toUpperCase() ?? '?'}</Text>
                <Text style={styles.coverAddHint}>Tap to add cover</Text>
              </View>
            )}
            <View style={styles.pairedBadge}>
              <Text style={styles.pairedBadgeText}>PAIRED</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.title}>{book.title}</Text>
          {book.author ? <Text style={styles.author}>{book.author}</Text> : null}

          <Text style={styles.heroMeta}>
            {book.totalChapters} chapters
            {book.totalDurationSeconds > 0 ? `  ·  ${formatDuration(book.totalDurationSeconds)}` : ''}
          </Text>
        </Animated.View>

        <Animated.View style={{ opacity: contentOpacity }}>
          {/* ── Paired files visual ───────────────────────────────────────── */}
          <View style={styles.pairedFiles}>
            <View style={[styles.fileHalf, { backgroundColor: '#0C1220', borderColor: C.bookAccent + '55' }]}>
              <View style={[styles.fileHalfIconWrap, { backgroundColor: C.bookAccent + '22' }]}>
                <Text style={styles.fileHalfEmoji}>📖</Text>
              </View>
              <Text style={styles.fileHalfLabel}>TEXT</Text>
              <Text style={[styles.fileHalfFormat, { color: C.bookAccent }]}>{epubExt}</Text>
              <Text style={styles.fileHalfMeta}>{book.totalChapters} chapters</Text>
            </View>

            <View style={styles.spineVisual}>
              <View style={styles.spineBar} />
              <Text style={styles.spineGlyph}>∞</Text>
              <View style={styles.spineBar} />
            </View>

            <View style={[styles.fileHalf, { backgroundColor: '#0A1A12', borderColor: C.audioAccent + '55' }]}>
              <View style={[styles.fileHalfIconWrap, { backgroundColor: C.audioAccent + '22' }]}>
                <Text style={styles.fileHalfEmoji}>🎧</Text>
              </View>
              <Text style={styles.fileHalfLabel}>AUDIO</Text>
              <Text style={[styles.fileHalfFormat, { color: C.audioAccent }]}>{audioExt}</Text>
              <Text style={styles.fileHalfMeta}>
                {book.totalDurationSeconds > 0 ? formatDuration(book.totalDurationSeconds) : '—'}
              </Text>
            </View>
          </View>

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleOpenReader} activeOpacity={0.85}>
              <Text style={styles.primaryBtnIcon}>📖</Text>
              <Text style={styles.primaryBtnText}>Open Reader</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, loadingAudio && styles.btnDisabled]}
              onPress={handlePlayAudio}
              activeOpacity={0.85}
              disabled={loadingAudio}
            >
              {loadingAudio ? (
                <ActivityIndicator size="small" color={C.gold} />
              ) : (
                <>
                  <Text style={styles.secondaryBtnIcon}>▶</Text>
                  <Text style={styles.secondaryBtnText}>Play Audio</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Chapters ──────────────────────────────────────────────────── */}
          {!chapterFileExists && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CHAPTERS</Text>
              <Text style={styles.sectionBody}>
                No chapter markers found. Whisper can look up real timestamps from Audnexus.
              </Text>
              <TouchableOpacity
                style={[styles.outlineBtn, lookingUpChapters && styles.btnDisabled]}
                onPress={handleFindChapters}
                disabled={lookingUpChapters}
                activeOpacity={0.8}
              >
                {lookingUpChapters ? (
                  <ActivityIndicator size="small" color={C.gold} />
                ) : (
                  <Text style={styles.outlineBtnText}>Look Up via Audnexus</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* ── Sync mode ─────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabel}>SYNC MODE</Text>
              {saving && <ActivityIndicator size="small" color={C.gold} style={{ marginLeft: 8 }} />}
            </View>
            {SYNC_MODES.map((mode) => {
              const isSelected = syncMode === mode.value;
              const isDisabled = mode.value === 'aeneas' && !hasSyncMap;
              return (
                <TouchableOpacity
                  key={mode.value}
                  style={[
                    styles.syncOption,
                    isDisabled && styles.syncOptionDisabled,
                  ]}
                  onPress={() => !isDisabled && handleSaveSyncMode(mode.value)}
                  disabled={isDisabled || saving}
                  activeOpacity={0.75}
                >
                  <View style={[styles.syncRadio, isSelected && styles.syncRadioActive]}>
                    {isSelected && <View style={styles.syncRadioFill} />}
                  </View>
                  <View style={styles.syncTextWrap}>
                    <Text style={[styles.syncLabelText, isDisabled && styles.dimText]}>
                      {mode.label}{isDisabled ? ' — requires sync_map.json' : ''}
                    </Text>
                    <Text style={[styles.syncDesc, isDisabled && styles.dimText]}>
                      {mode.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Files ─────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FILES</Text>
            <FileRow icon="📖" label="EPUB" filename={`${book.title}.${epubExt.toLowerCase()}`} />
            <FileRow icon="🎧" label="Audio" filename={`${book.title}.${audioExt.toLowerCase()}`} />
            {book.syncMapPath && <FileRow icon="⟳" label="Sync" filename={`${book.title}.json`} />}
          </View>

          {/* ── Delete ────────────────────────────────────────────────────── */}
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
            <Text style={styles.deleteBtnText}>Remove Book</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      <CoverPickerModal
        visible={coverPickerVisible}
        bookId={book.id}
        initialTitle={book.title}
        initialAuthor={book.author}
        allowSkip={!!book.coverUrl}
        onSelect={handleCoverSelect}
        onSkip={() => setCoverPickerVisible(false)}
        onClose={() => setCoverPickerVisible(false)}
      />
    </View>
  );
}

function FileRow({ icon, label, filename }: { icon: string; label: string; filename: string }) {
  return (
    <View style={styles.fileRow}>
      <Text style={styles.fileRowIcon}>{icon}</Text>
      <Text style={styles.fileRowLabel}>{label}</Text>
      <Text style={styles.fileRowPath} numberOfLines={1} ellipsizeMode="middle">
        {filename}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  loadingScreen: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  notFound: { color: C.textMuted, fontSize: 16 },

  hero: { alignItems: 'center', marginBottom: 24 },
  coverStack: { position: 'relative', marginBottom: 20 },
  cover: { width: 128, height: 180, borderRadius: 10 },
  coverPlaceholder: {
    width: 128,
    height: 180,
    borderRadius: 10,
    backgroundColor: C.surfaceHigh,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: { color: C.gold, fontSize: 52, fontWeight: '300' },
  coverAddHint: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  pairedBadge: {
    position: 'absolute',
    bottom: -10,
    alignSelf: 'center',
    backgroundColor: C.gold,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pairedBadgeText: { color: C.bg, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
    lineHeight: 29,
    letterSpacing: -0.3,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  author: { fontSize: 15, color: C.textMuted, marginTop: 6, textAlign: 'center' },
  heroMeta: {
    fontSize: 12,
    color: C.textFaint,
    marginTop: 10,
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  pairedFiles: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 8,
    marginBottom: 16,
  },
  fileHalf: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  fileHalfIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  fileHalfEmoji: { fontSize: 19 },
  fileHalfLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2,
    color: C.textFaint,
    marginBottom: 6,
  },
  fileHalfFormat: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 3,
  },
  fileHalfMeta: { fontSize: 11, color: C.textMuted, textAlign: 'center' },

  spineVisual: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  spineBar: { flex: 1, width: 1, backgroundColor: C.goldDim },
  spineGlyph: { fontSize: 13, color: C.gold, marginVertical: 4 },

  actions: { marginBottom: 16, gap: 10 },
  primaryBtn: {
    backgroundColor: C.gold,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnIcon: { fontSize: 16, marginRight: 8 },
  primaryBtnText: { color: C.bg, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  secondaryBtn: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.goldDim,
  },
  secondaryBtnIcon: { fontSize: 13, color: C.gold, marginRight: 8 },
  secondaryBtnText: { color: C.gold, fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.5 },

  section: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textFaint,
    letterSpacing: 2.5,
    marginBottom: 12,
  },
  sectionBody: { fontSize: 13, color: C.textMuted, lineHeight: 20, marginBottom: 14, marginTop: -4 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: C.goldDim,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  outlineBtnText: { color: C.gold, fontSize: 14, fontWeight: '600' },

  syncOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  syncOptionDisabled: { opacity: 0.35 },
  syncRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: C.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginRight: 12,
  },
  syncRadioActive: { borderColor: C.gold },
  syncRadioFill: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold },
  syncTextWrap: { flex: 1 },
  syncLabelText: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  syncDesc: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  dimText: { color: C.textFaint },

  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  fileRowIcon: { fontSize: 12, marginRight: 8 },
  fileRowLabel: { fontSize: 10, fontWeight: '700', color: C.textFaint, width: 44, letterSpacing: 0.5 },
  fileRowPath: { flex: 1, fontSize: 12, color: C.textMuted, textAlign: 'right' },

  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 6 },
  deleteBtnText: { color: C.red, fontSize: 14, fontWeight: '500', letterSpacing: 0.2 },
});
