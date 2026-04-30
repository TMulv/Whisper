import { useState, useEffect, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { SyncedPosition, PositionConflict } from '@/types/position';
import { readSyncState } from '@/services/firebase/firestoreService';
import { resolvePosition } from '@/services/sync/syncEngine';
import { setCachedPosition } from '@/services/storage/positionStore';
import { FirestorePosition } from '@/types/firebase';
import { logger } from '@/utils/logger';

function firestoreToSynced(pos: FirestorePosition, bookId: string): SyncedPosition {
  return {
    bookId,
    deviceId: pos.deviceId,
    chapterIndex: pos.chapterIndex,
    epubCfi: pos.epubCfi,
    charOffset: pos.charOffset,
    audioTimestamp: pos.audioTimestamp,
    percentComplete: pos.percentComplete,
    source: pos.source,
    updatedAt: pos.updatedAt,
  };
}

export function useSync(
  userId: string | null,
  bookId: string | null,
  localPosition: SyncedPosition | null,
) {
  const [conflict, setConflict] = useState<PositionConflict | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const checkSync = useCallback(async () => {
    if (!userId || !bookId || !localPosition) return;

    setIsSyncing(true);
    try {
      const remote = await readSyncState(userId, bookId);
      if (!remote) return;

      const remoteSynced = firestoreToSynced(remote, bookId);
      const result = resolvePosition(localPosition, remoteSynced);

      if (result.resolution === 'remote') {
        // Auto-apply: caller navigates to remote position. Per Phase 03 R5,
        // resolvePosition only returns 'local' or 'remote' — the 'prompt'
        // branch is unreachable.
        // D-G3 / WR-01: keep positionStore's in-memory cache consistent with
        // the navigation that's about to happen, so a subsequent
        // loadPosition returns the remote value, not the now-stale local.
        setCachedPosition(bookId, {
          cfi: remoteSynced.epubCfi,
          chapterIndex: remoteSynced.chapterIndex,
          charOffset: remoteSynced.charOffset,
          percentComplete: remoteSynced.percentComplete,
          updatedAt: remoteSynced.updatedAt,
        });
        setConflict(result);
      }
      // 'local' → do nothing
    } catch (err) {
      logger.error('useSync.checkSync failed', err);
    } finally {
      setIsSyncing(false);
    }
  }, [userId, bookId, localPosition]);

  // Check sync on app foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkSync();
      }
    });
    return () => subscription.remove();
  }, [checkSync]);

  const dismissConflict = useCallback(() => setConflict(null), []);

  return { conflict, isSyncing, checkSync, dismissConflict };
}
