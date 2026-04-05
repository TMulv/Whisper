import firestore from '@react-native-firebase/firestore';
import { FirestoreBook, FirestorePosition } from '@/types/firebase';
import { logger } from '@/utils/logger';

// ── Position writes ──────────────────────────────────────────────────────────

export async function writePosition(
  userId: string,
  bookId: string,
  deviceId: string,
  position: FirestorePosition,
): Promise<void> {
  try {
    await firestore()
      .collection('users')
      .doc(userId)
      .collection('books')
      .doc(bookId)
      .collection('positions')
      .doc(deviceId)
      .set(position);
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
    await firestore()
      .collection('users')
      .doc(userId)
      .collection('books')
      .doc(bookId)
      .collection('syncState')
      .doc('current')
      .set(position);
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
    const doc = await firestore()
      .collection('users')
      .doc(userId)
      .collection('books')
      .doc(bookId)
      .collection('syncState')
      .doc('current')
      .get();
    return doc.data() ? (doc.data() as FirestorePosition) : null;
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
  return firestore()
    .collection('users')
    .doc(userId)
    .collection('books')
    .doc(bookId)
    .collection('syncState')
    .doc('current')
    .onSnapshot((doc) => {
      callback(doc.data() ? (doc.data() as FirestorePosition) : null);
    });
}

// ── Book CRUD ────────────────────────────────────────────────────────────────

export async function writeBook(
  userId: string,
  bookId: string,
  book: FirestoreBook,
): Promise<void> {
  await firestore()
    .collection('users')
    .doc(userId)
    .collection('books')
    .doc(bookId)
    .set(book);
}

export async function listBooks(userId: string): Promise<Array<FirestoreBook & { id: string }>> {
  const snapshot = await firestore()
    .collection('users')
    .doc(userId)
    .collection('books')
    .orderBy('updatedAt', 'desc')
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as FirestoreBook) }));
}
