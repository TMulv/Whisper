import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirestoreBook } from '@/types/firebase';
import { deleteCachedFile } from '@/services/storage/localStorageService';

type StoredBook = FirestoreBook & { id: string };

const storeKey = (userId: string) => `@whisper/books/${userId}`;

export async function localListBooks(userId: string): Promise<StoredBook[]> {
  const raw = await AsyncStorage.getItem(storeKey(userId));
  return raw ? (JSON.parse(raw) as StoredBook[]) : [];
}

export async function localWriteBook(
  userId: string,
  bookId: string,
  book: FirestoreBook,
): Promise<void> {
  const existing = await localListBooks(userId);
  const rest = existing.filter((b) => b.id !== bookId);
  rest.push({ ...book, id: bookId });
  await AsyncStorage.setItem(storeKey(userId), JSON.stringify(rest));
}

export async function localDeleteBook(userId: string, bookId: string): Promise<void> {
  const existing = await localListBooks(userId);
  const target = existing.find((b) => b.id === bookId);
  await AsyncStorage.setItem(
    storeKey(userId),
    JSON.stringify(existing.filter((b) => b.id !== bookId)),
  );
  if (target) {
    const paths = [target.epubPath, target.audioPath, target.syncMapPath].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    await Promise.all(paths.map((p) => deleteCachedFile(p)));
  }
}
