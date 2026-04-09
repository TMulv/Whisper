import { useCallback } from 'react';
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

export function useFileStorage(): UseFileStorageReturn {
  const pickEpub = useCallback(async (bookId: string): Promise<PickResult | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return null;

      const asset = result.assets[0];
      const extension = 'epub';
      const localUri = await cacheFile(asset.uri, bookId, 'epub', extension);
      return { uri: localUri, name: asset.name ?? '' };
    } catch (err) {
      logger.error('pickEpub failed', err);
      return null;
    }
  }, []);

  const pickAudio = useCallback(async (bookId: string): Promise<PickResult | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mp4', 'audio/mpeg', 'audio/x-m4b', 'audio/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return null;

      const asset = result.assets[0];
      const name = asset.name ?? '';
      const extension = name.split('.').pop() ?? 'mp3';
      const localUri = await cacheFile(asset.uri, bookId, 'audio', extension);
      return { uri: localUri, name };
    } catch (err) {
      logger.error('pickAudio failed', err);
      return null;
    }
  }, []);

  return { pickEpub, pickAudio };
}
