import { SyncedPosition, PositionConflict } from '@/types/position';
import { writePosition, writeSyncState } from '@/services/firebase/firestoreService';
import { FirestorePosition } from '@/types/firebase';

/**
 * Resolve conflict between local and remote synced positions.
 *
 * Rule (Phase 03 R5): keep whichever position has higher percentComplete.
 * Tiebreaker on equal/missing percent → local (the active session's value
 * is more reliable than a remote stub). The 'prompt' resolution path was
 * removed — there is no UI surface for it.
 */
export function resolvePosition(
  local: SyncedPosition,
  remote: SyncedPosition,
): PositionConflict {
  const remotePercent = Number.isFinite(remote.percentComplete) ? remote.percentComplete : 0;
  const localPercent = Number.isFinite(local.percentComplete) ? local.percentComplete : 0;

  if (remotePercent <= 0) {
    return { local, remote, resolution: 'local' };
  }
  if (localPercent <= 0) {
    return { local, remote, resolution: 'remote' };
  }
  if (Math.abs(remotePercent - localPercent) < 0.01) {
    return { local, remote, resolution: remote.updatedAt > local.updatedAt ? 'remote' : 'local' };
  }
  if (remotePercent > localPercent) {
    return { local, remote, resolution: 'remote' };
  }
  return { local, remote, resolution: 'local' };
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
    ...(position.lastMode !== undefined && { lastMode: position.lastMode }),
  };

  await Promise.all([
    writePosition(userId, bookId, deviceId, firestorePos),
    writeSyncState(userId, bookId, firestorePos),
  ]);
}
