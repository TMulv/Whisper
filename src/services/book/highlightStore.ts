import AsyncStorage from '@react-native-async-storage/async-storage';
import { Highlight } from '@/types/highlight';

const key = (bookId: string) => `@whisper/highlights:${bookId}`;

export async function loadHighlights(bookId: string): Promise<Highlight[]> {
  try {
    const raw = await AsyncStorage.getItem(key(bookId));
    if (!raw) return [];
    return JSON.parse(raw) as Highlight[];
  } catch {
    return [];
  }
}

export async function saveHighlight(highlight: Highlight): Promise<void> {
  const list = await loadHighlights(highlight.bookId);
  const idx = list.findIndex((h) => h.id === highlight.id);
  if (idx >= 0) {
    list[idx] = highlight;
  } else {
    list.push(highlight);
  }
  await AsyncStorage.setItem(key(highlight.bookId), JSON.stringify(list));
}

export async function deleteHighlight(bookId: string, id: string): Promise<void> {
  const list = await loadHighlights(bookId);
  await AsyncStorage.setItem(
    key(bookId),
    JSON.stringify(list.filter((h) => h.id !== id)),
  );
}
