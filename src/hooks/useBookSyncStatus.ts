// Composite state for a single book's sync UI. Merges:
// - Local BookAlignment (L0 + any L1 anchors stored on device)
// - Remote FirestoreAlignmentStatus (cloud worker progress, if applicable)
//
// Consumers: SyncBadge (status + progress fraction), SyncStatusSheet (the
// full alignment payload), and any "syncing" copy on the library card.

import { useEffect, useState } from 'react';
import { BookAlignment } from '@/types/sync';
import { FirestoreAlignmentStatus } from '@/types/firebase';
import { getAlignment } from '@/services/sync/alignmentStore';
import { watchAndMergeAlignment } from '@/services/firebase/alignmentJobs';

export interface BookSyncState {
  alignment: BookAlignment | null;
  remoteStatus: FirestoreAlignmentStatus | null;
  /** 0..1 fraction of chapters with L1 anchors. */
  progress: number;
  /** True while a cloud job is running or the on-device queue hasn't finished. */
  processing: boolean;
}

export function useBookSyncStatus(
  userId: string | null,
  bookId: string | null,
): BookSyncState {
  const [alignment, setAlignment] = useState<BookAlignment | null>(null);
  const [remoteStatus, setRemoteStatus] =
    useState<FirestoreAlignmentStatus | null>(null);

  // Initial + refresh on bookId change
  useEffect(() => {
    let cancelled = false;
    if (!bookId) {
      setAlignment(null);
      return;
    }
    getAlignment(bookId).then((a) => {
      if (!cancelled) setAlignment(a);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // Remote watcher: keeps the alignment store in sync with cloud writes and
  // feeds us status updates for the badge/sheet.
  useEffect(() => {
    if (!userId || !bookId) {
      setRemoteStatus(null);
      return;
    }
    const unsubscribe = watchAndMergeAlignment(userId, bookId, (status) => {
      setRemoteStatus(status);
      // Re-read the alignment on each remote update — the merger writes
      // through, so this picks up new anchors.
      getAlignment(bookId).then((a) => setAlignment(a));
    });
    return unsubscribe;
  }, [userId, bookId]);

  const total = alignment?.chapters.length ?? 0;
  const filled = alignment
    ? Object.values(alignment.l1Anchors).filter((l) => l && l.length > 0).length
    : 0;
  const progress = total > 0 ? filled / total : 0;
  const processing =
    alignment?.status === 'processing' ||
    remoteStatus?.status === 'processing' ||
    (total > 0 && filled > 0 && filled < total);

  return { alignment, remoteStatus, progress, processing: !!processing };
}
