import { SyncedPosition, PositionConflict } from '@/types/position';
import { AUTO_SYNC_THRESHOLD_MS } from '@/constants/config';
import { writePosition, writeSyncState } from '@/services/firebase/firestoreService';
import { FirestorePosition } from '@/types/firebase';

/**
 * Resolve conflict between local and remote synced positions.
 * - remote > 5 min newer → auto-apply remote
 * - same chapter → keep local (continuity)
 * - otherwise → prompt user
 */
export function resolvePosition(
  local: SyncedPosition,
  remote: SyncedPosition,
): PositionConflict {
  const ageDiff = remote.updatedAt - local.updatedAt;

  if (ageDiff > AUTO_SYNC_THRESHOLD_MS) {
    return { local, remote, resolution: 'remote' };
  }

  if (local.chapterIndex === remote.chapterIndex) {
    return { local, remote, resolution: 'local' };
  }

  return { local, remote, resolution: 'prompt' };
}

/**
 * Persist a position to Firestore: writes both the per-device doc and syncState.
 * Position math (epub ↔ audio conversion) now lives in `services/sync/handoff.ts`
 * and is invoked by the call site before pushing.
 */
export async function pushPosition(
  userId: string,
  bookId: string,
  deviceId: string,
  position: SyncedPosition,
): Promise<void> {
  const firestorePos: FirestorePosition = {
    chapterIndex: position.chapterIndex ?? 0,
    epubCfi: position.epubCfi ?? '',
    charOffset: position.charOffset ?? 0,
    audioTimestamp: position.audioTimestamp ?? 0,
    percentComplete: position.percentComplete ?? 0,
    source: position.source,
    deviceId,
    updatedAt: position.updatedAt,
  };

  await Promise.all([
    writePosition(userId, bookId, deviceId, firestorePos),
    writeSyncState(userId, bookId, firestorePos),
  ]);
}
