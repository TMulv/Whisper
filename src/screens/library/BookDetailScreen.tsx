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
import { getCachedPath, writeTextToCache } from '@/services/storage/localStorageService';
import { chaptersFromAudnexus, serializeChapters } from '@/services/audio/m4bParser';
import { lookupChapters, lookupChaptersByAsin } from '@/services/audio/chapterLookupService';
import { prepareBookForPlayback } from '@/services/audio/prepareBookForPlayback';
import { ensureLayer0Fresh } from '@/services/sync/alignmentStore';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { navigateRoot } from '@/navigation/navigationRef';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CoverPickerModal from '@/components/library/CoverPickerModal';
import AIInsightsModal from '@/components/ai/AIInsightsModal';
import EpubWebView, { EpubWebViewRef, EpubChapter } from '@/components/reader/EpubWebView';
import type { AIPromptId } from '@/services/ai/aiPrompts';
import TranscriptionShelf from '@/components/book/TranscriptionShelf';
import {
  kickoffAssemblyAiTranscription,
  loadCachedAssemblyAiWords,
  type TranscriptionStatus,
} from '@/services/sync/assemblyAiAdapter';
import { FirestoreBook } from '@/types/firebase';
import { formatDuration } from '@/utils/timeUtils';
import { getBookDisplay } from '@/utils/bookDisplay';
import { logger } from '@/utils/logger';
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

export default function BookDetailScreen() {
  const { params } = useRoute<Props['route']>();
  const navigation = useNavigation<NavProp>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [book, setBook] = useState<(FirestoreBook & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [chapterFileExists, setChapterFileExists] = useState(false);
  const [lookingUpChapters, setLookingUpChapters] = useState(false);
  const [coverPickerVisible, setCoverPickerVisible] = useState(false);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [aiPromptId, setAiPromptId] = useState<AIPromptId | null>(null);
  const [hiddenEpubMounted, setHiddenEpubMounted] = useState(false);
  const [hiddenEpubChapters, setHiddenEpubChapters] = useState<EpubChapter[]>([]);
  const [txStatus, setTxStatus] = useState<TranscriptionStatus | null>(null);
  const { startPlayback, book: nowPlayingBook, clearNowPlaying, updateBookCover } = useNowPlaying();

  const hiddenEpubRef = useRef<EpubWebViewRef>(null);
  const hiddenEpubReadyRef = useRef(false);
  const hiddenEpubBookLoadedRef = useRef(false);

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerSlide = useRef(new Animated.Value(20)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!user) return;
    localListBooks(user.uid).then(async (books) => {
      const found = books.find((b) => b.id === params.bookId);
      if (found) {
        setBook(found);
        if (!found.coverUrl) setCoverPickerVisible(true);
      }
      const chaptersUri = await getCachedPath(params.bookId, 'chapters', 'json');
      setChapterFileExists(!!chaptersUri);
      try {
        const epubKey = `@whisper/positions_cache:${params.bookId}:epub`;
        const raw = await AsyncStorage.getItem(epubKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.chapterIndex === 'number') {
            setCurrentChapterIndex(parsed.chapterIndex);
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
      Animated.parallel([
        Animated.timing(headerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(headerSlide, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(contentOpacity, { toValue: 1, duration: 600, delay: 150, useNativeDriver: true }),
      ]).start();
    });
  }, [user, params.bookId]);

  // Track AssemblyAI transcription progress for the audiobook so we can render
  // the shelf at the bottom of the screen. The adapter dedupes in-flight jobs
  // and resumes from a persisted job id, so calling kickoff every mount is
  // safe — the cached transcript path returns immediately with done=1.
  useEffect(() => {
    if (!user || !book) return;
    let cancelled = false;
    (async () => {
      try {
        const ext = (book.audioPath?.split('.').pop() ?? 'm4b').toLowerCase();
        const audioUri = await getCachedPath(params.bookId, 'audio', ext);
        if (!audioUri) return;
        const cached = await loadCachedAssemblyAiWords(audioUri);
        if (cancelled) return;
        if (cached && cached.length > 0) {
          // Already done — don't render the shelf.
          setTxStatus({ fraction: 1, phase: 'done', etaSeconds: 0 });
          return;
        }
        // Starts (or resumes) the background job and streams status updates.
        kickoffAssemblyAiTranscription(
          audioUri,
          (s) => { if (!cancelled) setTxStatus(s); },
          book.totalDurationSeconds,
        );
      } catch (err) {
        logger.warn('BookDetail: failed to track transcription', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user, book, params.bookId]);

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
            // Build a provisional Layer 0 alignment now. ReaderScreen will
            // refresh it with the real epub spine length via ensureLayer0Fresh
            // on first open.
            ensureLayer0Fresh(params.bookId, m4bChapters, m4bChapters.length).catch(() => {});
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
      const display = getBookDisplay(book);
      const result = await lookupChapters(display.title, display.author, book.audioPath);
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

  const handleOpenReader = () => {
    const resumeFromAudio = nowPlayingBook?.id === params.bookId;
    navigateRoot('BookSession', { bookId: params.bookId, mode: 'read', resumeFromAudio });
  };

  const ensureHiddenEpubLoaded = async (): Promise<boolean> => {
    if (hiddenEpubBookLoadedRef.current) return true;
    const epubUri = await getCachedPath(params.bookId, 'epub', 'epub');
    if (!epubUri) return false;
    setHiddenEpubMounted(true);
    // Wait until the bridge is ready before loading the book.
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (hiddenEpubReadyRef.current || Date.now() - start > 20000) resolve();
        else setTimeout(tick, 100);
      };
      tick();
    });
    if (!hiddenEpubReadyRef.current) return false;
    hiddenEpubRef.current?.loadBookFromUri(epubUri);
    hiddenEpubBookLoadedRef.current = true;
    // Give the WebView a moment to parse the spine and report chapters.
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    return true;
  };

  const loadAiChapterText = async (promptId: AIPromptId): Promise<string | null> => {
    const loaded = await ensureHiddenEpubLoaded();
    if (!loaded) return null;
    const MAX_CHARS = 120_000;

    const safeGetChapter = async (index: number): Promise<string | null> => {
      try {
        const text = await hiddenEpubRef.current?.getChapterText(index, 20000);
        return text && text.length > 0 ? text : null;
      } catch (err) {
        logger.warn('BookDetail: hidden getChapterText failed', { index, err });
        return null;
      }
    };

    if (promptId === 'story_so_far') {
      const parts: string[] = [];
      let used = 0;
      for (let i = 0; i <= currentChapterIndex; i++) {
        const t = await safeGetChapter(i);
        if (!t) continue;
        const remaining = MAX_CHARS - used;
        if (remaining <= 0) break;
        const header = `\n\n=== Chapter ${i + 1}${hiddenEpubChapters[i]?.title ? `: ${hiddenEpubChapters[i].title}` : ''} ===\n\n`;
        const slice = t.length > remaining - header.length ? t.slice(0, Math.max(0, remaining - header.length)) : t;
        parts.push(header + slice);
        used += header.length + slice.length;
      }
      return parts.length > 0 ? parts.join('') : null;
    }

    if (promptId === 'jump_ahead') {
      const next = currentChapterIndex + 1;
      const total = hiddenEpubChapters.length || (book?.totalChapters ?? 0);
      if (total > 0 && next >= total) return null;
      return await safeGetChapter(next);
    }

    // left_off_recap (and fallback)
    return await safeGetChapter(currentChapterIndex);
  };

  const handleOpenAiPrompt = async (promptId: AIPromptId) => {
    if (promptId === 'jump_ahead') {
      const total = book?.totalChapters ?? 0;
      if (total > 0 && currentChapterIndex + 1 >= total) {
        Alert.alert("You're at the end", "There's no next chapter to preview — you've reached the last chapter.");
        return;
      }
    }
    setAiPromptId(promptId);
  };

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
    if (!book || !user) return;
    setLoadingAudio(true);
    try {
      const prepared = await prepareBookForPlayback(user.uid, params.bookId);
      if (!prepared) {
        Alert.alert('Not Downloaded', 'Download the audiobook before playing.');
        return;
      }
      await startPlayback(prepared.localBook, prepared.chapters, prepared.startTimestamp);
      navigateRoot('BookSession', { bookId: params.bookId, mode: 'listen' });
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
  const display = getBookDisplay(book);

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
                <Text style={styles.coverInitial}>{display.title[0]?.toUpperCase() ?? '?'}</Text>
                <Text style={styles.coverAddHint}>Tap to add cover</Text>
              </View>
            )}
            <View style={styles.pairedBadge}>
              <Text style={styles.pairedBadgeText}>PAIRED</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.title}>{display.title}</Text>
          {display.author ? <Text style={styles.author}>{display.author}</Text> : null}

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

          {/* ── AI Summary ───────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>AI SUMMARY</Text>
            <Text style={styles.sectionBody}>
              {currentChapterIndex > 0
                ? `You're on chapter ${currentChapterIndex + 1}${book.totalChapters ? ` of ${book.totalChapters}` : ''}. Let Claude catch you up or preview what's next.`
                : `Start reading, then come back — Claude can recap where you are, summarize the story so far, or preview what's ahead.`}
            </Text>
            <AIOption
              icon="📍"
              title="Where I left off"
              subtitle="Refresh me on the chapter I stopped in."
              onPress={() => handleOpenAiPrompt('left_off_recap')}
            />
            <AIOption
              icon="📚"
              title="What's happened so far"
              subtitle="The story up to where I am now."
              onPress={() => handleOpenAiPrompt('story_so_far')}
              disabled={currentChapterIndex === 0}
            />
            <AIOption
              icon="⏭️"
              title="Jump ahead preview"
              subtitle="Spoiler-light teaser of the next chapter."
              onPress={() => handleOpenAiPrompt('jump_ahead')}
              last
            />
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

          {/* ── Files ─────────────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>FILES</Text>
            <FileRow icon="📖" label="EPUB" filename={`${display.title}.${epubExt.toLowerCase()}`} />
            <FileRow icon="🎧" label="Audio" filename={`${display.title}.${audioExt.toLowerCase()}`} />
            {book.syncMapPath && <FileRow icon="⟳" label="Sync" filename={`${display.title}.json`} />}
          </View>

          {/* ── Transcription progress ─────────────────────────────────────── */}
          {txStatus && txStatus.fraction < 1 && (
            <View style={styles.shelfSection}>
              <TranscriptionShelf
                bookId={params.bookId}
                progress={txStatus.fraction}
                phase={txStatus.phase}
                etaSeconds={txStatus.etaSeconds}
              />
            </View>
          )}

          {/* ── Delete ────────────────────────────────────────────────────── */}
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} activeOpacity={0.7}>
            <Text style={styles.deleteBtnText}>Remove Book</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      <CoverPickerModal
        visible={coverPickerVisible}
        bookId={book.id}
        initialTitle={display.title}
        initialAuthor={display.author}
        allowSkip={!!book.coverUrl}
        onSelect={handleCoverSelect}
        onSkip={() => setCoverPickerVisible(false)}
        onClose={() => setCoverPickerVisible(false)}
      />

      {/* Hidden EpubWebView — mounted lazily to extract chapter text for AI. */}
      {hiddenEpubMounted && (
        <View style={styles.hiddenEpub} pointerEvents="none">
          <EpubWebView
            ref={hiddenEpubRef}
            onReady={() => { hiddenEpubReadyRef.current = true; }}
            onChapterList={setHiddenEpubChapters}
            onError={(msg) => logger.warn('Hidden EpubWebView error', msg)}
          />
        </View>
      )}

      <AIInsightsModal
        visible={aiPromptId !== null}
        onClose={() => setAiPromptId(null)}
        chapterContext={{
          bookTitle: display.title,
          author: display.author,
          chapterTitle: hiddenEpubChapters[currentChapterIndex]?.title ?? '',
          chapterIndex: currentChapterIndex,
          totalChapters: hiddenEpubChapters.length || book.totalChapters || 1,
        }}
        loadChapterText={loadAiChapterText}
        autoRunPromptId={aiPromptId ?? undefined}
        onOpenSettings={() => {
          (navigation as any).getParent()?.navigate('Main', { screen: 'Settings' });
        }}
      />
    </View>
  );
}

function AIOption({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
  last,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.aiOption, last && styles.aiOptionLast, disabled && styles.aiOptionDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <Text style={styles.aiOptionIcon}>{icon}</Text>
      <View style={styles.aiOptionText}>
        <Text style={[styles.aiOptionTitle, disabled && styles.dimText]}>{title}</Text>
        <Text style={[styles.aiOptionSubtitle, disabled && styles.dimText]}>{subtitle}</Text>
      </View>
      <Text style={[styles.aiOptionChev, disabled && styles.dimText]}>›</Text>
    </TouchableOpacity>
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

  shelfSection: { marginBottom: 10 },
  deleteBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 6 },
  deleteBtnText: { color: C.red, fontSize: 14, fontWeight: '500', letterSpacing: 0.2 },

  aiOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  aiOptionLast: { borderBottomWidth: 0, paddingBottom: 2 },
  aiOptionDisabled: { opacity: 0.4 },
  aiOptionIcon: { fontSize: 20, marginRight: 12, width: 26, textAlign: 'center' },
  aiOptionText: { flex: 1 },
  aiOptionTitle: { color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  aiOptionSubtitle: { color: C.textMuted, fontSize: 12, lineHeight: 17 },
  aiOptionChev: { color: C.textFaint, fontSize: 22, marginLeft: 6 },

  hiddenEpub: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -9999,
    top: -9999,
    opacity: 0,
  },
});
