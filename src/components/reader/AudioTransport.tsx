import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
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
  isPlaying: boolean;
  position: number;
  duration: number;
  currentChapter: M4BChapter | null;
  chapters: M4BChapter[];
  playbackRate: number;
  onRateChange: (rate: number) => void;
}

export default function AudioTransport({
  isPlaying,
  position,
  duration,
  currentChapter,
  chapters,
  playbackRate,
  onRateChange,
}: Props) {
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

  const scrubWidthRef = React.useRef(1);

  const handleScrubLayout = useCallback((e: any) => {
    scrubWidthRef.current = e.nativeEvent.layout.width || 1;
  }, []);

  const handleScrubRelease = useCallback((e: GestureResponderEvent) => {
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / scrubWidthRef.current));
    seekToTimestamp(ratio * duration);
  }, [duration]);

  return (
    <View style={styles.container}>
      {/* Chapter name */}
      <Text style={styles.chapterLabel} numberOfLines={1}>
        {currentChapter?.title ?? ''}
      </Text>

      {/* Scrubber */}
      <View
        style={styles.scrubberTrack}
        onLayout={handleScrubLayout}
        onStartShouldSetResponder={() => true}
        onResponderRelease={handleScrubRelease}
      >
        <View style={styles.scrubberBg} />
        <View style={[styles.scrubberFill, { width: `${progress * 100}%` as any }]} />
      </View>

      {/* Time */}
      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatDuration(position)}</Text>
        <Text style={styles.timeText}>-{formatDuration(Math.max(0, duration - position))}</Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.speedBtn} onPress={cycleRate}>
          <Text style={styles.speedLabel}>
            {playbackRate === 1.0 ? '1×' : `${playbackRate}×`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={handlePrevChapter}>
          <Text style={styles.ctrlIcon}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={() => skipBackward(30)}>
          <Text style={styles.ctrlIcon}>↺</Text>
          <Text style={styles.ctrlSub}>30</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playBtn}
          onPress={isPlaying ? pause : play}
        >
          <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={() => skipForward(30)}>
          <Text style={styles.ctrlIcon}>↻</Text>
          <Text style={styles.ctrlSub}>30</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.ctrlBtn} onPress={handleNextChapter}>
          <Text style={styles.ctrlIcon}>⏭</Text>
        </TouchableOpacity>

        <View style={styles.speedBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },

  chapterLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
    paddingHorizontal: 4,
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
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#1A1A2E',
  },

  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  timeText: {
    fontSize: 11,
    color: '#888',
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
    color: '#1A1A2E',
  },

  ctrlBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlIcon: {
    fontSize: 20,
    color: '#1A1A2E',
  },
  ctrlSub: {
    fontSize: 9,
    position: 'absolute',
    bottom: 4,
    color: '#888',
  },

  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  playIcon: {
    fontSize: 22,
    marginLeft: 2,
    color: '#fff',
  },
});
