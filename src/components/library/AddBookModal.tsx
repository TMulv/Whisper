import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import OpenFromBrowser, { type Selection } from './OpenFromBrowser';
import { addRecentPick, classifyName } from '@/services/storage/recentPicksService';
import type { LocalBook } from '@/types/book';

const C = {
  bg: '#09090F',
  surface: '#0F0F1A',
  border: '#1C1C2E',
  rule: '#26263A',
  brass: '#C9A96E',
  brassDim: '#6A5832',
  text: '#F0E6D4',
  textMuted: '#7A6E62',
  textFaint: '#3A3530',
};

export type AddBookSource = 'files' | 'nextcloud' | 'googledrive' | 'icloud';

interface FileSelection {
  name: string;
  uri: string;
}

interface AddBookModalProps {
  visible: boolean;
  onClose: () => void;
  onPickEpub: () => Promise<FileSelection | null>;
  onPickAudio: () => Promise<FileSelection | null>;
  onConfirm: (epub: FileSelection, audio: FileSelection) => Promise<void>;
  recentBooks?: LocalBook[];
  hasNextcloud?: boolean;
  onImportNextcloud?: () => void;
  hasGoogleDrive?: boolean;
  onImportGoogleDrive?: () => void;
  hasICloud?: boolean;
  onImportICloud?: () => void;
}

export default function AddBookModal({
  visible,
  onClose,
  onPickEpub,
  onPickAudio,
  onConfirm,
  recentBooks = [],
  hasNextcloud,
  onImportNextcloud,
  hasGoogleDrive,
  onImportGoogleDrive,
  hasICloud,
  onImportICloud,
}: AddBookModalProps) {
  const insets = useSafeAreaInsets();
  const [epub, setEpub] = useState<Selection | null>(null);
  const [audio, setAudio] = useState<Selection | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!visible) {
      setEpub(null);
      setAudio(null);
      setConfirming(false);
    }
  }, [visible]);

  const handlePickEpubDevice = useCallback(async (): Promise<Selection | null> => {
    const r = await onPickEpub();
    if (r) {
      await addRecentPick({
        uri: r.uri,
        name: r.name,
        kind: classifyName(r.name),
        sizeBytes: 0,
      });
    }
    return r;
  }, [onPickEpub]);

  const handlePickAudioDevice = useCallback(async (): Promise<Selection | null> => {
    const r = await onPickAudio();
    if (r) {
      await addRecentPick({
        uri: r.uri,
        name: r.name,
        kind: classifyName(r.name),
        sizeBytes: 0,
      });
    }
    return r;
  }, [onPickAudio]);

  const handleConfirm = useCallback(async () => {
    if (!epub || !audio) return;
    setConfirming(true);
    try {
      await onConfirm(epub, audio);
    } finally {
      setConfirming(false);
    }
  }, [epub, audio, onConfirm]);

  const cloudSources = [
    {
      key: 'nextcloud' as const,
      label: 'Nextcloud',
      badge: '☁',
      available: !!hasNextcloud,
      onOpen: () => {
        if (onImportNextcloud) {
          onClose();
          onImportNextcloud();
        }
      },
    },
    {
      key: 'googledrive' as const,
      label: 'Google Drive',
      badge: '▲',
      available: !!hasGoogleDrive,
      onOpen: () => {
        if (onImportGoogleDrive) {
          onClose();
          onImportGoogleDrive();
        }
      },
    },
    {
      key: 'icloud' as const,
      label: 'iCloud Drive',
      badge: '◆',
      available: !!hasICloud,
      onOpen: () => {
        if (onImportICloud) {
          onClose();
          onImportICloud();
        }
      },
    },
  ];

  const recentBriefs = recentBooks.map((b) => ({
    id: b.id,
    title: b.title,
    epubPath: b.epubPath,
    audioPath: b.audioPath,
    addedAt: b.addedAt,
    updatedAt: b.updatedAt,
  }));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>ADD TO LIBRARY</Text>
            <Text style={styles.title}>Open from</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={confirming}
            style={styles.closeBtn}
          >
            <Text style={[styles.closeGlyph, confirming && { opacity: 0.4 }]}>×</Text>
          </TouchableOpacity>
        </View>

        <OpenFromBrowser
          epub={epub}
          audio={audio}
          onPickEpubDevice={handlePickEpubDevice}
          onPickAudioDevice={handlePickAudioDevice}
          onSelectEpub={setEpub}
          onSelectAudio={setAudio}
          onClearEpub={() => setEpub(null)}
          onClearAudio={() => setAudio(null)}
          onConfirm={handleConfirm}
          confirming={confirming}
          recentBooks={recentBriefs}
          cloudSources={cloudSources}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.rule,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerLeft: { flex: 1 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: C.brassDim,
    letterSpacing: 2.6,
    marginBottom: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: C.text,
    letterSpacing: -0.6,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    marginBottom: 2,
  },
  closeGlyph: {
    fontSize: 22,
    lineHeight: 24,
    color: C.textMuted,
    fontWeight: '300',
    marginTop: -2,
  },
});
