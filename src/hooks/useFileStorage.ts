import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { cacheFile } from '@/services/storage/localStorageService';
import { logger } from '@/utils/logger';

export interface PickResult {
  uri: string;
  name: string;
}

interface UseFileStorageReturn {
  pickEpub: (bookId: string) => Promise<PickResult | null>;
  pickAudio: (bookId: string) => Promise<PickResult | null>;
}

function reportPickError(kind: 'ebook' | 'audio', err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOSPC|No space left/i.test(msg)) {
    Alert.alert(
      'Out of storage',
      `Couldn't copy the ${kind} file — the device is out of space. Free some storage and try again.`,
    );
    return;
  }
  Alert.alert('Import failed', `Couldn't import the ${kind} file.\n\n${msg}`);
}

export function useFileStorage(): UseFileStorageReturn {
  const pickEpub = useCallback(async (bookId: string): Promise<PickResult | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets?.[0]) return null;

      const asset = result.assets[0];
      const extension = 'epub';
      const localUri = await cacheFile(asset.uri, bookId, 'epub', extension);
      return { uri: localUri, name: asset.name ?? '' };
    } catch (err) {
      logger.error('pickEpub failed', err);
      reportPickError('ebook', err);
      return null;
    }
  }, []);

  const pickAudio = useCallback(async (bookId: string): Promise<PickResult | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mp4', 'audio/mpeg', 'audio/x-m4b', 'audio/*'],
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets?.[0]) return null;

      const asset = result.assets[0];
      const name = asset.name ?? '';
      const extension = name.split('.').pop() ?? 'mp3';
      const localUri = await cacheFile(asset.uri, bookId, 'audio', extension);
      return { uri: localUri, name };
    } catch (err) {
      logger.error('pickAudio failed', err);
      reportPickError('audio', err);
      return null;
    }
  }, []);

  return { pickEpub, pickAudio };
}
