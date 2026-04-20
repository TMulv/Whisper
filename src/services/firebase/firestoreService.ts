import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from '@react-native-firebase/firestore';
import { FirestoreBook, FirestorePosition } from '@/types/firebase';
import { logger } from '@/utils/logger';

const db = getFirestore();

// ── Position writes ──────────────────────────────────────────────────────────

export async function writePosition(
  userId: string,
  bookId: string,
  deviceId: string,
  position: FirestorePosition,
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'users', userId, 'books', bookId, 'positions', deviceId),
      position,
    );
  } catch (err) {
    logger.error('writePosition failed', err);
    throw err;
  }
}

export async function writeSyncState(
  userId: string,
  bookId: string,
  position: FirestorePosition,
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'users', userId, 'books', bookId, 'syncState', 'current'),
      position,
    );
  } catch (err) {
    logger.error('writeSyncState failed', err);
    throw err;
  }
}

// ── Position reads ───────────────────────────────────────────────────────────

export async function readSyncState(
  userId: string,
  bookId: string,
): Promise<FirestorePosition | null> {
  try {
    const snap = await getDoc(
      doc(db, 'users', userId, 'books', bookId, 'syncState', 'current'),
    );
    return snap.exists() ? (snap.data() as FirestorePosition) : null;
  } catch (err) {
    logger.error('readSyncState failed', err);
    return null;
  }
}

export function watchSyncState(
  userId: string,
  bookId: string,
  callback: (position: FirestorePosition | null) => void,
): () => void {
  return onSnapshot(
    doc(db, 'users', userId, 'books', bookId, 'syncState', 'current'),
    (snap) => callback(snap.exists() ? (snap.data() as FirestorePosition) : null),
  );
}

// ── Book CRUD ────────────────────────────────────────────────────────────────

export async function writeBook(
  userId: string,
  bookId: string,
  book: FirestoreBook,
): Promise<void> {
  await setDoc(doc(db, 'users', userId, 'books', bookId), book);
}

export async function deleteBook(userId: string, bookId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'books', bookId));
}

export async function listBooks(userId: string): Promise<Array<FirestoreBook & { id: string }>> {
  const q = query(
    collection(db, 'users', userId, 'books'),
    orderBy('updatedAt', 'desc'),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as FirestoreBook) }));
}
