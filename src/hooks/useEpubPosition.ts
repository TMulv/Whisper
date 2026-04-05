import { useState, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EpubPosition } from '@/types/position';
import { POSITION_WRITE_DEBOUNCE_MS, POSITIONS_CACHE_KEY } from '@/constants/config';
import { logger } from '@/utils/logger';

export function useEpubPosition(bookId: string, userId: string | null) {
  const [position, setPosition] = useState<EpubPosition | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPositionChange = useCallback(
    (newPosition: EpubPosition, onPersist?: (pos: EpubPosition) => void) => {
      setPosition(newPosition);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        // Save locally as backup
        try {
          const key = `${POSITIONS_CACHE_KEY}:${bookId}:epub`;
          await AsyncStorage.setItem(key, JSON.stringify(newPosition));
        } catch (err) {
          logger.warn('Failed to cache epub position locally', err);
        }

        // Notify caller (useSync hook will handle Firestore write)
        onPersist?.(newPosition);
      }, POSITION_WRITE_DEBOUNCE_MS);
    },
    [bookId],
  );

  const loadLocalPosition = useCallback(async (): Promise<EpubPosition | null> => {
    try {
      const key = `${POSITIONS_CACHE_KEY}:${bookId}:epub`;
      const raw = await AsyncStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [bookId]);

  return { position, onPositionChange, loadLocalPosition };
}
