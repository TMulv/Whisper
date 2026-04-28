import React from 'react';
import { View, StyleSheet } from 'react-native';

type IconProps = {
  focused?: boolean;
  size?: number;
};

const ACTIVE = '#1A1A2E';
const INACTIVE = '#B5B0A8';
const GOLD = '#C9A96E';

// ── Library: a literary bookshelf — four varied spines with a warm baseline ──

export function LibraryIcon({ focused = false, size = 24 }: IconProps) {
  const c = focused ? ACTIVE : INACTIVE;
  const stroke = focused ? 2.25 : 1.75;
  const accent = focused ? GOLD : c;
  return (
    <View style={[s.iconBox, { width: size, height: size }]}>
      <View style={[s.shelfRow, { height: size - 3 }]}>
        <View style={[s.spine, { width: stroke, height: size * 0.58, backgroundColor: c }]} />
        <View style={[s.spine, { width: stroke, height: size * 0.82, backgroundColor: c }]} />
        <View style={[s.spine, { width: stroke, height: size * 0.5, backgroundColor: accent, marginHorizontal: 2 }]} />
        <View style={[s.spine, { width: stroke, height: size * 0.72, backgroundColor: c }]} />
      </View>
      <View style={[s.shelfBase, { height: stroke, backgroundColor: c, width: size * 0.9 }]} />
    </View>
  );
}

// ── Pair: two interlocking rings — audio ↔ text bond (for gold FAB) ──────────

export function PairRingsIcon({ color = '#09090F', size = 24 }: { color?: string; size?: number }) {
  const ring = size * 0.58;
  const stroke = 2;
  const overlap = ring * 0.38;
  return (
    <View style={[s.iconBox, { width: size, height: size }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
        <View
          style={{
            width: ring,
            height: ring,
            borderRadius: ring / 2,
            borderWidth: stroke,
            borderColor: color,
            marginLeft: -overlap,
            backgroundColor: GOLD,
          }}
        />
      </View>
    </View>
  );
}

// ── Settings: three slider tracks with knobs — an audio-native control look ─

export function SettingsIcon({ focused = false, size = 24 }: IconProps) {
  const c = focused ? ACTIVE : INACTIVE;
  const track = focused ? 1.75 : 1.25;
  const trackW = size * 0.9;
  const rowH = size / 3;

  return (
    <View style={{ width: size, height: size, justifyContent: 'space-between', paddingVertical: 1 }}>
      {[0.28, 0.68, 0.44].map((knobX, i) => (
        <SliderRow key={i} color={c} trackWidth={trackW} trackHeight={track} knobX={knobX} rowHeight={rowH} focused={focused} />
      ))}
    </View>
  );
}

function SliderRow({
  color,
  trackWidth,
  trackHeight,
  knobX,
  rowHeight,
  focused,
}: {
  color: string;
  trackWidth: number;
  trackHeight: number;
  knobX: number;
  rowHeight: number;
  focused: boolean;
}) {
  const knob = focused ? 6 : 5;
  return (
    <View style={{ height: rowHeight, width: trackWidth, justifyContent: 'center' }}>
      <View style={{ height: trackHeight, backgroundColor: color, borderRadius: trackHeight / 2, opacity: 0.55 }} />
      <View
        style={{
          position: 'absolute',
          left: (trackWidth - knob) * knobX,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          borderWidth: trackHeight,
          borderColor: color,
          backgroundColor: '#FFFFFF',
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shelfRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  spine: {
    borderRadius: 0.5,
  },
  shelfBase: {
    marginTop: 2,
    borderRadius: 1,
  },
});
