// Visual indicator for a book's sync state, overlaid on the cover art.
//
// - `partial`    — L0 only, L1 not started. Soft static ring.
// - `processing` — L1 in flight. Pulsing halo + progress arc for completed chapters.
// - `complete`   — full sync. Briefly flashes then hides itself (parent decides).
// - `failed`     — static warning ring.
//
// Respects the reduce-motion accessibility setting: when enabled the pulse is
// replaced with a steady opacity so the badge stays informative but calm.

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  AccessibilityInfo,
} from 'react-native';
import { AlignmentStatus } from '@/types/sync';

interface Props {
  status: AlignmentStatus;
  /** Fraction 0..1 of chapters that have anchors (drives the ring fill). */
  progress?: number;
  /** Tap opens the SyncStatusSheet. Disables haptic-like feedback when absent. */
  onPress?: () => void;
  /** Optional badge size; defaults to 28. */
  size?: number;
}

const STATUS_COLORS: Record<AlignmentStatus, string> = {
  pending: 'rgba(255,255,255,0.35)',
  partial: '#A8C8F0',
  processing: '#6FA8E8',
  complete: '#68D391',
  failed: '#F56565',
};

export default function SyncBadge({
  status,
  progress = 0,
  onPress,
  size = 28,
}: Props) {
  const pulseRef = useRef(new Animated.Value(0));
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) reduceMotionRef.current = enabled;
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'processing' || reduceMotionRef.current) {
      pulseRef.current.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseRef.current, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseRef.current, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status]);

  const color = STATUS_COLORS[status];
  const scale = pulseRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.15],
  });
  const opacity = pulseRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0.0],
  });

  const percent = Math.max(0, Math.min(1, progress));
  const ringStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: color,
  };

  const glyph = glyphForStatus(status);

  const content = (
    <View style={styles.container}>
      {status === 'processing' && (
        <Animated.View
          style={[
            styles.halo,
            ringStyle,
            { opacity, transform: [{ scale }] },
          ]}
        />
      )}
      <View style={[styles.ring, ringStyle]}>
        <ProgressArc size={size} percent={percent} color={color} />
        <Text style={[styles.glyph, { color }]}>{glyph}</Text>
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(status, percent)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {content}
    </TouchableOpacity>
  );
}

/**
 * Inner progress arc. Implemented as a stack of quarter-wedges (no SVG
 * dependency) — good enough for a 28 px badge and keeps the bundle small.
 */
function ProgressArc({
  size,
  percent,
  color,
}: {
  size: number;
  percent: number;
  color: string;
}) {
  const wedges = 16;
  const filled = Math.round(percent * wedges);
  const radius = size / 2;
  const dotSize = 3;
  return (
    <View
      style={{
        position: 'absolute',
        width: size,
        height: size,
      }}
      pointerEvents="none"
    >
      {Array.from({ length: wedges }).map((_, i) => {
        const angle = (i / wedges) * Math.PI * 2 - Math.PI / 2;
        const x = radius + Math.cos(angle) * (radius - 2) - dotSize / 2;
        const y = radius + Math.sin(angle) * (radius - 2) - dotSize / 2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: i < filled ? color : 'transparent',
            }}
          />
        );
      })}
    </View>
  );
}

function glyphForStatus(status: AlignmentStatus): string {
  switch (status) {
    case 'complete':
      return '✓';
    case 'failed':
      return '!';
    case 'pending':
      return '…';
    default:
      return '';
  }
}

function accessibilityLabel(status: AlignmentStatus, percent: number): string {
  switch (status) {
    case 'complete':
      return 'Sync complete';
    case 'failed':
      return 'Sync failed';
    case 'pending':
      return 'Sync queued';
    case 'processing':
      return `Syncing, ${Math.round(percent * 100)} percent`;
    default:
      return 'Sync partial';
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    borderWidth: 2,
  },
  ring: {
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 14,
    fontWeight: '700',
  },
});
