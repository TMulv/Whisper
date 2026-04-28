import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { HIGHLIGHT_COLORS } from '@/types/highlight';
import type { EpubTheme } from './EpubWebView';

interface Props {
  visible: boolean;
  selectedText: string;
  theme: EpubTheme;
  onSelectColor: (hex: string) => void;
  onDismiss: () => void;
}

export default function HighlightMenu({ visible, selectedText, theme, onSelectColor, onDismiss }: Props) {
  const isDark = theme === 'dark';
  const bg = isDark ? '#1e1e1e' : '#ffffff';
  const fg = isDark ? '#e0e0e0' : '#1a1a1a';
  const border = isDark ? '#333' : '#e0e0e0';

  const preview = selectedText.length > 60
    ? selectedText.slice(0, 57) + '…'
    : selectedText;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { backgroundColor: bg, borderColor: border }]}>
              <Text style={[styles.preview, { color: fg }]} numberOfLines={2}>
                "{preview}"
              </Text>
              <Text style={[styles.label, { color: isDark ? '#999' : '#666' }]}>
                Highlight color
              </Text>
              <View style={styles.colorRow}>
                {HIGHLIGHT_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.swatch, { backgroundColor: c.hex }]}
                    onPress={() => onSelectColor(c.hex)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Highlight ${c.key}`}
                  />
                ))}
              </View>
              <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss}>
                <Text style={[styles.cancelText, { color: isDark ? '#aaa' : '#666' }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
  },
  preview: {
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  colorRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  cancelText: {
    fontSize: 15,
  },
});
