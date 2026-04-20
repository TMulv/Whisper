import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  GestureResponderEvent,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { watchSyncState } from '@/services/firebase/firestoreService';
import { writeTextToCache } from '@/services/storage/localStorageService';
import { chaptersFromAudnexus, serializeChapters } from '@/services/audio/m4bParser';
import { lookupChapters, lookupChaptersByAsin } from '@/services/audio/chapterLookupService';
import { formatDuration } from '@/utils/timeUtils';
import { FirestorePosition } from '@/types/firebase';
import { M4BChapter } from '@/types/sync';
import type { RootStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

export default function PlayerScreen() {
  const { params } = useRoute<Props['route']>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { book } = useNowPlaying();

  const {
    isPlaying,
    currentChapter,
    position,
    duration,
    playbackRate,
    chapters,
    play,
    pause,
    seekTo,
    seekToChapter,
    skipForward30,
    skipBack30,
    setPlaybackRate,
    setChapters,
  } = useAudioPlayer();

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [epubSyncBanner, setEpubSyncBanner] = useState<FirestorePosition | null>(null);
  const [lookingUpChapters, setLookingUpChapters] = useState(false);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);

  // Watch Firestore for epub position changes
  useEffect(() => {
    if (!user || !params.bookId) return;
    const unsub = watchSyncState(user.uid, params.bookId, (pos) => {
      if (pos?.source === 'epub' && pos.epubCfi) {
        setEpubSyncBanner(pos);
      }
    });
    return unsub;
  }, [user, params.bookId]);

  const displayPosition = isScrubbing ? scrubPosition : position;
  const progress = duration > 0 ? Math.min(displayPosition / duration, 1) : 0;

  const handleScrubberLayout = useCallback((e: any) => {
    setScrubberWidth(e.nativeEvent.layout.width);
  }, []);

  const handleScrubGrant = useCallback((e: GestureResponderEvent) => {
    setIsScrubbing(true);
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubberWidth));
    setScrubPosition(ratio * duration);
  }, [scrubberWidth, duration]);

  const handleScrubMove = useCallback((e: GestureResponderEvent) => {
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubberWidth));
    setScrubPosition(ratio * duration);
  }, [scrubberWidth, duration]);

  const handleScrubRelease = useCallback(() => {
    setIsScrubbing(false);
    seekTo(scrubPosition);
  }, [scrubPosition, seekTo]);

  const nextRate = () => {
    const idx = RATES.indexOf(playbackRate);
    const next = RATES[(idx + 1) % RATES.length];
    setPlaybackRate(next);
  };

  const handlePrevChapter = () => {
    if (!currentChapter || chapters.length === 0) return;
    const prev = chapters.find((c) => c.index === currentChapter.index - 1);
    if (prev) seekToChapter(prev);
  };

  const handleNextChapter = () => {
    if (!currentChapter || chapters.length === 0) return;
    const next = chapters.find((c) => c.index === currentChapter.index + 1);
    if (next) seekToChapter(next);
  };

  const handleChapterSelect = (chapter: M4BChapter) => {
    seekToChapter(chapter);
    setChaptersOpen(false);
  };

  const applyChapterResult = useCallback(async (result: Awaited<ReturnType<typeof lookupChapters>>) => {
    if (!result) return;
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
            setChapters(m4bChapters);
            Alert.alert('Chapters Applied', `${m4bChapters.length} chapters now active.`);
          },
        },
      ],
    );
  }, [params.bookId, setChapters]);

  const promptManualAsin = useCallback(() => {
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
  }, [applyChapterResult]);

  const handleFindChapters = async () => {
    if (!book) return;
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

  const handleOpenReader = () => {
    // Dismiss the Player modal then navigate into the nested LibraryStack → Reader
    (navigation as any).navigate('Main', {
      screen: 'Library',
      params: {
        screen: 'Reader',
        params: { bookId: params.bookId },
      },
    });
  };

  const coverUri = book?.coverUri ?? null;
  const title = book?.title ?? 'Unknown Title';
  const author = book?.author ?? '';
  const chapterLabel = currentChapter?.title ?? (chapters.length > 0 ? chapters[0].title : '');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" />

      {/* Close handle */}
      <TouchableOpacity style={styles.handle} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 40, right: 40 }}>
        <View style={styles.handleBar} />
      </TouchableOpacity>

      {/* Epub sync banner */}
      {epubSyncBanner && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncBannerText}>You were reading at {Math.round((epubSyncBanner.percentComplete ?? 0) * 100)}%</Text>
          <TouchableOpacity onPress={() => setEpubSyncBanner(null)}>
            <Text style={styles.syncBannerDismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover art */}
        <View style={styles.coverWrap}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Text style={styles.coverInitial}>{title[0]?.toUpperCase() ?? '?'}</Text>
            </View>
          )}
        </View>

        {/* Title / author / chapter */}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.author}>{author}</Text>
          {chapterLabel ? <Text style={styles.chapter} numberOfLines={1}>{chapterLabel}</Text> : null}
        </View>

        {/* Scrubber */}
        <View style={styles.scrubberSection}>
          <View
            style={styles.scrubberTrack}
            onLayout={handleScrubberLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrubGrant}
            onResponderMove={handleScrubMove}
            onResponderRelease={handleScrubRelease}
            onResponderTerminate={handleScrubRelease}
          >
            <View style={[styles.scrubberFill, { width: `${progress * 100}%` as any }]} />
            <View style={[styles.scrubberThumb, { left: `${progress * 100}%` as any }]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatDuration(displayPosition)}</Text>
            <Text style={styles.timeText}>-{formatDuration(Math.max(0, duration - displayPosition))}</Text>
          </View>
        </View>

        {/* Playback controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlBtn} onPress={handlePrevChapter}>
            <Text style={styles.controlIcon}>⏮</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={skipBack30}>
            <Text style={styles.controlIcon}>↺</Text>
            <Text style={styles.controlLabel}>30</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.playPauseBtn} onPress={isPlaying ? pause : play}>
            <Text style={styles.playPauseIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={skipForward30}>
            <Text style={styles.controlIcon}>↻</Text>
            <Text style={styles.controlLabel}>30</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={handleNextChapter}>
            <Text style={styles.controlIcon}>⏭</Text>
          </TouchableOpacity>
        </View>

        {/* Speed + open reader row */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.speedBtn} onPress={nextRate}>
            <Text style={styles.speedLabel}>{playbackRate === 1.0 ? '1×' : `${playbackRate}×`}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.readerBtn} onPress={handleOpenReader}>
            <Text style={styles.readerBtnText}>Open in Reader</Text>
          </TouchableOpacity>
        </View>

        {/* Chapter lookup — shown when only the fallback "Track" chapter exists */}
        {chapters.length === 1 && chapters[0]?.title === 'Track' && (
          <View style={styles.findChaptersSection}>
            <Text style={styles.findChaptersHeading}>No chapter markers</Text>
            <Text style={styles.findChaptersBody}>
              Look up real chapter timestamps from Audnexus (Audible chapter database).
            </Text>
            <TouchableOpacity
              style={[styles.findChaptersBtn, lookingUpChapters && styles.btnDisabled]}
              onPress={handleFindChapters}
              disabled={lookingUpChapters}
              activeOpacity={0.8}
            >
              {lookingUpChapters ? (
                <ActivityIndicator size="small" color="#0D0D1A" />
              ) : (
                <Text style={styles.findChaptersBtnText}>Find Chapters via Audnexus</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Chapter list toggle */}
        {chapters.length > 1 && (
          <View style={styles.chapterSection}>
            <TouchableOpacity style={styles.chapterToggle} onPress={() => setChaptersOpen((v) => !v)}>
              <Text style={styles.chapterToggleText}>Chapters</Text>
              <Text style={styles.chapterToggleIcon}>{chaptersOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {chaptersOpen && (
              <View style={styles.chapterList}>
                {chapters.map((ch) => {
                  const isActive = currentChapter?.index === ch.index;
                  return (
                    <TouchableOpacity
                      key={ch.index}
                      style={[styles.chapterRow, isActive && styles.chapterRowActive]}
                      onPress={() => handleChapterSelect(ch)}
                    >
                      <Text style={[styles.chapterRowTitle, isActive && styles.chapterRowTitleActive]} numberOfLines={1}>
                        {ch.title}
                      </Text>
                      <Text style={styles.chapterRowTime}>{formatDuration(ch.startSeconds)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },

  handle: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },

  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  syncBannerText: { color: '#A8C8F0', fontSize: 13 },
  syncBannerDismiss: { color: '#fff', fontSize: 13, fontWeight: '600' },

  scroll: {
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },

  coverWrap: {
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  cover: {
    width: 260,
    height: 260,
    borderRadius: 12,
  },
  coverPlaceholder: {
    backgroundColor: '#1A1A3E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 80,
    fontWeight: '700',
  },

  meta: {
    alignItems: 'center',
    marginBottom: 28,
    width: '100%',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 26,
  },
  author: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 6,
  },
  chapter: {
    fontSize: 13,
    color: '#6B9FD4',
    marginTop: 8,
    textAlign: 'center',
  },

  scrubberSection: {
    width: '100%',
    marginBottom: 28,
  },
  scrubberTrack: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberFill: {
    position: 'absolute',
    top: 16,
    left: 0,
    height: 4,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginLeft: -8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontVariant: ['tabular-nums'],
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 24,
    width: '100%',
  },
  controlBtn: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.85)',
  },
  controlLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    position: 'absolute',
    bottom: 6,
  },
  playPauseBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playPauseIcon: {
    fontSize: 28,
    color: '#0D0D1A',
    marginLeft: 2,
  },

  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
  },
  speedBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  speedLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  readerBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  readerBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },

  findChaptersSection: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  findChaptersHeading: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  findChaptersBody: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  findChaptersBtn: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  findChaptersBtnText: {
    color: '#0D0D1A',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: { opacity: 0.5 },

  chapterSection: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  chapterToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chapterToggleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  chapterToggleIcon: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  chapterList: {},
  chapterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  chapterRowActive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chapterRowTitle: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginRight: 12,
  },
  chapterRowTitleActive: {
    color: '#fff',
    fontWeight: '600',
  },
  chapterRowTime: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontVariant: ['tabular-nums'],
  },
});
