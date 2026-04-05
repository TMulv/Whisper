import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Animated,
} from 'react-native';
import { EpubChapter, EpubTheme } from './EpubWebView';

interface Props {
  chapters: EpubChapter[];
  currentChapterIndex: number;
  fontSize: number;
  theme: EpubTheme;
  onFontSizeChange: (px: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onChapterSelect: (index: number) => void;
  onClose: () => void;
}

const FONT_SIZES = [14, 16, 18, 20, 22, 26];
const THEMES: { value: EpubTheme; label: string; bg: string; fg: string }[] = [
  { value: 'light',  label: 'Light',  bg: '#fff',    fg: '#1a1a1a' },
  { value: 'sepia',  label: 'Sepia',  bg: '#f5efe0', fg: '#3b2b1a' },
  { value: 'dark',   label: 'Dark',   bg: '#121212', fg: '#e0e0e0' },
  { value: 'eink',   label: 'E-ink',  bg: '#fff',    fg: '#000' },
];

export default function ReaderControls({
  chapters,
  currentChapterIndex,
  fontSize,
  theme,
  onFontSizeChange,
  onThemeChange,
  onChapterSelect,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'display' | 'chapters'>('display');

  return (
    <View style={styles.panel}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Tab bar */}
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
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {tab === 'display' ? (
        <View style={styles.displayTab}>
          {/* Font size */}
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

          {/* Theme */}
          <Text style={[styles.controlLabel, { marginTop: 20 }]}>Theme</Text>
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
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 12,
    maxHeight: '65%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#DDD',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
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
  closeBtn: { marginLeft: 'auto', padding: 8 },
  closeBtnText: { fontSize: 16, color: '#888' },

  // Display tab
  displayTab: { padding: 20 },
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

  // Chapter list
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
});
