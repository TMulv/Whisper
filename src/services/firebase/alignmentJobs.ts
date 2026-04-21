// Client-side API for the cloud alignment worker.
//
// The app writes a job doc; a Firebase Function picks it up, quota-checks it,
// and forwards to Cloud Run. Progress updates flow back through a per-book
// status doc the app subscribes to. On completion, the app merges the
// freshly-written anchor docs into the local BookAlignment.

import {
  getFirestore,
  doc,
  collection,
  setDoc,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from '@react-native-firebase/firestore';
import {
  FirestoreAlignmentJob,
  FirestoreAlignmentStatus,
  AlignmentJobSource,
} from '@/types/firebase';
import { SentenceAnchor, BookAlignment } from '@/types/sync';
import { getAlignment, saveAlignment } from '@/services/sync/alignmentStore';
import { logger } from '@/utils/logger';

const db = getFirestore();

export interface EnqueueJobInput {
  userId: string;
  bookId: string;
  source: AlignmentJobSource;
  /** Short-lived token — caller is responsible for refreshing before the call. */
  accessToken: string;
  audioFileId: string;
  epubFileId: string;
}

/**
 * Enqueue one alignment job for the cloud worker. Returns the server-assigned
 * job id so the caller can watch it if desired.
 */
export async function enqueueAlignmentJob(
  input: EnqueueJobInput,
): Promise<string> {
  const payload: Omit<FirestoreAlignmentJob, 'createdAt'> & {
    createdAt: ReturnType<typeof serverTimestamp> | number;
  } = {
    ...input,
    status: 'pending',
    createdAt: Date.now(),
  };
  // addDoc generates the id; we persist nothing locally about the job itself —
  // the status doc is the source of truth the app reads from.
  const ref = await addDoc(collection(db, 'alignmentJobs'), payload);
  logger.info('enqueued alignment job', { jobId: ref.id, bookId: input.bookId });
  return ref.id;
}

/**
 * Subscribe to per-book alignment progress. Worker updates this doc as each
 * chapter completes — roughly once every minute or two for a typical book.
 */
export function watchAlignmentStatus(
  userId: string,
  bookId: string,
  callback: (status: FirestoreAlignmentStatus | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'users', userId, 'books', bookId, 'alignment', 'status'),
    (snap) =>
      callback(snap.exists() ? (snap.data() as FirestoreAlignmentStatus) : null),
  );
}

interface ChapterAnchorsDoc {
  anchors: SentenceAnchor[];
  updatedAt: number | Timestamp;
}

/**
 * One-shot: pull every chapter anchor doc for a book, merge into the local
 * alignment. Called on app resume once the status doc reports `complete` (or
 * opportunistically when a chapter flips to ready during a session).
 */
export async function mergeCloudAnchors(
  userId: string,
  bookId: string,
): Promise<BookAlignment | null> {
  const snap = await getDocs(
    query(
      collection(db, 'users', userId, 'books', bookId, 'alignment'),
      orderBy('updatedAt', 'asc'),
    ),
  );
  const existing = await getAlignment(bookId);
  if (!existing) return null;

  const updated: BookAlignment = {
    ...existing,
    l1Anchors: { ...existing.l1Anchors },
    updatedAt: Date.now(),
  };

  for (const d of snap.docs) {
    const id = d.id;
    if (id === 'status') continue;
    const data = d.data() as ChapterAnchorsDoc;
    const chapterIndex = Number(id);
    if (!Number.isFinite(chapterIndex)) continue;
    if (!Array.isArray(data.anchors)) continue;
    updated.l1Anchors[chapterIndex] = data.anchors;
  }

  const total = updated.chapters.length;
  const filled = Object.values(updated.l1Anchors).filter(
    (list) => list && list.length > 0,
  ).length;
  updated.status = filled >= total && total > 0 ? 'complete' : 'processing';

  await saveAlignment(updated);
  return updated;
}

/**
 * Alternative subscription that yields merged anchors as each chapter lands.
 * Heavier than `watchAlignmentStatus` (one read per chapter doc per update),
 * so prefer this only on screens that visualise per-chapter progress.
 */
export function watchChapterAnchors(
  userId: string,
  bookId: string,
  callback: (chapterIndex: number, anchors: SentenceAnchor[]) => void,
): () => void {
  return onSnapshot(
    collection(db, 'users', userId, 'books', bookId, 'alignment'),
    (qs) => {
      qs.docChanges().forEach((change) => {
        if (change.doc.id === 'status') return;
        const idx = Number(change.doc.id);
        if (!Number.isFinite(idx)) return;
        const data = change.doc.data() as ChapterAnchorsDoc;
        if (Array.isArray(data.anchors)) {
          callback(idx, data.anchors);
        }
      });
    },
  );
}

/**
 * Convenience composite: set up both the status watcher and chapter-anchor
 * merges in one call. Returns an unsubscriber that tears everything down.
 */
export function watchAndMergeAlignment(
  userId: string,
  bookId: string,
  onStatus: (status: FirestoreAlignmentStatus | null) => void,
): () => void {
  const unStatus = watchAlignmentStatus(userId, bookId, async (status) => {
    onStatus(status);
    if (status?.status === 'complete') {
      await mergeCloudAnchors(userId, bookId).catch((err) =>
        logger.warn('mergeCloudAnchors failed', err),
      );
    }
  });
  const unAnchors = watchChapterAnchors(userId, bookId, async (idx, anchors) => {
    const existing = await getAlignment(bookId);
    if (!existing) return;
    const updated: BookAlignment = {
      ...existing,
      l1Anchors: { ...existing.l1Anchors, [idx]: anchors },
      updatedAt: Date.now(),
    };
    // Intentionally not bumping status here — the status doc is authoritative.
    await saveAlignment(updated);
  });
  return () => {
    unStatus();
    unAnchors();
  };
}

// Intentional no-op export so `serverTimestamp` stays importable — tests may
// want to stamp createdAt deterministically.
export { serverTimestamp };
