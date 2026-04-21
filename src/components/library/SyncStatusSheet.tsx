// Bottom-sheet detail for a book's sync state. Opens from a SyncBadge tap.
// Plain-language at top, per-chapter checklist below, retry action at bottom.

import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { BookAlignment, AlignmentStatus } from '@/types/sync';

interface Props {
  visible: boolean;
  alignment: BookAlignment | null;
  /** `true` if there's a live cloud job running for this book. */
  remoteProcessing?: boolean;
  onClose: () => void;
  onRetry?: (chapterIndex: number) => void;
}

export default function SyncStatusSheet({
  visible,
  alignment,
  remoteProcessing = false,
  onClose,
  onRetry,
}: Props) {
  const summary = useMemo(
    () => summarize(alignment, remoteProcessing),
    [alignment, remoteProcessing],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="none"
        >
          <View style={styles.handle} />

          <Text style={styles.headline}>{summary.headline}</Text>
          <Text style={styles.subline}>{summary.subline}</Text>

          {alignment && (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {alignment.chapters.map((chapter) => {
                const anchors = alignment.l1Anchors[chapter.audioChapterIndex];
                const aligned = !!anchors && anchors.length > 0;
                return (
                  <View key={chapter.audioChapterIndex} style={styles.row}>
                    <Text style={[styles.rowIcon, { color: aligned ? '#68D391' : '#6B7280' }]}>
                      {aligned ? '●' : '○'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>
                        Chapter {chapter.audioChapterIndex + 1}
                      </Text>
                      <Text style={styles.rowSub}>
                        {aligned
                          ? `${anchors.length} anchors`
                          : remoteProcessing
                            ? 'queued'
                            : 'chapter-level only'}
                      </Text>
                    </View>
                    {!aligned && onRetry && (
                      <TouchableOpacity
                        onPress={() => onRetry(chapter.audioChapterIndex)}
                      >
                        <Text style={styles.rowAction}>Retry</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneLabel}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface Summary {
  headline: string;
  subline: string;
}

function summarize(
  alignment: BookAlignment | null,
  remoteProcessing: boolean,
): Summary {
  if (!alignment) {
    return {
      headline: 'No sync yet',
      subline: 'Open this book to build a chapter-level sync.',
    };
  }
  const total = alignment.chapters.length;
  const filled = Object.values(alignment.l1Anchors).filter(
    (list) => list && list.length > 0,
  ).length;

  const status: AlignmentStatus = alignment.status;
  if (status === 'complete') {
    return {
      headline: 'Sync complete',
      subline:
        'Reader and audio will stay within a sentence of each other at every handoff.',
    };
  }
  if (status === 'failed') {
    return {
      headline: 'Sync ran into a problem',
      subline:
        'Chapter-level sync is still active. Retry the affected chapters below.',
    };
  }
  if (remoteProcessing || status === 'processing') {
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
    return {
      headline: 'Syncing in the background',
      subline: `${filled} of ${total} chapters refined (${pct}%). The app keeps working — this just makes handoffs more precise.`,
    };
  }
  return {
    headline: 'Chapter-level sync ready',
    subline:
      'Handoffs land on the right chapter today. Refined sync will start when you open the book.',
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 18,
  },
  headline: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  subline: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
    gap: 12,
  },
  rowIcon: {
    fontSize: 16,
    width: 18,
    textAlign: 'center',
  },
  rowTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  rowSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  rowAction: {
    color: '#A8C8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  doneButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  doneLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
