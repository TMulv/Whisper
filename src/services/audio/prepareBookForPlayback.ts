import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedPath, readTextFromCache } from '@/services/storage/localStorageService';
import { parseChaptersJson, createFallbackChapter } from '@/services/audio/m4bParser';
import { localListBooks } from '@/services/book/localBookStore';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { getOrBuildLayer0 } from '@/services/sync/alignmentStore';
import { readerToAudio } from '@/services/sync/handoff';
import { EpubPosition } from '@/types/position';

export interface PreparedBook {
  localBook: LocalBook;
  chapters: M4BChapter[];
  startTimestamp: number;
}

// Shared helper used by both BookDetailScreen's Play button and the
// Reader's "Start Audio" button so immersion mode can be entered without
// bouncing back to the detail screen first.
export async function prepareBookForPlayback(
  userId: string,
  bookId: string,
): Promise<PreparedBook | null> {
  const books = await localListBooks(userId);
  const book = books.find((b) => b.id === bookId);
  if (!book) return null;

  const ext = book.audioPath.split('.').pop() ?? 'm4b';
  const localAudioUri = await getCachedPath(bookId, 'audio', ext);
  if (!localAudioUri) return null;

  let chapters = createFallbackChapter(book.totalDurationSeconds);
  const json = await readTextFromCache(bookId, 'chapters', 'json');
  if (json) {
    const parsed = parseChaptersJson(json);
    if (parsed.length > 0) chapters = parsed;
  }

  const localBook: LocalBook = {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUri: book.coverUrl ?? null,
    epubPath: book.epubPath,
    audioPath: book.audioPath,
    syncMapPath: book.syncMapPath,
    storageProvider: 'local',
    syncMode: book.syncMode,
    totalChapters: book.totalChapters,
    totalDurationSeconds: book.totalDurationSeconds,
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    localEpubUri: null,
    localAudioUri,
    isDownloaded: true,
    downloadProgress: 1,
  };

  // Start audio at the current epub reading position so opening the player
  // from the reader feels continuous, not a jarring restart. Uses the handoff
  // resolver instead of raw percent-of-book math so front matter and variable
  // narrator pacing don't push the start point out of the right chapter.
  let startTimestamp = 0;
  try {
    const epubKey = `${POSITIONS_CACHE_KEY}:${bookId}:epub`;
    const raw = await AsyncStorage.getItem(epubKey);
    if (raw) {
      const epubPos = JSON.parse(raw) as EpubPosition;
      if (
        typeof epubPos?.percentComplete === 'number' &&
        epubPos.percentComplete > 0
      ) {
        const alignment = await getOrBuildLayer0(
          bookId,
          chapters,
          book.totalChapters || chapters.length,
        );
        startTimestamp = readerToAudio(epubPos, alignment).timestampSeconds;
      }
    }
  } catch {
    /* ignore */
  }

  return { localBook, chapters, startTimestamp };
}
