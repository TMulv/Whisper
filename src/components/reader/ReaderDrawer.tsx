import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { EpubChapter, EpubTheme } from './EpubWebView';
import { M4BChapter } from '@/types/sync';
import AudioTransport from './AudioTransport';

export type ReaderFontFamily = 'serif' | 'sans' | 'palatino' | 'mono';
export type ReaderMargin = 'narrow' | 'normal' | 'wide';

export const FONT_FAMILY_VALUES: Record<ReaderFontFamily, string> = {
  serif: "Georgia,'Times New Roman',serif",
  sans: "-apple-system,Roboto,'Helvetica Neue',sans-serif",
  palatino: "Palatino,'Palatino Linotype','Book Antiqua',serif",
  mono: "Menlo,Consolas,monospace",
};

export const MARGIN_VALUES: Record<ReaderMargin, string> = {
  narrow: '12px 10px',
  normal: '16px 20px',
  wide: '20px 36px',
};

interface Props {
  chapters: EpubChapter[];
  currentChapterIndex: number;
  fontSize: number;
  theme: EpubTheme;
  fontFamily: ReaderFontFamily;
  margin: ReaderMargin;
  onFontSizeChange: (px: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onFontFamilyChange: (family: ReaderFontFamily) => void;
  onMarginChange: (margin: ReaderMargin) => void;
  onChapterSelect: (index: number) => void;
  onClose: () => void;
  bookTitle?: string;
  onHome: () => void;
  // Audio
  hasAudio?: boolean;
  bookHasAudio?: boolean;
  isPlaying?: boolean;
  position?: number;
  duration?: number;
  currentChapter?: M4BChapter | null;
  audioChapters?: M4BChapter[];
  playbackRate?: number;
  onRateChange?: (rate: number) => void;
  immersionActive?: boolean;
  onImmersionToggle?: (active: boolean) => void;
  startingAudio?: boolean;
  onStartAudio?: () => void;
}

const FONT_SIZES = [14, 16, 18, 20, 22, 26];
const THEMES: { value: EpubTheme; label: string; bg: string; fg: string }[] = [
  { value: 'light',  label: 'Light',  bg: '#fff',    fg: '#1a1a1a' },
  { value: 'sepia',  label: 'Sepia',  bg: '#f5efe0', fg: '#3b2b1a' },
  { value: 'dark',   label: 'Dark',   bg: '#121212', fg: '#e0e0e0' },
  { value: 'eink',   label: 'E-ink',  bg: '#fff',    fg: '#000' },
];
const FONT_FAMILIES: { value: ReaderFontFamily; label: string; previewFont: string }[] = [
  { value: 'serif',    label: 'Georgia',  previewFont: 'Georgia' },
  { value: 'sans',     label: 'Sans',     previewFont: 'System' },
  { value: 'palatino', label: 'Palatino', previewFont: 'Palatino' },
  { value: 'mono',     label: 'Mono',     previewFont: 'Menlo' },
];
const MARGINS: { value: ReaderMargin; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide',   label: 'Wide' },
];

export default function ReaderDrawer({
  chapters,
  currentChapterIndex,
  fontSize,
  theme,
  fontFamily,
  margin,
  onFontSizeChange,
  onThemeChange,
  onFontFamilyChange,
  onMarginChange,
  onChapterSelect,
  onClose,
  bookTitle,
  onHome,
  hasAudio = false,
  bookHasAudio = false,
  isPlaying = false,
  position = 0,
  duration = 0,
  currentChapter = null,
  audioChapters = [],
  playbackRate = 1,
  onRateChange = () => {},
  immersionActive = false,
  onImmersionToggle = () => {},
  startingAudio = false,
  onStartAudio = () => {},
}: Props) {
  const audioAvailable = hasAudio || bookHasAudio;
  const [tab, setTab] = useState<'audio' | 'display' | 'chapters'>(
    audioAvailable ? 'audio' : 'display',
  );

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onHome}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBtn}
        >
          <Text style={styles.headerHome}>‹ Home</Text>
        </TouchableOpacity>
        {bookTitle ? (
          <Text style={styles.headerTitle} numberOfLines={1}>{bookTitle}</Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerBtn}
        >
          <Text style={styles.headerClose}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {audioAvailable && (
          <TouchableOpacity
            style={[styles.tab, tab === 'audio' && styles.tabActive]}
            onPress={() => setTab('audio')}
          >
            <Text style={[styles.tabText, tab === 'audio' && styles.tabTextActive]}>Audio</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.tab, tab === 'display' && styles.tabActive]}
          onPress={() => setTab('display')}
        >
          <Text style={[styles.tabText, tab === 'display' && styles.tabTextActive]}>Display</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'chapters' && styles.tabActive]}
          onPress={() => setTab('chapters')}
        >
          <Text style={[styles.tabText, tab === 'chapters' && styles.tabTextActive]}>Chapters</Text>
        </TouchableOpacity>
      </View>

      {tab === 'audio' ? (
        hasAudio ? (
          <AudioTransport
            isPlaying={isPlaying}
            position={position}
            duration={duration}
            currentChapter={currentChapter}
            chapters={audioChapters}
            playbackRate={playbackRate}
            onRateChange={onRateChange}
            immersionActive={immersionActive}
            onImmersionToggle={onImmersionToggle}
          />
        ) : (
          <View style={styles.startAudioPane}>
            <TouchableOpacity
              style={styles.startAudioBtn}
              onPress={onStartAudio}
              disabled={startingAudio}
            >
              {startingAudio ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.startAudioBtnText}>▶  Start audiobook</Text>
              )}
            </TouchableOpacity>
          </View>
        )
      ) : tab === 'display' ? (
        <ScrollView style={styles.displayScroll} contentContainerStyle={styles.displayTab}>
          <Text style={styles.controlLabel}>Text size</Text>
          <View style={styles.fontSizeRow}>
            <Text style={styles.fontSizeSmall}>A</Text>
            {FONT_SIZES.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.fontSizeBtn, fontSize === size && styles.fontSizeBtnActive]}
                onPress={() => onFontSizeChange(size)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text
                  style={[
                    styles.fontSizeBtnText,
                    { fontSize: Math.max(11, size - 4) },
                    fontSize === size && styles.fontSizeBtnTextActive,
                  ]}
                >
                  Aa
                </Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.fontSizeLarge}>A</Text>
          </View>

          <Text style={[styles.controlLabel, { marginTop: 22 }]}>Font</Text>
          <View style={styles.fontFamilyRow}>
            {FONT_FAMILIES.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[
                  styles.fontFamilyChip,
                  fontFamily === f.value && styles.fontFamilyChipActive,
                ]}
                onPress={() => onFontFamilyChange(f.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.fontFamilyChipText,
                    { fontFamily: f.previewFont },
                    fontFamily === f.value && styles.fontFamilyChipTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.controlLabel, { marginTop: 22 }]}>Margins</Text>
          <View style={styles.marginRow}>
            {MARGINS.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[
                  styles.marginChip,
                  margin === m.value && styles.marginChipActive,
                ]}
                onPress={() => onMarginChange(m.value)}
                activeOpacity={0.8}
              >
                <MarginIcon value={m.value} active={margin === m.value} />
                <Text
                  style={[
                    styles.marginChipText,
                    margin === m.value && styles.marginChipTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.controlLabel, { marginTop: 22 }]}>Theme</Text>
          <View style={styles.themeRow}>
            {THEMES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[
                  styles.themeChip,
                  { backgroundColor: t.bg, borderColor: t.fg },
                  theme === t.value && styles.themeChipActive,
                ]}
                onPress={() => onThemeChange(t.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.themeChipText, { color: t.fg }]}>{t.label}</Text>
                {theme === t.value && (
                  <View style={[styles.themeChipCheck, { borderColor: t.fg }]}>
                    <Text style={{ color: t.fg, fontSize: 10 }}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 20 }} />
        </ScrollView>
      ) : (
        <ScrollView style={styles.chapterList} keyboardShouldPersistTaps="handled">
          {chapters.map((ch) => (
            <TouchableOpacity
              key={ch.index}
              style={[
                styles.chapterRow,
                ch.index === currentChapterIndex && styles.chapterRowActive,
              ]}
              onPress={() => {
                onChapterSelect(ch.index);
                onClose();
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.chapterRowText,
                  ch.index === currentChapterIndex && styles.chapterRowTextActive,
                ]}
                numberOfLines={2}
              >
                {ch.title}
              </Text>
              {ch.index === currentChapterIndex && (
                <Text style={styles.currentMarker}>▶</Text>
              )}
            </TouchableOpacity>
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <View style={styles.handle} />
    </>
  );
}

function MarginIcon({ value, active }: { value: ReaderMargin; active: boolean }) {
  const insetByValue = { narrow: 4, normal: 8, wide: 14 }[value];
  const color = active ? '#fff' : '#888';
  return (
    <View style={[styles.marginIconOuter, { borderColor: color }]}>
      <View
        style={{
          position: 'absolute',
          left: insetByValue,
          right: insetByValue,
          top: 3,
          bottom: 3,
          backgroundColor: color,
          opacity: 0.5,
          borderRadius: 1,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#DDD',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 8,
  },
  headerBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  headerHome: { fontSize: 15, color: '#1A1A2E', fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 14, color: '#555', fontWeight: '500' },
  headerClose: { fontSize: 16, color: '#888' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E8E8',
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 4,
  },
  tabActive: { backgroundColor: '#F0F0F8' },
  tabText: { fontSize: 14, color: '#888', fontWeight: '500' },
  tabTextActive: { color: '#1A1A2E', fontWeight: '700' },

  displayScroll: { maxHeight: '92%' },
  displayTab: { padding: 20, paddingBottom: 32 },
  controlLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  fontSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fontSizeSmall: { fontSize: 12, color: '#888', width: 18, textAlign: 'center' },
  fontSizeLarge: { fontSize: 20, color: '#888', width: 24, textAlign: 'center' },
  fontSizeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  fontSizeBtnActive: { backgroundColor: '#1A1A2E' },
  fontSizeBtnText: { color: '#555', fontWeight: '600' },
  fontSizeBtnTextActive: { color: '#fff' },

  fontFamilyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  fontFamilyChip: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
  },
  fontFamilyChipActive: { backgroundColor: '#1A1A2E', borderColor: '#1A1A2E' },
  fontFamilyChipText: { fontSize: 15, color: '#333', fontWeight: '600' },
  fontFamilyChipTextActive: { color: '#fff' },

  marginRow: { flexDirection: 'row', gap: 8 },
  marginChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  marginChipActive: { backgroundColor: '#1A1A2E', borderColor: '#1A1A2E' },
  marginChipText: { fontSize: 12, color: '#555', fontWeight: '600' },
  marginChipTextActive: { color: '#fff' },
  marginIconOuter: {
    width: 40,
    height: 20,
    borderWidth: 1,
    borderRadius: 3,
    position: 'relative',
  },

  themeRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  themeChip: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  themeChipActive: { borderWidth: 2.5 },
  themeChipText: { fontSize: 13, fontWeight: '600' },
  themeChipCheck: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chapterList: { maxHeight: 380 },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  chapterRowActive: { backgroundColor: '#F0F0F8' },
  chapterRowText: { flex: 1, fontSize: 15, color: '#333', lineHeight: 20 },
  chapterRowTextActive: { color: '#1A1A2E', fontWeight: '600' },
  currentMarker: { fontSize: 10, color: '#1A1A2E', marginLeft: 8 },

  startAudioPane: { padding: 24, alignItems: 'center' },
  startAudioBtn: {
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    minWidth: 180,
    alignItems: 'center',
  },
  startAudioBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
