import React, { useState, useCallback } from 'react';
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
import AudioSearchModal from '@/components/book/AudioSearchModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { writeTextToCache } from '@/services/storage/localStorageService';
import { chaptersFromAudnexus, serializeChapters } from '@/services/audio/m4bParser';
import { lookupChapters, lookupChaptersByAsin } from '@/services/audio/chapterLookupService';
import { ensureLayer0Fresh } from '@/services/sync/alignmentStore';
import { formatDuration } from '@/utils/timeUtils';
import { getBookDisplay } from '@/utils/bookDisplay';
import { M4BChapter } from '@/types/sync';
import AIInsightsModal from '@/components/ai/AIInsightsModal';
import { VoidColors, VoidFonts, VoidRadius } from '@/constants/voidTheme';

const RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

export interface ListenViewProps {
  bookId: string;
}

export default function ListenView({ bookId }: ListenViewProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
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
  const [lookingUpChapters, setLookingUpChapters] = useState(false);
  const [aiVisible, setAiVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [scrubberWidth, setScrubberWidth] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);

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
    const preview = audnexusChapters.slice(0, 5).map((c) => `• ${c.title}`).join('\n');
    const suffix = audnexusChapters.length > 5 ? `\n…and ${audnexusChapters.length - 5} more` : '';
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
            await writeTextToCache(json, bookId, 'chapters', 'json');
            setChapters(m4bChapters);
            ensureLayer0Fresh(bookId, m4bChapters, m4bChapters.length).catch(() => {});
            Alert.alert('Chapters Applied', `${m4bChapters.length} chapters now active.`);
          },
        },
      ],
    );
  }, [bookId, setChapters]);

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

  const coverUri = book?.coverUri ?? null;
  const { title, author } = book
    ? getBookDisplay(book)
    : { title: 'Unknown Title', author: '' };
  const chapterLabel = currentChapter?.title ?? (chapters.length > 0 ? chapters[0].title : '');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.coverWrap}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Text style={styles.coverInitial}>{title[0]?.toUpperCase() ?? '?'}</Text>
            </View>
          )}
        </View>

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.author}>{author}</Text>
          {chapterLabel ? <Text style={styles.chapter} numberOfLines={1}>{chapterLabel}</Text> : null}
        </View>

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

        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.speedBtn} onPress={nextRate}>
            <Text style={styles.speedLabel}>{playbackRate === 1.0 ? '1×' : `${playbackRate}×`}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.searchBtn} onPress={() => setSearchVisible(true)} activeOpacity={0.8}>
            <Text style={styles.searchBtnText}>🔍 Search</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.aiBtn} onPress={() => setAiVisible(true)} activeOpacity={0.8}>
            <Text style={styles.aiBtnText}>✨ Insights</Text>
          </TouchableOpacity>
        </View>

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

        <AIInsightsModal
          visible={aiVisible}
          onClose={() => setAiVisible(false)}
          chapterContext={{
            bookTitle: title,
            author: author,
            chapterTitle: currentChapter?.title ?? '',
            chapterIndex: currentChapter?.index ?? 0,
            totalChapters: chapters.length || 1,
          }}
          onOpenSettings={() => {
            (navigation as any).navigate('Main', { screen: 'Settings' });
          }}
        />

        <AudioSearchModal
          visible={searchVisible}
          onClose={() => setSearchVisible(false)}
          audioPath={book?.localAudioUri ?? book?.audioPath ?? null}
          chapters={chapters}
          onSeek={seekTo}
        />

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
                      <Text style={[styles.chapterRowTime, isActive && styles.chapterRowTimeActive]}>{formatDuration(ch.startSeconds)}</Text>
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
    backgroundColor: VoidColors.void,
  },

  scroll: {
    paddingHorizontal: 24,
    paddingTop: 52,
    alignItems: 'center',
  },

  coverWrap: {
    marginBottom: 32,
  },
  cover: {
    width: 260,
    height: 260,
    borderRadius: VoidRadius.cardLg,
  },
  coverPlaceholder: {
    backgroundColor: VoidColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    fontFamily: VoidFonts.display,
    color: VoidColors.pureWhite,
    fontSize: 96,
    fontWeight: '900',
    letterSpacing: -4,
  },

  meta: {
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  title: {
    fontFamily: VoidFonts.display,
    fontSize: 24,
    fontWeight: '800',
    color: VoidColors.pureWhite,
    textAlign: 'center',
    lineHeight: 26,
    letterSpacing: -0.5,
  },
  author: {
    fontSize: 14,
    color: VoidColors.mutedAsh,
    marginTop: 8,
  },
  chapter: {
    fontSize: 12,
    fontWeight: '700',
    color: VoidColors.luminousGreen,
    marginTop: 12,
    textAlign: 'center',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
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
    height: 3,
    backgroundColor: VoidColors.pureWhite,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: VoidColors.pureWhite,
    marginLeft: -8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: VoidColors.mutedAsh,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 28,
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
    color: VoidColors.pureWhite,
  },
  controlLabel: {
    fontSize: 10,
    color: VoidColors.mutedAsh,
    position: 'absolute',
    bottom: 6,
    letterSpacing: 0.4,
  },
  playPauseBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: VoidColors.pureWhite,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  playPauseIcon: {
    fontSize: 28,
    color: VoidColors.void,
    marginLeft: 2,
  },

  secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
    gap: 8,
  },
  speedBtn: {
    backgroundColor: 'transparent',
    borderRadius: VoidRadius.pill,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: VoidColors.pureWhite,
  },
  speedLabel: {
    color: VoidColors.pureWhite,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  searchBtn: {
    backgroundColor: 'transparent',
    borderRadius: VoidRadius.pill,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: VoidColors.pureWhite,
  },
  searchBtnText: {
    color: VoidColors.pureWhite,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  aiBtn: {
    backgroundColor: VoidColors.electricYellow,
    borderRadius: VoidRadius.pill,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  aiBtnText: {
    color: VoidColors.void,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  findChaptersSection: {
    width: '100%',
    backgroundColor: VoidColors.surface,
    borderRadius: VoidRadius.cardLg,
    padding: 18,
    marginBottom: 12,
  },
  findChaptersHeading: {
    color: VoidColors.pureWhite,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  findChaptersBody: {
    color: VoidColors.mutedAsh,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  findChaptersBtn: {
    backgroundColor: VoidColors.pureWhite,
    borderRadius: VoidRadius.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  findChaptersBtnText: {
    color: VoidColors.void,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  btnDisabled: { opacity: 0.5 },

  chapterSection: {
    width: '100%',
    backgroundColor: VoidColors.surface,
    borderRadius: VoidRadius.cardLg,
    overflow: 'hidden',
  },
  chapterToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  chapterToggleText: {
    color: VoidColors.pureWhite,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  chapterToggleIcon: {
    color: VoidColors.mutedAsh,
    fontSize: 12,
  },
  chapterList: {},
  chapterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: VoidColors.ghostlyDim,
  },
  chapterRowActive: {
    backgroundColor: VoidColors.luminousGreen,
  },
  chapterRowTitle: {
    flex: 1,
    fontSize: 14,
    color: VoidColors.mutedAsh,
    marginRight: 12,
  },
  chapterRowTitleActive: {
    color: VoidColors.void,
    fontWeight: '800',
  },
  chapterRowTime: {
    fontSize: 12,
    color: VoidColors.mutedAsh,
    fontVariant: ['tabular-nums'],
  },
  chapterRowTimeActive: {
    color: VoidColors.void,
    fontWeight: '700',
  },
});
