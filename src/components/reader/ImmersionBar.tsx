import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import { EpubTheme } from '@/components/reader/EpubWebView';
import { M4BChapter } from '@/types/sync';
import { formatDuration } from '@/utils/timeUtils';
import {
  play,
  pause,
  seekToTimestamp,
  skipForward,
  skipBackward,
  setRate,
} from '@/services/audio/trackPlayerService';

const RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

interface Props {
  theme: EpubTheme;
  isPlaying: boolean;
  position: number;
  duration: number;
  currentChapter: M4BChapter | null;
  chapters: M4BChapter[];
  playbackRate: number;
  onRateChange: (rate: number) => void;
  onClose: () => void;
}

export default function ImmersionBar({
  theme,
  isPlaying,
  position,
  duration,
  currentChapter,
  chapters,
  playbackRate,
  onRateChange,
  onClose,
}: Props) {
  const isDark = theme === 'dark';
  const bg = isDark ? '#0D0D1A' : theme === 'sepia' ? '#3b2a1a' : '#1A1A2E';
  const fg = '#ffffff';
  const dim = 'rgba(255,255,255,0.55)';

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const cycleRate = useCallback(() => {
    const idx = RATES.indexOf(playbackRate);
    const next = RATES[(idx + 1) % RATES.length];
    setRate(next);
    onRateChange(next);
  }, [playbackRate, onRateChange]);

  const handlePrevChapter = useCallback(() => {
    if (!currentChapter || chapters.length === 0) return;
    const prev = chapters.find((c) => c.index === currentChapter.index - 1);
    if (prev) seekToTimestamp(prev.startSeconds);
  }, [currentChapter, chapters]);

  const handleNextChapter = useCallback(() => {
    if (!currentChapter || chapters.length === 0) return;
    const next = chapters.find((c) => c.index === currentChapter.index + 1);
    if (next) seekToTimestamp(next.startSeconds);
  }, [currentChapter, chapters]);

  // Scrubber interaction
  const scrubWidthRef = React.useRef(1);

  const handleScrubLayout = useCallback((e: any) => {
    scrubWidthRef.current = e.nativeEvent.layout.width || 1;
  }, []);

  const handleScrubRelease = useCallback((e: GestureResponderEvent) => {
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubWidthRef.current));
    seekToTimestamp(ratio * duration);
  }, [duration]);

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Chapter name + close */}
      <View style={styles.headerRow}>
        <Text style={[styles.chapterLabel, { color: dim }]} numberOfLines={1}>
          {currentChapter?.title ?? ''}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.closeBtn, { color: dim }]}>✕ Exit</Text>
        </TouchableOpacity>
      </View>

      {/* Scrubber */}
      <View
        style={styles.scrubberTrack}
        onLayout={handleScrubLayout}
        onStartShouldSetResponder={() => true}
        onResponderRelease={handleScrubRelease}
      >
        <View style={[styles.scrubberBg, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
        <View style={[styles.scrubberFill, { width: `${progress * 100}%` as any, backgroundColor: fg }]} />
      </View>

      {/* Time */}
      <View style={styles.timeRow}>
        <Text style={[styles.timeText, { color: dim }]}>{formatDuration(position)}</Text>
        <Text style={[styles.timeText, { color: dim }]}>-{formatDuration(Math.max(0, duration - position))}</Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.speedBtn} onPress={cycleRate}>
          <Text style={[styles.speedLabel, { color: fg }]}>
            {playbackRate === 1.0 ? '1×' : `${playbackRate}×`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={handlePrevChapter}>
          <Text style={[styles.ctrlIcon, { color: fg }]}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={() => skipBackward(30)}>
          <Text style={[styles.ctrlIcon, { color: fg }]}>↺</Text>
          <Text style={[styles.ctrlSub, { color: dim }]}>30</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.playBtn, { backgroundColor: fg }]}
          onPress={isPlaying ? pause : play}
        >
          <Text style={[styles.playIcon, { color: bg }]}>{isPlaying ? '⏸' : '▶'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={() => skipForward(30)}>
          <Text style={[styles.ctrlIcon, { color: fg }]}>↻</Text>
          <Text style={[styles.ctrlSub, { color: dim }]}>30</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={handleNextChapter}>
          <Text style={[styles.ctrlIcon, { color: fg }]}>⏭</Text>
        </TouchableOpacity>

        {/* Spacer to balance speed button */}
        <View style={styles.speedBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 12,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  chapterLabel: {
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  closeBtn: {
    fontSize: 12,
    fontWeight: '600',
  },

  scrubberTrack: {
    height: 20,
    justifyContent: 'center',
    marginBottom: 2,
  },
  scrubberBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
  },

  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  speedBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedLabel: {
    fontSize: 13,
    fontWeight: '700',
  },

  ctrlBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlIcon: {
    fontSize: 20,
  },
  ctrlSub: {
    fontSize: 9,
    position: 'absolute',
    bottom: 4,
  },

  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  playIcon: {
    fontSize: 22,
    marginLeft: 2,
  },
});
