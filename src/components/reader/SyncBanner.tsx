import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { formatDuration } from '@/utils/timeUtils';

interface Props {
  audioTimestamp: number;  // seconds
  onResume: () => void;
  onDismiss: () => void;
}

export default function SyncBanner({ audioTimestamp, onResume, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [slideAnim]);

  const dismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -80,
      duration: 220,
      useNativeDriver: true,
    }).start(onDismiss);
  };

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.content}>
        <View style={styles.textBlock}>
          <Text style={styles.label}>Audio paused at {formatDuration(audioTimestamp)}</Text>
          <Text style={styles.sub}>Resume reading from that position?</Text>
        </View>
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.yesBtn} onPress={onResume} activeOpacity={0.8}>
            <Text style={styles.yesBtnText}>Jump there</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.noBtn} onPress={dismiss} activeOpacity={0.8}>
            <Text style={styles.noBtnText}>Keep reading</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: '#1A1A2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  textBlock: { flex: 1 },
  label: { color: '#fff', fontSize: 13, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 8 },
  yesBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  yesBtnText: { color: '#1A1A2E', fontSize: 13, fontWeight: '700' },
  noBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  noBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
});
