import AsyncStorage from '@react-native-async-storage/async-storage';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
import { pushPosition } from '@/services/sync/syncEngine';
import type { SyncedPosition } from '@/types/position';
import { logger } from '@/utils/logger';

export type EpubLastPosition = {
  cfi: string;
  chapterIndex: number;
  charOffset: number;
  percentComplete: number;
  updatedAt: number;
};

type RestoreCheck = () => boolean;

const memoryCache = new Map<string, EpubLastPosition>();
const restoreChecks = new Map<string, RestoreCheck>();

const epubKey = (bookId: string): string =>
  `${POSITIONS_CACHE_KEY}:${bookId}:epub`;

export function registerRestoreCheck(
  bookId: string,
  check: RestoreCheck | null,
): void {
  if (check) restoreChecks.set(bookId, check);
  else restoreChecks.delete(bookId);
}

export function savePosition(
  bookId: string,
  pos: EpubLastPosition,
  opts: { userId?: string | null; deviceId?: string | null; trigger: string },
): void {
  const check = restoreChecks.get(bookId);
  const restoreInProgress = check && check();
  if (restoreInProgress) {
    logger.warn('positionStore: save skipped (restore in progress)', {
      bookId,
      trigger: opts.trigger,
      chapterIndex: pos.chapterIndex,
      restoreCheckPresent: !!check,
    });
    return;
  }
  if (!pos.cfi) {
    logger.debug('positionStore: save skipped (no cfi)', {
      bookId,
      trigger: opts.trigger,
    });
    return;
  }

  memoryCache.set(bookId, pos);

  AsyncStorage.setItem(epubKey(bookId), JSON.stringify(pos)).catch((err) => {
    logger.warn('positionStore: local write failed', { bookId, err });
  });

  if (opts.userId && opts.deviceId) {
    const synced: SyncedPosition = {
      bookId,
      deviceId: opts.deviceId,
      chapterIndex: pos.chapterIndex,
      epubCfi: pos.cfi,
      charOffset: pos.charOffset,
      audioTimestamp: 0,
      percentComplete: pos.percentComplete,
      source: 'epub',
      updatedAt: pos.updatedAt,
    };
    pushPosition(opts.userId, bookId, opts.deviceId, synced).catch((err) => {
      logger.warn('positionStore: remote push failed', { bookId, err });
    });
  }

  logger.debug('positionStore: saved', {
    bookId,
    trigger: opts.trigger,
    chapterIndex: pos.chapterIndex,
    percent: pos.percentComplete,
  });
}

export async function loadPosition(
  bookId: string,
): Promise<EpubLastPosition | null> {
  const cached = memoryCache.get(bookId);
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(epubKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EpubLastPosition;
    memoryCache.set(bookId, parsed);
    return parsed;
  } catch (err) {
    logger.warn('positionStore: load failed', { bookId, err });
    return null;
  }
}

export function setCachedPosition(bookId: string, pos: EpubLastPosition): void {
  memoryCache.set(bookId, pos);
}

export function resolveByMaxPercent(
  local: EpubLastPosition,
  remote: EpubLastPosition,
): 'local' | 'remote' {
  const remotePercent = Number.isFinite(remote.percentComplete)
    ? remote.percentComplete
    : 0;
  const localPercent = Number.isFinite(local.percentComplete)
    ? local.percentComplete
    : 0;
  if (remotePercent <= 0) return 'local';
  if (localPercent <= 0) return 'remote';
  return remotePercent > localPercent ? 'remote' : 'local';
}

export function _resetForTests(): void {
  memoryCache.clear();
  restoreChecks.clear();
}
