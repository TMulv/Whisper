import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
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
  if (progress >= 1) return 'Word-accurate ready';
  if (phase === 'upload') return 'Uploading audio';
  if (phase === 'submit') return 'Submitting';
  if (phase === 'poll') return 'Transcribing';
  return 'Word-accurate ready';
}

export default function TranscriptionShelf({ bookId, progress, phase, etaSeconds }: Props) {
  const spines = useMemo(() => buildSpines(bookId), [bookId]);

  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const filledCount = Math.floor(pct / 5);
  const subPct = pct - filledCount * 5;
  const activeIdx = filledCount < SPINE_COUNT ? filledCount : -1;
  const activeFillRatio = activeIdx >= 0 ? subPct / 5 : 0;

  // Pulsing dot in the eyebrow
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
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

  return (
    <View style={styles.card}>
      <View style={styles.eyebrow}>
        <Animated.View
          style={[
            styles.eyebrowDot,
            { opacity: dotOpacity, transform: [{ scale: dotScale }] },
          ]}
        />
        <Text style={styles.eyebrowText}>BUILDING WORD-ACCURATE SYNC</Text>
      </View>

      <Text style={styles.heading}>
        Your library, <Text style={styles.headingItalic}>arriving</Text>
      </Text>
      <Text style={styles.meta}>
        Twenty volumes — one for each five percent. The book in progress glows warm as it fills.
      </Text>

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
                  <View style={styles.spineHighlight} />
                  <View style={styles.spineEdgeShadow} />
                  <View style={styles.spineRib1} />
                  <View style={styles.spineRib2} />
                  <View style={styles.spineRib3} />
                  <View style={styles.spineRib4} />
                  <View style={[styles.platePlain, b.tall && styles.plateTall]}>
                    <Text style={[styles.plateNum, b.tall && styles.plateNumTall]}>{b.roman}</Text>
                  </View>
                  {b.height > SPINE_BASE_H + SPINE_VAR_H * 0.55 && (
                    <View style={styles.bandLow} />
                  )}
                  <View style={styles.spineTopGilt} />
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
                    />
                  )}
                </View>
              ) : (
                <View style={styles.spineEmpty} />
              )}
            </Animated.View>
          );
        })}
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
    </View>
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
    fontWeight: '600',
    color: C.giltDeep,
    letterSpacing: 2.6,
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
    fontWeight: '700',
    color: C.giltWarm,
    lineHeight: 52,
    fontVariant: ['tabular-nums'],
  },
  counterOf: {
    fontSize: 20,
    fontStyle: 'italic',
    fontWeight: '400',
    color: C.giltDeep,
  },
  phaseWrap: {
    flex: 1,
    alignItems: 'flex-end',
    paddingBottom: 4,
  },
  phaseLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.cream,
    letterSpacing: 0.4,
  },
  phaseEta: {
    fontSize: 12,
    fontStyle: 'italic',
    color: C.muted,
    marginTop: 2,
  },

  shelf: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingTop: 6,
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
  spineHighlight: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: '8%',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  spineEdgeShadow: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: '12%',
    backgroundColor: 'rgba(0,0,0,0.30)',
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
    backgroundColor: C.gilt,
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
    fontWeight: '700',
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
    backgroundColor: 'rgba(232,206,146,0.55)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,245,214,0.85)',
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
    fontStyle: 'italic',
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
    fontStyle: 'italic',
    color: C.muted,
    lineHeight: 17,
  },
  footnoteAccent: {
    color: C.gilt,
    fontStyle: 'normal',
  },
});
