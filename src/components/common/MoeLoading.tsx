import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { VoidColors, VoidFonts, VoidWeight } from '@/constants/voidTheme';

interface Props {
  variant?: 'standing' | 'walking';
  message?: string;
  size?: 'small' | 'large';
}

export default function MoeLoading({
  variant = 'standing',
  message,
  size = 'large',
}: Props) {
  const videoSource =
    variant === 'standing' ? require('../../../assets/moe-standing.webm') : require('../../../assets/moe-walking.webm');

  const isSmall = size === 'small';
  const videoSize = isSmall ? 160 : 240;

  return (
    <View style={styles.container}>
      <Video
        source={videoSource}
        style={[styles.video, { width: videoSize, height: videoSize }]}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isLooping
        isMuted
      />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  video: {
    marginBottom: 16,
  },
  message: {
    fontSize: 14,
    color: VoidColors.mutedAsh,
    textAlign: 'center',
    maxWidth: 240,
    fontWeight: VoidWeight.medium,
    letterSpacing: 0.3,
  },
});
