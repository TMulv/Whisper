// On-disk cache for chapter plain text, keyed by bookId + epub chapter index.
//
// The aligner needs the prose of each chapter to DTW against whisper's
// transcript, but the text only exists inside the EpubWebView's DOM. The
// reader extracts it on first render and writes it here; the aligner reads
// from here without ever mounting the WebView. That way on-device alignment
// can run opportunistically in the background (e.g. while the user is
// listening on the player screen with the reader closed).
//
// Layout: `${documentDir}/chapterText/${bookId}/ch_${index}.txt`
//
// Each chapter is its own file so we can cheaply check "is chapter N
// cached?" without loading the whole book into memory. We deliberately do
// NOT route through localStorageService's CacheMeta: chapter text is small
// (tens of KB per chapter) and we don't want LRU eviction to wipe out work
// that took minutes of ASR to produce.

import { File, Directory, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { logger } from '@/utils/logger';

const ROOT_DIR = 'chapterText';

function bookDir(bookId: string): Directory {
  return new Directory(Paths.document, ROOT_DIR, bookId);
}

function chapterFile(bookId: string, epubChapterIndex: number): File {
  return new File(bookDir(bookId), `ch_${epubChapterIndex}.txt`);
}

function ensureBookDir(bookId: string): Directory {
  const root = new Directory(Paths.document, ROOT_DIR);
  if (!root.exists) root.create({ intermediates: true });
  const dir = bookDir(bookId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** True if we have cached text for this chapter. */
export function hasCachedChapterText(bookId: string, epubChapterIndex: number): boolean {
  try {
    return chapterFile(bookId, epubChapterIndex).exists;
  } catch {
    return false;
  }
}

export async function readCachedChapterText(
  bookId: string,
  epubChapterIndex: number,
): Promise<string | null> {
  const file = chapterFile(bookId, epubChapterIndex);
  if (!file.exists) return null;
  try {
    return await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    logger.warn('chapterTextCache: read failed', err);
    return null;
  }
}

export async function writeCachedChapterText(
  bookId: string,
  epubChapterIndex: number,
  text: string,
): Promise<void> {
  try {
    ensureBookDir(bookId);
    const file = chapterFile(bookId, epubChapterIndex);
    await FileSystem.writeAsStringAsync(file.uri, text, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (err) {
    logger.warn('chapterTextCache: write failed', err);
  }
}

/** Clear every cached chapter for a book (e.g. on book delete). */
export function clearCachedChaptersForBook(bookId: string): void {
  try {
    const dir = bookDir(bookId);
    if (dir.exists) dir.delete();
  } catch (err) {
    logger.warn('chapterTextCache: clear failed', err);
  }
}
