import { useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { cacheFile } from '@/services/storage/localStorageService';
import { logger } from '@/utils/logger';

interface UseFileStorageReturn {
  pickEpub: (bookId: string) => Promise<string | null>;
  pickAudio: (bookId: string) => Promise<string | null>;
}

export function useFileStorage(): UseFileStorageReturn {
  const pickEpub = useCallback(async (bookId: string): Promise<string | null> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/epub+zip',
        copyToCacheDirectory: false,
      });

      if (result.canceled || !result.assets?.[0]) return null;

      const asset = result.assets[0];
      const extension = 'epub';
      const localUri = await cacheFile(asset.uri, bookId, 'epub', extension);
      return localUri;
    } catch (err) {
      logger.error('pickEpub failed', err);
      return null;
    }
  }, []);

  const pickAudio = useCallback(async (bookId: string): Promise<string | null> => {
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
      return localUri;
    } catch (err) {
      logger.error('pickAudio failed', err);
      return null;
    }
  }, []);

  return { pickEpub, pickAudio };
}
