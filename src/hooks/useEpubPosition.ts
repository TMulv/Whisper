import { useState, useCallback } from 'react';
import {
  loadPosition,
  type EpubLastPosition,
} from '@/services/storage/positionStore';
import type { EpubPosition } from '@/types/position';
import { logger } from '@/utils/logger';

/**
 * Read-only React state holder for the current EPUB position.
 *
 * Phase 03: writes are routed through positionStore from ReaderView's three
 * save triggers (AppState→background, chapter-change, 30s debounce). This
 * hook does not write — it only mirrors bridge events into React state and
 * loads the cold-open value.
 *
 * `setFromBridge` accepts the bridge's wider `EpubPosition` and projects
 * down to the persistable `EpubLastPosition` shape.
 */
export function useEpubPosition(bookId: string) {
  const [position, setPosition] = useState<EpubLastPosition | null>(null);

  const setFromBridge = useCallback((p: EpubPosition) => {
    setPosition({
      cfi: p.cfi,
      chapterIndex: p.chapterIndex,
      charOffset: p.charOffset,
      percentComplete: p.percentComplete,
      updatedAt: Date.now(),
    });
  }, []);

  const loadLocalPosition = useCallback(async () => {
    const loaded = await loadPosition(bookId);
    if (loaded) setPosition(loaded);
    logger.debug('useEpubPosition: loadLocalPosition', {
      bookId,
      hasValue: !!loaded,
    });
    return loaded;
  }, [bookId]);

  return { position, setFromBridge, loadLocalPosition };
}
