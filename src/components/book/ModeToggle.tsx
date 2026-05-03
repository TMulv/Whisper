import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, LayoutChangeEvent } from 'react-native';
import type { BookSessionMode } from '@/navigation/types';
import { VoidColors } from '@/constants/voidTheme';

interface Props {
  mode: BookSessionMode;
  onChange: (mode: BookSessionMode) => void;
  outOfSync?: boolean;
}

export default function ModeToggle({ mode, onChange, outOfSync = false }: Props) {
  const slide = useRef(new Animated.Value(mode === 'read' ? 0 : 1)).current;
  const segWidth = useRef(0);
  const [, setTick] = React.useState(0);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: mode === 'read' ? 0 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [mode, slide]);

  const onLayoutSegment = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== segWidth.current) {
      segWidth.current = w;
      setTick((t) => t + 1);
    }
  };

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, segWidth.current],
  });

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.activePill,
          {
            width: segWidth.current,
            transform: [{ translateX }],
          },
        ]}
        pointerEvents="none"
      />
      <Pressable
        style={styles.segment}
        onLayout={onLayoutSegment}
        onPress={() => onChange('read')}
        accessibilityRole="button"
        accessibilityLabel="Read mode"
      >
        <Text style={[styles.segText, mode === 'read' && styles.segTextActive]}>📖 Read</Text>
        {mode !== 'read' && outOfSync && <View style={styles.dot} />}
      </Pressable>
      <Pressable
        style={styles.segment}
        onPress={() => onChange('listen')}
        accessibilityRole="button"
        accessibilityLabel="Listen mode"
      >
        <Text style={[styles.segText, mode === 'listen' && styles.segTextActive]}>🎧 Listen</Text>
        {mode !== 'listen' && outOfSync && <View style={styles.dot} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: VoidColors.pureWhite,
    padding: 2,
    position: 'relative',
    minWidth: 180,
  },
  activePill: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: 15,
    backgroundColor: VoidColors.pureWhite,
  },
  segment: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  segText: {
    fontSize: 13,
    fontWeight: '700',
    color: VoidColors.pureWhite,
    letterSpacing: 0.4,
  },
  segTextActive: {
    color: VoidColors.void,
    fontWeight: '800',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: VoidColors.vividCrimson,
    marginLeft: 4,
  },
});
