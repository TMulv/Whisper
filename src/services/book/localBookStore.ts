import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirestoreBook } from '@/types/firebase';

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
  await AsyncStorage.setItem(
    storeKey(userId),
    JSON.stringify(existing.filter((b) => b.id !== bookId)),
  );
}
