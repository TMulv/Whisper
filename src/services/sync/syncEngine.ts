import { SyncedPosition, PositionConflict, EpubPosition, AudioPosition } from '@/types/position';
import { BookSyncMap } from '@/types/sync';
import { AUTO_SYNC_THRESHOLD_MS } from '@/constants/config';
import { epubPositionToAudio, audioPositionToEpub } from './chapterMapper';
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
 * Convert between epub and audio positions using the book's sync map.
 */
export function convertPosition(
  from: 'epub' | 'audio',
  position: EpubPosition | AudioPosition,
  deviceId: string,
  bookId: string,
  syncMap: BookSyncMap,
): SyncedPosition {
  const now = Date.now();

  if (from === 'epub') {
    const ep = position as EpubPosition;
    const audio = epubPositionToAudio(ep, syncMap);
    return {
      bookId,
      deviceId,
      chapterIndex: ep.chapterIndex,
      epubCfi: ep.cfi,
      charOffset: ep.charOffset,
      audioTimestamp: audio.timestampSeconds,
      percentComplete: ep.percentComplete,
      source: 'epub',
      updatedAt: now,
    };
  } else {
    const ap = position as AudioPosition;
    const epub = audioPositionToEpub(ap, syncMap);
    return {
      bookId,
      deviceId,
      chapterIndex: ap.chapterIndex,
      epubCfi: epub.cfi,
      charOffset: epub.charOffset,
      audioTimestamp: ap.timestampSeconds,
      percentComplete: ap.percentComplete,
      source: 'audio',
      updatedAt: now,
    };
  }
}

/**
 * Persist a position to Firestore: writes both the per-device doc and syncState.
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
