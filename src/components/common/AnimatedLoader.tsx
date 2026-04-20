import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from 'react-native';

// ── ONLY NY-inspired palette (flat, earthy, screen-printed) ─────────────────
const P = {
  cream: '#F0E6D4',
  parchment: '#E8DFC8',
  hunter: '#2E4A35',
  olive: '#6B7348',
  mustard: '#D4A94E',
  gold: '#C9A96E',
  brick: '#B4463A',
  navy: '#1A2438',
  ink: '#0F0F1A',
  charcoal: '#2B2B36',
};

export type ConcreteVariant =
  | 'page-turn'      // 1. open book, page flipping
  | 'stacked-books'  // 2. books stacking up
  | 'bookmark'       // 3. bookmark ribbon dropping in
  | 'glasses'        // 4. reading glasses, pupils scanning
  | 'stamp'          // 5. library stamp slamming down
  | 'flap-counter'   // 6. split-flap page counter
  | 'typing-lines'   // 7. lines of text typing in
  | 'spine-shelf'    // 8. book spines filling a shelf
  | 'magnifier'      // 9. magnifying glass crossing text
  | 'audio-book';    // 10. open book with sound waves

export type LoaderVariant = ConcreteVariant | 'random';

const ALL_VARIANTS: ConcreteVariant[] = [
  'page-turn', 'stacked-books', 'bookmark', 'glasses', 'stamp',
  'flap-counter', 'typing-lines', 'spine-shelf', 'magnifier', 'audio-book',
];

interface LoaderProps {
  variant?: LoaderVariant;
  color?: string;
  accent?: string;
  size?: number;
  message?: string;
  style?: ViewStyle;
}

export function AnimatedLoader({
  variant = 'random',
  color = P.gold,
  accent = P.cream,
  size = 72,
  message,
  style,
}: LoaderProps) {
  const resolved = useRef<ConcreteVariant>(
    variant === 'random' ? ALL_VARIANTS[Math.floor(Math.random() * ALL_VARIANTS.length)] : variant,
  ).current;
  const Comp = VARIANTS[resolved];
  return (
    <View style={[styles.wrap, style]}>
      <Comp color={color} accent={accent} size={size} />
      {message ? (
        <Text style={[styles.msg, { color }]} numberOfLines={1}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAGE TURN — open book with a page flipping over the spine
// ═══════════════════════════════════════════════════════════════════════════
function PageTurn({ color, accent, size }: VariantProps) {
  const flip = useLoop(1500, { easing: Easing.inOut(Easing.cubic), tail: 260 });
  const hover = useLoop(1800, { easing: Easing.inOut(Easing.sin), yoyo: true });

  const rotateY = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-168deg'] });
  const translateY = hover.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  const w = size * 1.5;
  const h = size;
  const pageW = w / 2 - 2;

  return (
    <Animated.View style={[s.bookWrap, { width: w, height: h, transform: [{ translateY }] }]}>
      <View style={[s.bookCover, { width: w, height: h, backgroundColor: color }]} />
      <View style={[s.bookPage, s.bookPageL, { width: pageW, height: h - 8, backgroundColor: accent }]}>
        {[0.8, 0.55, 0.7, 0.5].map((w, i) => (
          <View key={i} style={[s.textLine, { width: `${w * 100}%`, backgroundColor: color }]} />
        ))}
      </View>
      <View style={[s.bookPage, s.bookPageR, { width: pageW, height: h - 8, backgroundColor: accent }]}>
        {[0.7, 0.85, 0.5].map((w, i) => (
          <View key={i} style={[s.textLine, { width: `${w * 100}%`, backgroundColor: color, opacity: 0.6 }]} />
        ))}
      </View>
      <View style={[s.spine, { height: h, backgroundColor: color }]} />
      <Animated.View
        style={[
          s.flipPage,
          {
            width: pageW,
            height: h - 8,
            backgroundColor: accent,
            left: w / 2 + 1,
            transform: [{ perspective: 700 }, { rotateY }],
          },
        ]}
      >
        <View style={[s.textLine, { width: '75%', backgroundColor: color }]} />
        <View style={[s.textLine, { width: '60%', backgroundColor: color }]} />
        <View style={[s.textLine, { width: '80%', backgroundColor: color }]} />
      </Animated.View>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. STACKED BOOKS — three books dropping in, stacking up
// ═══════════════════════════════════════════════════════════════════════════
function StackedBooks({ color, accent, size }: VariantProps) {
  const a = useStaggered(3, 1400, 160);
  const palette = [P.brick, P.mustard, P.hunter];
  const bookH = size * 0.22;
  const bookW = size * 1.4;

  return (
    <View style={{ width: bookW + 16, height: size * 1.1, justifyContent: 'flex-end', alignItems: 'center' }}>
      {a.map((v, i) => {
        const translateY = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-size * 1.2, 4, 0] });
        const rotate = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-8deg', '3deg', '0deg'] });
        const opacity = v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] });
        const offset = [0, -4, 3][i];
        return (
          <Animated.View
            key={i}
            style={{
              width: bookW + offset * 2,
              height: bookH,
              backgroundColor: palette[i],
              marginTop: i === 0 ? 0 : 3,
              borderWidth: 2,
              borderColor: P.ink,
              transform: [{ translateY }, { rotate }],
              opacity,
              justifyContent: 'center',
              paddingHorizontal: 10,
            }}
          >
            <View style={{ height: 2, width: '30%', backgroundColor: P.cream, opacity: 0.7 }} />
          </Animated.View>
        );
      })}
      <View style={{ width: bookW + 24, height: 3, backgroundColor: color, marginTop: 2 }} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. BOOKMARK — ribbon dropping into a book
// ═══════════════════════════════════════════════════════════════════════════
function Bookmark({ color, accent, size }: VariantProps) {
  const drop = useLoop(1800, { easing: Easing.bounce, tail: 300 });
  const translateY = drop.interpolate({ inputRange: [0, 0.7, 1], outputRange: [-size * 1.1, 0, 0] });

  const bookW = size * 1.2;
  const bookH = size;
  const ribbonW = size * 0.26;

  return (
    <View style={{ width: bookW + 40, height: size * 1.4, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: bookW, height: bookH, backgroundColor: accent, borderWidth: 2, borderColor: P.ink, justifyContent: 'space-evenly', padding: 10, overflow: 'hidden' }}>
        {[0.8, 0.6, 0.75, 0.5, 0.7].map((w, i) => (
          <View key={i} style={{ height: 2, width: `${w * 100}%`, backgroundColor: P.ink, opacity: 0.65 }} />
        ))}
      </View>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: bookW * 0.18,
          width: ribbonW,
          alignItems: 'center',
          transform: [{ translateY }],
        }}
      >
        <View style={{ width: ribbonW, height: size * 1.05, backgroundColor: P.brick, borderWidth: 2, borderColor: P.ink, borderBottomWidth: 0 }} />
        {/* Swallowtail: two rotated squares form the V-cut at the bottom */}
        <View style={{ flexDirection: 'row', marginTop: -ribbonW * 0.35 }}>
          <View style={{ width: ribbonW * 0.72, height: ribbonW * 0.72, backgroundColor: P.brick, borderWidth: 2, borderColor: P.ink, transform: [{ rotate: '45deg' }], marginRight: -ribbonW * 0.51 }} />
        </View>
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. GLASSES — reading glasses, pupils scanning across
// ═══════════════════════════════════════════════════════════════════════════
function Glasses({ color, accent, size }: VariantProps) {
  const scan = useLoop(2400, { easing: Easing.inOut(Easing.quad), yoyo: true });
  const pupilX = scan.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] });

  const lensD = size * 0.6;
  const pupilD = size * 0.16;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', width: size * 1.8, height: lensD + 10 }}>
      <Lens d={lensD} color={color} pupilX={pupilX} pupilD={pupilD} />
      <View style={{ width: size * 0.12, height: 3, backgroundColor: color, marginTop: -lensD * 0.1 }} />
      <Lens d={lensD} color={color} pupilX={pupilX} pupilD={pupilD} />
    </View>
  );
}

function Lens({ d, color, pupilX, pupilD }: { d: number; color: string; pupilX: Animated.AnimatedInterpolation<number>; pupilD: number }) {
  return (
    <View style={{ width: d, height: d, borderRadius: d / 2, borderWidth: 3, borderColor: color, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
      <Animated.View
        style={{
          width: pupilD,
          height: pupilD,
          borderRadius: pupilD / 2,
          backgroundColor: color,
          transform: [{ translateX: pupilX }],
        }}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. STAMP — library date stamp slamming down
// ═══════════════════════════════════════════════════════════════════════════
function Stamp({ color, accent, size }: VariantProps) {
  const slam = useLoop(1600, { easing: Easing.out(Easing.back(2)), tail: 500 });
  const translateY = slam.interpolate({ inputRange: [0, 0.5, 0.7, 1], outputRange: [-size * 0.5, -size * 0.5, 0, 0] });
  const scale = slam.interpolate({ inputRange: [0, 0.5, 0.62, 0.8, 1], outputRange: [1, 1, 1.08, 1, 1] });
  const impressionOpacity = slam.interpolate({ inputRange: [0, 0.7, 0.75, 1], outputRange: [0, 0, 1, 1] });
  const rotate = slam.interpolate({ inputRange: [0, 0.5, 0.75, 1], outputRange: ['-6deg', '-6deg', '-3deg', '-3deg'] });

  const stampW = size * 1.1;
  const stampH = size * 0.55;

  return (
    <View style={{ width: size * 1.6, height: size * 1.3, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Ink impression left behind */}
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 6,
          width: stampW * 0.9,
          height: stampH * 0.9,
          borderWidth: 2.5,
          borderColor: P.brick,
          borderRadius: 4,
          opacity: impressionOpacity,
          transform: [{ rotate: '-3deg' }],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: P.brick, fontSize: stampH * 0.18, fontWeight: '900', letterSpacing: 3 }}>
          RETURNED
        </Text>
      </Animated.View>
      {/* The stamp itself */}
      <Animated.View style={{ transform: [{ translateY }, { scale }, { rotate }], alignItems: 'center' }}>
        <View style={{ width: stampW, height: stampH, backgroundColor: color, borderWidth: 2, borderColor: P.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: P.ink, fontSize: stampH * 0.2, fontWeight: '900', letterSpacing: 3 }}>
            LIBRARY
          </Text>
        </View>
        <View style={{ width: stampW * 0.4, height: stampH * 0.35, backgroundColor: color, borderWidth: 2, borderColor: P.ink, borderTopWidth: 0, marginTop: -2 }} />
        <View style={{ width: stampW * 0.18, height: stampH * 0.25, backgroundColor: P.charcoal, borderWidth: 2, borderColor: P.ink, borderTopWidth: 0, marginTop: -2 }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. FLAP COUNTER — split-flap page counter
// ═══════════════════════════════════════════════════════════════════════════
function FlapCounter({ color, accent, size }: VariantProps) {
  const tick = useLoop(800, { easing: Easing.in(Easing.cubic), tail: 0 });
  const counter = useRef({ digits: [0, 0] }).current;
  const [display, setDisplay] = React.useState('00');

  useEffect(() => {
    const id = setInterval(() => {
      const next = (parseInt(display, 10) + 1) % 100;
      setDisplay(next.toString().padStart(2, '0'));
    }, 850);
    return () => clearInterval(id);
  }, [display]);

  const rotate = tick.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });
  const flapH = size * 0.7;
  const flapW = size * 0.5;

  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {display.split('').map((d, i) => (
        <View key={i} style={{ width: flapW, height: flapH, backgroundColor: P.ink, borderWidth: 2, borderColor: color, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
          {/* center gap line */}
          <View style={{ position: 'absolute', top: flapH / 2 - 1, left: 0, right: 0, height: 2, backgroundColor: color, zIndex: 2 }} />
          {/* the digit */}
          <Text style={{ color, fontSize: flapH * 0.65, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{d}</Text>
          {/* flipping leaf */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: flapH / 2,
              backgroundColor: P.ink,
              borderBottomWidth: 1,
              borderBottomColor: color,
              transformOrigin: 'bottom',
              transform: [{ perspective: 400 }, { rotateX: rotate }],
              alignItems: 'center',
              justifyContent: 'flex-end',
              overflow: 'hidden',
            }}
          >
            <Text style={{ color, fontSize: flapH * 0.65, fontWeight: '900', marginBottom: -flapH * 0.17 }}>{d}</Text>
          </Animated.View>
        </View>
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. TYPING LINES — open book with lines typing in left→right
// ═══════════════════════════════════════════════════════════════════════════
function TypingLines({ color, accent, size }: VariantProps) {
  const lineWidths = [0.82, 0.65, 0.78, 0.55, 0.7];
  const anims = useStaggered(lineWidths.length, 2200, 200);
  const bookW = size * 1.4;
  const bookH = size;

  return (
    <View style={{ width: bookW + 20, height: bookH + 16, backgroundColor: accent, borderWidth: 2, borderColor: color, padding: 12, justifyContent: 'space-evenly' }}>
      {anims.map((v, i) => {
        const width = v.interpolate({ inputRange: [0, 0.6, 1], outputRange: ['0%', `${lineWidths[i] * 100}%`, `${lineWidths[i] * 100}%`] });
        return (
          <Animated.View
            key={i}
            style={{
              height: 3,
              width: width as unknown as Animated.AnimatedInterpolation<string>,
              backgroundColor: color,
            }}
          />
        );
      })}
      {/* tiny typing cursor */}
      <View style={{ position: 'absolute', bottom: 14, left: 14, width: 2, height: 6, backgroundColor: P.brick }} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. SPINE SHELF — vertical book spines filling a shelf
// ═══════════════════════════════════════════════════════════════════════════
function SpineShelf({ color, accent, size }: VariantProps) {
  const count = 6;
  const anims = useStaggered(count, 2000, 140);
  const colors = [P.brick, P.hunter, P.mustard, P.olive, color, P.cream];
  const spineH = size;
  const spineW = size * 0.18;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: spineH, gap: 3 }}>
        {anims.map((v, i) => {
          const h = v.interpolate({ inputRange: [0, 1], outputRange: [0, spineH] });
          return (
            <Animated.View
              key={i}
              style={{
                width: spineW,
                height: h,
                backgroundColor: colors[i % colors.length],
                borderWidth: 1.5,
                borderColor: P.ink,
              }}
            >
              <View style={{ height: 2, width: '55%', backgroundColor: P.ink, marginTop: 8, alignSelf: 'center', opacity: 0.5 }} />
            </Animated.View>
          );
        })}
      </View>
      <View style={{ width: (spineW + 3) * count + 14, height: 5, backgroundColor: color, marginTop: 2 }} />
      <View style={{ width: (spineW + 3) * count, height: 2, backgroundColor: color, opacity: 0.4, marginTop: 2 }} />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. MAGNIFIER — magnifying glass traveling across lines of text
// ═══════════════════════════════════════════════════════════════════════════
function Magnifier({ color, accent, size }: VariantProps) {
  const travel = useLoop(2600, { easing: Easing.inOut(Easing.cubic), yoyo: true });
  const pageW = size * 1.6;
  const pageH = size * 1.1;
  const glassD = size * 0.55;

  const translateX = travel.interpolate({ inputRange: [0, 1], outputRange: [0, pageW - glassD - 20] });
  const translateY = travel.interpolate({
    inputRange: [0, 0.33, 0.66, 1],
    outputRange: [8, pageH * 0.35, pageH * 0.6, pageH * 0.6],
  });

  return (
    <View style={{ width: pageW, height: pageH, backgroundColor: accent, borderWidth: 2, borderColor: color, padding: 14, justifyContent: 'space-evenly', overflow: 'hidden' }}>
      {[0.85, 0.6, 0.78, 0.55, 0.7].map((w, i) => (
        <View key={i} style={{ height: 2.5, width: `${w * 100}%`, backgroundColor: color, opacity: 0.7 }} />
      ))}
      <Animated.View
        style={{
          position: 'absolute',
          top: 6,
          left: 10,
          transform: [{ translateX }, { translateY }],
        }}
      >
        <View style={{ width: glassD, height: glassD, borderRadius: glassD / 2, borderWidth: 3, borderColor: P.ink, backgroundColor: 'rgba(180,70,58,0.18)' }} />
        <View style={{ position: 'absolute', bottom: -glassD * 0.35, right: -glassD * 0.1, width: 4, height: glassD * 0.5, backgroundColor: P.ink, transform: [{ rotate: '40deg' }] }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. AUDIO BOOK — open book with sound waves emanating
// ═══════════════════════════════════════════════════════════════════════════
function AudioBook({ color, accent, size }: VariantProps) {
  const waves = useStaggered(3, 1800, 360, { loopDelay: 0 });
  const bob = useLoop(1600, { easing: Easing.inOut(Easing.sin), yoyo: true });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  const bookW = size * 0.9;
  const bookH = size * 0.6;

  return (
    <View style={{ width: size * 2.2, height: size * 1.3, alignItems: 'center', justifyContent: 'center' }}>
      {/* Sound waves — concentric arcs radiating out */}
      {waves.map((v, i) => {
        const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] });
        const opacity = v.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 0.1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: bookW * 1.1,
              height: bookH * 1.5,
              borderRadius: bookW,
              borderWidth: 2.5,
              borderColor: P.mustard,
              opacity,
              transform: [{ scale }],
            }}
          />
        );
      })}
      {/* Book (open, centered) */}
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateY }] }}>
        <View style={[s.audioPage, { width: bookW / 2, height: bookH, backgroundColor: accent, borderColor: color, transform: [{ rotate: '-4deg' }], marginRight: -2 }]}>
          {[0.7, 0.8, 0.5].map((w, i) => (
            <View key={i} style={{ height: 2, width: `${w * 100}%`, backgroundColor: color, opacity: 0.6 }} />
          ))}
        </View>
        <View style={[s.audioPage, { width: bookW / 2, height: bookH, backgroundColor: accent, borderColor: color, transform: [{ rotate: '4deg' }] }]}>
          {[0.65, 0.8, 0.55].map((w, i) => (
            <View key={i} style={{ height: 2, width: `${w * 100}%`, backgroundColor: color, opacity: 0.6 }} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Hooks & helpers
// ═══════════════════════════════════════════════════════════════════════════
type VariantProps = { color: string; accent: string; size: number };

const VARIANTS: Record<ConcreteVariant, React.FC<VariantProps>> = {
  'page-turn': PageTurn,
  'stacked-books': StackedBooks,
  bookmark: Bookmark,
  glasses: Glasses,
  stamp: Stamp,
  'flap-counter': FlapCounter,
  'typing-lines': TypingLines,
  'spine-shelf': SpineShelf,
  magnifier: Magnifier,
  'audio-book': AudioBook,
};

function useLoop(
  duration: number,
  opts: { easing?: (v: number) => number; tail?: number; yoyo?: boolean } = {},
): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const seq = opts.yoyo
      ? Animated.sequence([
          Animated.timing(value, { toValue: 1, duration, easing: opts.easing, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration, easing: opts.easing, useNativeDriver: true }),
        ])
      : Animated.sequence([
          Animated.timing(value, { toValue: 1, duration, easing: opts.easing, useNativeDriver: true }),
          Animated.delay(opts.tail ?? 0),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]);
    const loop = Animated.loop(seq);
    loop.start();
    return () => loop.stop();
  }, [value, duration, opts.easing, opts.tail, opts.yoyo]);
  return value;
}

function useStaggered(
  count: number,
  duration: number,
  stagger: number,
  opts: { loopDelay?: number } = {},
): Animated.Value[] {
  const values = useMemo(() => Array.from({ length: count }, () => new Animated.Value(0)), [count]);
  useEffect(() => {
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * stagger),
          Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.delay(opts.loopDelay ?? (count * stagger - i * stagger) + 100),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values, duration, stagger, opts.loopDelay, count]);
  return values;
}

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  msg: {
    marginTop: 22,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
});

const s = StyleSheet.create({
  bookWrap: { alignItems: 'center', justifyContent: 'center' },
  bookCover: { position: 'absolute', top: 2, left: 0 },
  bookPage: {
    position: 'absolute',
    top: 4,
    borderWidth: 2,
    justifyContent: 'space-evenly',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  bookPageL: { left: 2, borderRightWidth: 0, borderColor: P.ink },
  bookPageR: { right: 2, borderLeftWidth: 0, borderColor: P.ink },
  spine: { position: 'absolute', width: 3, top: 0, left: '50%', marginLeft: -1.5, backgroundColor: P.ink },
  flipPage: {
    position: 'absolute',
    top: 4,
    borderWidth: 2,
    borderColor: P.ink,
    borderLeftWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 6,
    justifyContent: 'space-evenly',
    transformOrigin: 'left center',
  },
  textLine: { height: 2.5, marginVertical: 2 },

  audioPage: {
    borderWidth: 2,
    padding: 6,
    justifyContent: 'space-evenly',
  },
});

export { P as PALETTE };
