import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ModeToggle from './ModeToggle';
import type { BookSessionMode } from '@/navigation/types';

const ENTRY_SHOW_MS = 3000;
const AUTO_HIDE_MS = 4000;
const FADE_MS = 180;

export interface ReaderChromeProps {
  mode: BookSessionMode;
  showToggle: boolean;
  bgColor: string;
  textColor: string;
  onSwitchMode: (next: BookSessionMode) => void;
  onClose: () => void;
  onOpenMenu: () => void;
}

export interface ReaderChromeRef {
  reveal: () => void;
}

const ReaderChrome = forwardRef<ReaderChromeRef, ReaderChromeProps>(function ReaderChrome(
  { mode, showToggle, bgColor, textColor, onSwitchMode, onClose, onOpenMenu },
  ref,
) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const visibleRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const hide = () => {
    clearHideTimer();
    visibleRef.current = false;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
  };

  const scheduleAutoHide = (delayMs: number) => {
    clearHideTimer();
    hideTimer.current = setTimeout(hide, delayMs);
  };

  const reveal = () => {
    visibleRef.current = true;
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
    scheduleAutoHide(AUTO_HIDE_MS);
  };

  useImperativeHandle(ref, () => ({ reveal }), []);

  useEffect(() => {
    visibleRef.current = true;
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
    scheduleAutoHide(ENTRY_SHOW_MS);
    return clearHideTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bumpTimer = () => {
    if (visibleRef.current) scheduleAutoHide(AUTO_HIDE_MS);
  };

  return (
    <>
      <Pressable
        style={[styles.topEdgeStrip, { top: insets.top }]}
        onPress={reveal}
        accessibilityLabel="Reveal reader controls"
      />
      <Pressable
        style={[styles.cornerTarget, { top: insets.top }]}
        onPress={reveal}
        accessibilityLabel="Reveal reader menu"
      />

      <Animated.View
        pointerEvents={visibleRef.current ? 'auto' : 'none'}
        style={[
          styles.chrome,
          {
            paddingTop: insets.top + 6,
            backgroundColor: bgColor,
            opacity,
          },
        ]}
        onTouchStart={bumpTimer}
      >
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close book"
          accessibilityRole="button"
        >
          <Text style={[styles.icon, { color: textColor }]}>✕</Text>
        </TouchableOpacity>

        <View style={styles.toggleSlot}>
          {showToggle && (
            <ModeToggle mode={mode} onChange={onSwitchMode} outOfSync={false} />
          )}
        </View>

        {mode === 'read' ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onOpenMenu}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Open reader menu"
            accessibilityRole="button"
          >
            <Text style={[styles.icon, { color: textColor }]}>⋯</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </Animated.View>
    </>
  );
});

export default ReaderChrome;

const styles = StyleSheet.create({
  topEdgeStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 72,
    zIndex: 20,
  },
  cornerTarget: {
    position: 'absolute',
    right: 0,
    width: 60,
    height: 60,
    zIndex: 21,
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    opacity: 0.95,
    zIndex: 100,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '500',
  },
  toggleSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
