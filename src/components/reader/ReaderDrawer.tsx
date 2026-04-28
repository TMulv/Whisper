import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { EpubChapter, EpubTheme } from './EpubWebView';
import { Highlight, HIGHLIGHT_COLORS } from '@/types/highlight';

export type ReaderFontFamily = 'serif' | 'sans' | 'palatino' | 'mono';
export type ReaderMargin = 'narrow' | 'normal' | 'wide';
export type ReaderLineHeight = 1.2 | 1.4 | 1.6 | 1.8 | 2.0;
export type ReaderProgressDisplay = 'page' | 'percent';

export const FONT_FAMILY_VALUES: Record<ReaderFontFamily, string> = {
  serif: "Georgia,'Times New Roman',serif",
  sans: "-apple-system,Roboto,'Helvetica Neue',sans-serif",
  palatino: "Palatino,'Palatino Linotype','Book Antiqua',serif",
  mono: "Menlo,Consolas,monospace",
};

export const MARGIN_VALUES: Record<ReaderMargin, string> = {
  narrow: '48px 12px',
  normal: '56px 24px',
  wide: '56px 44px',
};

interface Props {
  chapters: EpubChapter[];
  currentChapterIndex: number;
  fontSize: number;
  lineHeight: ReaderLineHeight;
  theme: EpubTheme;
  fontFamily: ReaderFontFamily;
  margin: ReaderMargin;
  onFontSizeChange: (px: number) => void;
  onLineHeightChange: (value: ReaderLineHeight) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onFontFamilyChange: (family: ReaderFontFamily) => void;
  onMarginChange: (margin: ReaderMargin) => void;
  progressDisplay: ReaderProgressDisplay;
  onProgressDisplayChange: (v: ReaderProgressDisplay) => void;
  onChapterSelect: (index: number) => void;
  onClose: () => void;
  bookTitle?: string;
  onHome: () => void;
  highlights?: Highlight[];
  onHighlightNavigate?: (cfiRange: string) => void;
  onHighlightDelete?: (id: string) => void;
}

const FONT_SIZES = [14, 16, 18, 20, 22, 26];
const LINE_HEIGHTS: { value: ReaderLineHeight; label: string }[] = [
  { value: 1.2, label: 'XS' },
  { value: 1.4, label: 'S' },
  { value: 1.6, label: 'M' },
  { value: 1.8, label: 'L' },
  { value: 2.0, label: 'XL' },
];
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
  lineHeight,
  theme,
  fontFamily,
  margin,
  onFontSizeChange,
  onLineHeightChange,
  onThemeChange,
  onFontFamilyChange,
  onMarginChange,
  progressDisplay,
  onProgressDisplayChange,
  onChapterSelect,
  onClose,
  bookTitle,
  onHome,
  highlights = [],
  onHighlightNavigate,
  onHighlightDelete,
}: Props) {
  const [tab, setTab] = useState<'display' | 'chapters' | 'highlights'>('display');

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
        <TouchableOpacity
          style={[styles.tab, tab === 'highlights' && styles.tabActive]}
          onPress={() => setTab('highlights')}
        >
          <Text style={[styles.tabText, tab === 'highlights' && styles.tabTextActive]}>
            {highlights.length > 0 ? `Notes (${highlights.length})` : 'Notes'}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'display' ? (
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

          <Text style={[styles.controlLabel, { marginTop: 22 }]}>Line spacing</Text>
          <View style={styles.lineHeightRow}>
            {LINE_HEIGHTS.map((lh) => (
              <TouchableOpacity
                key={lh.value}
                style={[styles.lineHeightBtn, lineHeight === lh.value && styles.lineHeightBtnActive]}
                onPress={() => onLineHeightChange(lh.value)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={[styles.lineHeightBtnText, lineHeight === lh.value && styles.lineHeightBtnTextActive]}>
                  {lh.label}
                </Text>
              </TouchableOpacity>
            ))}
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
          <Text style={[styles.controlLabel, { marginTop: 22 }]}>Progress display</Text>
          <View style={styles.progressRow}>
            {([
              { value: 'page', label: 'Page' },
              { value: 'percent', label: '%' },
            ] as { value: ReaderProgressDisplay; label: string }[]).map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.progressChip, progressDisplay === opt.value && styles.progressChipActive]}
                onPress={() => onProgressDisplayChange(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.progressChipText, progressDisplay === opt.value && styles.progressChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>
      ) : tab === 'chapters' ? (
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
      ) : (
        <ScrollView style={styles.chapterList} keyboardShouldPersistTaps="handled">
          {highlights.length === 0 ? (
            <View style={styles.emptyHighlights}>
              <Text style={styles.emptyHighlightsText}>
                Long-press text in the book to highlight it.
              </Text>
            </View>
          ) : (
            highlights
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((h) => {
                const swatchColor = HIGHLIGHT_COLORS.find((c) => c.hex === h.color)?.hex ?? h.color;
                return (
                  <View key={h.id} style={styles.highlightRow}>
                    <TouchableOpacity
                      style={styles.highlightRowContent}
                      onPress={() => onHighlightNavigate?.(h.cfiRange)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.highlightSwatch, { backgroundColor: swatchColor }]} />
                      <Text style={styles.highlightText} numberOfLines={3}>
                        {h.text}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.highlightDeleteBtn}
                      onPress={() => onHighlightDelete?.(h.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.highlightDeleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
          )}
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

  lineHeightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lineHeightBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  lineHeightBtnActive: { backgroundColor: '#1A1A2E' },
  lineHeightBtnText: { color: '#555', fontWeight: '600', fontSize: 13 },
  lineHeightBtnTextActive: { color: '#fff' },

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

  progressRow: { flexDirection: 'row', gap: 8 },
  progressChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
  },
  progressChipActive: { backgroundColor: '#1A1A2E', borderColor: '#1A1A2E' },
  progressChipText: { fontSize: 14, color: '#555', fontWeight: '600' },
  progressChipTextActive: { color: '#fff' },

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

  emptyHighlights: { padding: 32, alignItems: 'center' },
  emptyHighlightsText: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },

  highlightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  highlightRowContent: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  highlightSwatch: { width: 12, height: 12, borderRadius: 6, marginTop: 3, flexShrink: 0 },
  highlightText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20, fontStyle: 'italic' },
  highlightDeleteBtn: { paddingLeft: 12, paddingTop: 2 },
  highlightDeleteText: { fontSize: 13, color: '#BBB' },
});
