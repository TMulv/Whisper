import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedLoader, LoaderVariant } from './AnimatedLoader';

interface Props {
  message?: string;
  variant?: LoaderVariant;
  tone?: 'light' | 'dark';
}

export default function LoadingOverlay({ message, variant = 'page-turn', tone = 'light' }: Props) {
  const isDark = tone === 'dark';
  return (
    <View style={[styles.overlay, isDark ? styles.overlayDark : styles.overlayLight]}>
      <AnimatedLoader
        variant={variant}
        color={isDark ? '#C9A96E' : '#1A2438'}
        accent={isDark ? '#F0E6D4' : '#E8DFC8'}
        message={message}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  overlayLight: { backgroundColor: 'rgba(255,255,255,0.9)' },
  overlayDark: { backgroundColor: 'rgba(9,9,15,0.92)' },
});
