import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from 'react-native';

const GOLD = '#C9A96E';
const GOLD_DIM = '#6A5832';
const INK = '#1A1A2E';
const PAPER = '#F0E6D4';

export type LoaderVariant = 'book' | 'audio' | 'notes';

interface LoaderProps {
  variant?: LoaderVariant;
  color?: string;
  size?: number;
  message?: string;
  style?: ViewStyle;
}

export function AnimatedLoader({
  variant = 'book',
  color = GOLD,
  size = 64,
  message,
  style,
}: LoaderProps) {
  return (
    <View style={[styles.wrap, style]}>
      {variant === 'book' && <PageTurn color={color} size={size} />}
      {variant === 'audio' && <AudioBars color={color} size={size} />}
      {variant === 'notes' && <NoteFloat color={color} size={size} />}
      {message ? <Text style={[styles.msg, { color }]}>{message}</Text> : null}
    </View>
  );
}

// ── Book page-turn ──────────────────────────────────────────────────────────
function PageTurn({ color, size }: { color: string; size: number }) {
  const flip = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flip, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(180),
        Animated.timing(flip, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(120),
      ]),
    );
    const hover = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    hover.start();
    return () => { loop.stop(); hover.stop(); };
  }, [flip, bob]);

  const rotateY = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-170deg'] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });

  const bookW = size * 1.4;
  const bookH = size;
  const pageW = bookW / 2 - 2;
  const pageH = bookH - 6;

  return (
    <Animated.View style={[styles.bookWrap, { width: bookW, height: bookH, transform: [{ translateY }] }]}>
      {/* Back cover shadow */}
      <View style={[styles.cover, { width: bookW, height: bookH, backgroundColor: GOLD_DIM, opacity: 0.35 }]} />

      {/* Left static page */}
      <View style={[styles.pageLeft, { width: pageW, height: pageH, borderColor: color }]}>
        <View style={[styles.line, { backgroundColor: color, opacity: 0.55, width: '70%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.4, width: '85%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.4, width: '60%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.3, width: '75%' }]} />
      </View>

      {/* Right static page */}
      <View style={[styles.pageRight, { width: pageW, height: pageH, borderColor: color }]}>
        <View style={[styles.line, { backgroundColor: color, opacity: 0.4, width: '80%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.3, width: '60%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.35, width: '70%' }]} />
      </View>

      {/* Spine */}
      <View style={[styles.spine, { height: bookH, backgroundColor: color }]} />

      {/* Flipping page — anchored on the spine, rotating from right side to left */}
      <Animated.View
        style={[
          styles.flipPage,
          {
            width: pageW,
            height: pageH,
            borderColor: color,
            backgroundColor: color + '22',
            left: bookW / 2 + 1,
            transform: [{ perspective: 600 }, { rotateY }],
          },
        ]}
      >
        <View style={[styles.line, { backgroundColor: color, opacity: 0.7, width: '75%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.5, width: '60%' }]} />
        <View style={[styles.line, { backgroundColor: color, opacity: 0.6, width: '80%' }]} />
      </Animated.View>
    </Animated.View>
  );
}

// ── Audio equalizer bars with floating note ────────────────────────────────
function AudioBars({ color, size }: { color: string; size: number }) {
  const barsRef = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3)));
  const bars = barsRef.current;
  const noteY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 110),
          Animated.timing(bar, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.25,
            duration: 420,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());

    const noteLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(noteY, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(noteY, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    noteLoop.start();

    return () => { animations.forEach((a) => a.stop()); noteLoop.stop(); };
  }, [bars, noteY]);

  const barW = Math.max(4, Math.round(size * 0.09));
  const gap = Math.max(3, Math.round(size * 0.06));
  const maxH = size;
  const noteTranslate = noteY.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const noteOpacity = noteY.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] });

  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.Text
        style={[
          styles.note,
          {
            color,
            fontSize: Math.round(size * 0.5),
            transform: [{ translateY: noteTranslate }],
            opacity: noteOpacity,
          },
        ]}
      >
        ♪
      </Animated.Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: maxH, marginTop: 6 }}>
        {bars.map((bar, i) => (
          <Animated.View
            key={i}
            style={{
              width: barW,
              marginHorizontal: gap / 2,
              height: bar.interpolate({ inputRange: [0, 1], outputRange: [maxH * 0.15, maxH] }),
              backgroundColor: color,
              borderRadius: barW / 2,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ── Floating music notes ────────────────────────────────────────────────────
function NoteFloat({ color, size }: { color: string; size: number }) {
  const glyphs = ['♪', '♫', '♬'];
  const animsRef = useRef(glyphs.map(() => new Animated.Value(0)));
  const anims = animsRef.current;

  useEffect(() => {
    const loops = anims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 450),
          Animated.timing(v, {
            toValue: 1,
            duration: 1600,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View style={{ width: size * 2, height: size * 1.4, justifyContent: 'flex-end' }}>
      {anims.map((v, i) => {
        const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 1.2] });
        const translateX = v.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, i % 2 === 0 ? 6 : -6, 0],
        });
        const opacity = v.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] });
        const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '10deg'] });
        return (
          <Animated.Text
            key={i}
            style={[
              styles.floatNote,
              {
                color,
                fontSize: Math.round(size * 0.5),
                left: size * 0.3 + i * size * 0.45,
                transform: [{ translateY }, { translateX }, { rotate }],
                opacity,
              },
            ]}
          >
            {glyphs[i]}
          </Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  msg: { marginTop: 18, fontSize: 14, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '500' },

  bookWrap: { alignItems: 'center', justifyContent: 'center' },
  cover: { position: 'absolute', borderRadius: 3, top: 2, left: 0 },
  pageLeft: {
    position: 'absolute',
    top: 3,
    left: 1,
    borderWidth: 1,
    backgroundColor: 'transparent',
    borderRightWidth: 0,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 8,
    justifyContent: 'space-evenly',
  },
  pageRight: {
    position: 'absolute',
    top: 3,
    right: 1,
    borderWidth: 1,
    backgroundColor: 'transparent',
    borderLeftWidth: 0,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 8,
    justifyContent: 'space-evenly',
  },
  spine: { position: 'absolute', width: 2, top: 0, left: '50%', marginLeft: -1 },
  flipPage: {
    position: 'absolute',
    top: 3,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 8,
    justifyContent: 'space-evenly',
    transformOrigin: 'left center',
  },
  line: { height: 1.5, borderRadius: 1, marginVertical: 2 },

  note: { fontWeight: '300' },
  floatNote: { position: 'absolute', bottom: 0, fontWeight: '300' },
});

export { PAPER, GOLD, INK };
