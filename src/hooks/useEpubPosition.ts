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
        // Save locally as backup. Skip if we have no CFI — that means the
        // bridge hasn't rendered a page yet and we have nothing to restore to.
        // percentComplete is intentionally NOT guarded here: it is 0 until
        // locations.generate() completes (can take seconds), but the CFI is
        // always valid the moment a page renders and is sufficient for restore.
        if (!newPosition.cfi) return;
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
      const pos = raw ? (JSON.parse(raw) as EpubPosition) : null;
      if (pos) setPosition(pos);
      return pos;
    } catch {
      return null;
    }
  }, [bookId]);

  return { position, onPositionChange, loadLocalPosition };
}
