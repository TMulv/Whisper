import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export default function NetworkStatusBanner() {
  const { isConnected, isFlushing } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-56)).current;

  const visible = !isConnected || isFlushing;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -56,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  const label = isFlushing
    ? 'Syncing...'
    : 'No internet — changes will sync when reconnected';

  const backgroundColor = isFlushing ? '#1565C0' : '#B71C1C';

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: insets.top, backgroundColor, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
