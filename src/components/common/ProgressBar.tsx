import React from 'react';
import { View, StyleSheet } from 'react-native';

interface Props {
  progress: number; // 0.0 to 1.0
  height?: number;
  backgroundColor?: string;
  fillColor?: string;
}

export default function ProgressBar({
  progress,
  height = 4,
  backgroundColor = '#E0E0E0',
  fillColor = '#1A1A2E',
}: Props) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View style={[styles.track, { height, backgroundColor }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: fillColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: 99, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: 99 },
});
