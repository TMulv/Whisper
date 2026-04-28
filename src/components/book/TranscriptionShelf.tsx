import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { TranscriptionPhase } from '@/services/sync/assemblyAiAdapter';

interface Props {
  bookId: string;            // seeds deterministic spine layout
  progress: number;          // 0..1
  phase: TranscriptionPhase;
  etaSeconds: number | null;
}

const SPINE_COUNT = 20;
const SHELF_HEIGHT = 110;
const SPINE_BASE_H = 70;
const SPINE_VAR_H = 38;

const PALETTE = [
  '#5B1F1F', // burgundy
  '#3F2814', // chocolate
  '#1F3026', // forest
  '#1A2747', // navy buckram
  '#4A1B36', // oxblood
  '#2D2A1E', // olive
  '#50321A', // tan calf
  '#1B2F3A', // slate blue
  '#5B452A', // honey
  '#2F1A2A', // aubergine
  '#3A1F12', // mahogany
  '#283518', // moss
];

const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X',
               'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface BookSpec {
  flex: number;
  height: number;
  color: string;
  tilt: number;
  tall: boolean;
  roman: string;
}

function buildSpines(bookId: string): BookSpec[] {
  const r = mulberry32(hashSeed(bookId || 'whisper'));
  const out: BookSpec[] = [];
  for (let i = 0; i < SPINE_COUNT; i++) {
    const wRoll = r();
    let flex: number;
    if (wRoll < 0.15) flex = 0.85 + r() * 0.10;
    else if (wRoll > 0.85) flex = 1.35 + r() * 0.20;
    else flex = 0.95 + r() * 0.25;
    const heightRel = 0.40 + r() * 0.60;
    const height = SPINE_BASE_H + heightRel * SPINE_VAR_H;
    const color = PALETTE[Math.floor(r() * PALETTE.length)];
    const tilt = r() < 0.12 ? (r() < 0.5 ? -1 : 1) * (0.6 + r() * 1.0) : 0;
    const tall = r() < 0.35;
    out.push({ flex, height, color, tilt, tall, roman: ROMAN[i] });
  }
  return out;
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return 'a moment';
  if (seconds <= 0) return 'almost done';
  if (seconds < 60) return `about ${Math.round(seconds)}s`;
  const mins = Math.max(1, Math.round(seconds / 60));
  return `about ${mins} minute${mins === 1 ? '' : 's'}`;
}

function phaseLabel(phase: TranscriptionPhase, progress: number): string {
  if (progress >= 1) return 'Sync complete';
  if (phase === 'upload') return 'Matching audiobook to book…';
  if (phase === 'submit') return 'Matching audiobook to book…';
  if (phase === 'poll') return 'Matching audiobook to book…';
  return 'Matching audiobook to book…';
}

export default function TranscriptionShelf({ bookId, progress, phase, etaSeconds }: Props) {
  const spines = useMemo(() => buildSpines(bookId), [bookId]);

  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const filledCount = Math.floor(pct / 5);
  const subPct = pct - filledCount * 5;
  const activeIdx = filledCount < SPINE_COUNT ? filledCount : -1;
  const activeFillRatio = activeIdx >= 0 ? subPct / 5 : 0;

  const done = progress >= 1;

  // Pulsing dot — stops when sync is complete
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (done) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, done]);
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] });

  // Active fill rises smoothly with progress
  const fillAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: activeFillRatio,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [activeFillRatio, fillAnim]);

  // "Settle" animation when a spine just locked in
  const settleAnim = useRef(new Animated.Value(1)).current;
  const lastFilledRef = useRef(filledCount);
  useEffect(() => {
    if (filledCount > lastFilledRef.current) {
      settleAnim.setValue(0);
      Animated.timing(settleAnim, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    lastFilledRef.current = filledCount;
  }, [filledCount, settleAnim]);

  const justArrivedIdx = filledCount > 0 ? filledCount - 1 : -1;
  const settleTranslateY = settleAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const settleOpacity = settleAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1, 1] });

  // Completion sequence: glow flash → fade card out → self-remove
  const [hidden, setHidden] = useState(false);
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const completionFiredRef = useRef(false);
  useEffect(() => {
    if (!done || completionFiredRef.current) return;
    completionFiredRef.current = true;
    Animated.sequence([
      Animated.delay(200),
      // Glow in
      Animated.timing(glowAnim, { toValue: 0.7, duration: 500, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
      Animated.delay(400),
      // Glow out
      Animated.timing(glowAnim, { toValue: 0, duration: 400, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
      Animated.delay(200),
      // Fade card out
      Animated.timing(cardOpacity, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
    ]).start(() => setHidden(true));
  }, [done, glowAnim, cardOpacity]);

  if (hidden) return null;

  return (
    <Animated.View style={[styles.card, { opacity: cardOpacity }]}>
      <View style={styles.eyebrow}>
        {done ? (
          <Text style={styles.doneCheck}>✓</Text>
        ) : (
          <Animated.View
            style={[styles.eyebrowDot, { opacity: dotOpacity, transform: [{ scale: dotScale }] }]}
          />
        )}
        <Text style={[styles.eyebrowText, done && styles.eyebrowTextDone]}>
          {done ? 'Sync complete' : phaseLabel(phase, progress)}
        </Text>
      </View>

      <View style={styles.counterRow}>
        <Text style={styles.counter}>
          {pct}
          <Text style={styles.counterOf}> / 100</Text>
        </Text>
        <View style={styles.phaseWrap}>
          <Text style={styles.phaseLabel}>{phaseLabel(phase, progress)}</Text>
          <Text style={styles.phaseEta}>{formatEta(etaSeconds)}</Text>
        </View>
      </View>

      <View style={styles.shelfContainer}>
      <View style={styles.shelf}>
        {spines.map((b, i) => {
          const isFilled = i < filledCount;
          const isActive = i === activeIdx;
          const isJustArrived = i === justArrivedIdx;

          const animatedStyle = isJustArrived
            ? { transform: [{ translateY: settleTranslateY }, { rotate: `${b.tilt}deg` }], opacity: settleOpacity }
            : { transform: [{ rotate: `${b.tilt}deg` }] };

          return (
            <Animated.View
              key={i}
              style={[
                styles.spineWrap,
                { flex: b.flex, height: b.height },
                animatedStyle,
              ]}
            >
              {isFilled || isActive ? (
                <View
                  style={[
                    styles.spineBody,
                    { backgroundColor: b.color },
                    isActive && styles.spineBodyActiveDim,
                  ]}
                >
                  <LinearGradient
                    colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.40)']}
                    locations={[0, 0.14, 0.70, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.spineRib1} />
                  <View style={styles.spineRib2} />
                  <View style={styles.spineRib3} />
                  <View style={styles.spineRib4} />
                  <View style={[styles.platePlain, b.tall && styles.plateTall]}>
                    <LinearGradient
                      colors={['rgba(255,245,220,0.95)', C.gilt, '#8C6A28']}
                      locations={[0, 0.45, 1]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Text style={[styles.plateNum, b.tall && styles.plateNumTall]}>{b.roman}</Text>
                  </View>
                  {b.height > SPINE_BASE_H + SPINE_VAR_H * 0.55 && (
                    <View style={styles.bandLow} />
                  )}
                  <LinearGradient
                    colors={['rgba(232,206,146,0.70)', 'rgba(201,169,110,0.15)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.spineTopGilt}
                  />
                  <View style={styles.spineBottomShadow} />
                  {isActive && (
                    <Animated.View
                      style={[
                        styles.activeFill,
                        {
                          height: fillAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={['rgba(232,206,146,0)', 'rgba(232,206,146,0.50)', 'rgba(255,245,214,0.85)']}
                        locations={[0, 0.6, 1]}
                        start={{ x: 0, y: 1 }}
                        end={{ x: 0, y: 0 }}
                        style={StyleSheet.absoluteFill}
                      />
                    </Animated.View>
                  )}
                </View>
              ) : (
                <View style={styles.spineEmpty} />
              )}
            </Animated.View>
          );
        })}
      </View>
        {/* Completion glow overlay — flashes gilt across the full shelf */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.glowOverlay, { opacity: glowAnim }]}
        />
      </View>

      <View style={styles.board}>
        <View style={styles.boardTop} />
      </View>

      <View style={styles.milestones}>
        <Text style={styles.milestone}>I</Text>
        <Text style={styles.milestone}>V</Text>
        <Text style={styles.milestone}>X</Text>
        <Text style={styles.milestone}>XV</Text>
        <Text style={styles.milestone}>XX</Text>
      </View>

      <View style={styles.footnoteWrap}>
        <Text style={styles.footnote}>
          <Text style={styles.footnoteAccent}>✦  </Text>
          You can read or listen now — the shelf fills in the background.
        </Text>
      </View>
    </Animated.View>
  );
}

const C = {
  bg: '#0E0E1A',
  bg2: '#14142A',
  line: '#1F1F35',
  lineSoft: '#15152A',
  gilt: '#C9A96E',
  giltWarm: '#E8CE92',
  giltDeep: '#8C7340',
  cream: '#F0E6D4',
  creamDim: '#C8B89A',
  muted: '#6E6452',
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 16,
    overflow: 'hidden',
  },

  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  eyebrowDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: C.gilt,
    shadowColor: C.gilt,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  eyebrowText: {
    fontSize: 9.5,
    fontFamily: 'Inter_600SemiBold',
    color: C.giltDeep,
    letterSpacing: 2.6,
  },
  eyebrowTextDone: {
    color: C.gilt,
  },
  doneCheck: {
    fontSize: 11,
    color: C.gilt,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 14,
  },

  heading: {
    fontSize: 22,
    color: C.cream,
    fontWeight: '500',
    lineHeight: 26,
  },
  headingItalic: {
    fontStyle: 'italic',
    color: C.giltWarm,
  },
  meta: {
    fontSize: 13,
    fontStyle: 'italic',
    color: C.creamDim,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 18,
  },

  counterRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  counter: {
    fontSize: 52,
    fontFamily: 'CormorantGaramond_600SemiBold',
    color: C.giltWarm,
    lineHeight: 52,
    fontVariant: ['tabular-nums'],
  },
  counterOf: {
    fontSize: 20,
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    color: C.giltDeep,
  },
  phaseWrap: {
    flex: 1,
    alignItems: 'flex-end',
    paddingBottom: 4,
  },
  phaseLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.cream,
    letterSpacing: 0.4,
  },
  phaseEta: {
    fontSize: 12,
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    color: C.muted,
    marginTop: 2,
  },

  shelfContainer: {
    position: 'relative',
  },
  shelf: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingTop: 6,
  },
  glowOverlay: {
    backgroundColor: C.gilt,
    borderRadius: 4,
  },

  spineWrap: {
    overflow: 'visible',
  },
  spineBody: {
    flex: 1,
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
    overflow: 'hidden',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.07)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(0,0,0,0.45)',
  },
  spineBodyActiveDim: {
    opacity: 0.55,
  },
  spineTopGilt: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 2,
    backgroundColor: 'rgba(201,169,110,0.30)',
  },
  spineBottomShadow: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // Raised bands (ribs) — four hairline horizontal lines across the spine
  spineRib1: {
    position: 'absolute',
    left: 0, right: 0,
    top: '32%',
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  spineRib2: {
    position: 'absolute',
    left: 0, right: 0,
    top: '47%',
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  spineRib3: {
    position: 'absolute',
    left: 0, right: 0,
    top: '63%',
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  spineRib4: {
    position: 'absolute',
    left: 0, right: 0,
    top: '83%',
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },

  // Gilt title cartouche
  platePlain: {
    position: 'absolute',
    left: '14%', right: '14%',
    top: '36%',
    height: '14%',
    borderRadius: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  plateTall: {
    top: '34%',
    height: '20%',
  },
  plateNum: {
    fontSize: 7,
    color: 'rgba(20,12,4,0.85)',
    fontFamily: 'Cinzel_600SemiBold',
    letterSpacing: 0.6,
  },
  plateNumTall: {
    fontSize: 9,
  },

  bandLow: {
    position: 'absolute',
    left: '20%', right: '20%',
    top: '74%',
    height: 3,
    backgroundColor: C.giltDeep,
    borderRadius: 1,
    opacity: 0.85,
  },

  // Active fill — rises from the bottom
  activeFill: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,245,214,0.85)',
    overflow: 'hidden',
  },

  // Empty (ghost) spine
  spineEmpty: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(201,169,110,0.10)',
    borderBottomWidth: 0,
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(201,169,110,0.025)',
    opacity: 0.7,
  },

  // Wood/leather plank
  board: {
    height: 8,
    marginTop: 0,
    backgroundColor: '#2F2614',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  boardTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 2,
    backgroundColor: 'rgba(232,206,146,0.55)',
  },

  milestones: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 8,
  },
  milestone: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: C.giltDeep,
  },

  footnoteWrap: {
    marginTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.lineSoft,
    paddingTop: 10,
  },
  footnote: {
    fontSize: 12.5,
    fontFamily: 'CormorantGaramond_400Regular_Italic',
    color: C.muted,
    lineHeight: 17,
  },
  footnoteAccent: {
    color: C.gilt,
    fontStyle: 'normal',
  },
});
