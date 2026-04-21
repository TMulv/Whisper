// Concrete EpubTextProvider / BookInfoProvider impls for the on-device
// aligner. These are the glue between the aligner's abstract deps (see
// onDeviceAligner.ts) and the app's storage layer.
//
// We keep them in their own module (rather than inlining at app init) so
// tests can import fakes without dragging in AsyncStorage + File APIs, and
// so the aligner remains a pure function of its injected dependencies.

import {
  EpubTextProvider,
  BookInfoProvider,
} from './onDeviceAligner';
import { M4BChapter } from '@/types/sync';
import { EpubToken } from './dtw';
import { readCachedChapterText } from './chapterTextCache';
import { tokenizeChapter } from './epubTokenizer';
import { getAlignment } from './alignmentStore';
import { localListBooks } from '@/services/book/localBookStore';
import {
  getCachedPath,
  readTextFromCache,
} from '@/services/storage/localStorageService';
import {
  parseChaptersJson,
  createFallbackChapter,
} from '@/services/audio/m4bParser';
import { logger } from '@/utils/logger';

// ── EpubTextProvider ────────────────────────────────────────────────────────

/**
 * Uses the chapter-text cache populated by the reader. If the user hasn't
 * opened a chapter yet, we return an empty token list and the aligner
 * records an empty anchor set — no retry churn. Once the chapter is cached,
 * the next enqueue will pick it up.
 */
export function createEpubTextProvider(): EpubTextProvider {
  return {
    async getChapterTokens(
      bookId: string,
      epubChapterIndex: number,
    ): Promise<EpubToken[]> {
      const text = await readCachedChapterText(bookId, epubChapterIndex);
      if (!text) return [];

      // Chapter percent-span: we need the chapter's [start, end] in book
      // percent to interpolate each token's percentComplete. That lives in
      // BookAlignment (L0) — look it up and default to the full book if
      // absent (shouldn't happen, but be defensive).
      const alignment = await getAlignment(bookId);
      const chapter = alignment?.chapters.find(
        (c) => c.epubChapterIndex === epubChapterIndex,
      );
      const span = chapter
        ? {
            epubChapterIndex,
            epubPercentStart: chapter.epubPercentStart,
            epubPercentEnd: chapter.epubPercentEnd,
          }
        : {
            epubChapterIndex,
            epubPercentStart: 0,
            epubPercentEnd: 1,
          };

      return tokenizeChapter(text, span);
    },
  };
}

// ── BookInfoProvider ────────────────────────────────────────────────────────

/**
 * Reads local audio path and parsed M4B chapters. The aligner runs only
 * for downloaded books, so missing local files → null audio path → the
 * aligner records the error and reschedules; once the book is downloaded
 * it will succeed on retry.
 */
export function createBookInfoProvider(
  getUserId: () => string | null,
): BookInfoProvider {
  return {
    async getAudioPath(bookId: string): Promise<string | null> {
      const userId = getUserId();
      if (!userId) return null;
      try {
        const books = await localListBooks(userId);
        const book = books.find((b) => b.id === bookId);
        if (!book?.audioPath) return null;
        const ext = book.audioPath.split('.').pop() ?? 'm4b';
        return await getCachedPath(bookId, 'audio', ext);
      } catch (err) {
        logger.warn('BookInfoProvider: getAudioPath failed', err);
        return null;
      }
    },

    async getChapters(bookId: string): Promise<M4BChapter[]> {
      const userId = getUserId();
      if (!userId) return [];
      try {
        const json = await readTextFromCache(bookId, 'chapters', 'json');
        if (json) {
          const parsed = parseChaptersJson(json);
          if (parsed.length > 0) return parsed;
        }
        // Fallback: a single full-duration chapter. Matches what
        // prepareBookForPlayback does for books without a chapters.json.
        const books = await localListBooks(userId);
        const book = books.find((b) => b.id === bookId);
        if (!book) return [];
        return createFallbackChapter(book.totalDurationSeconds);
      } catch (err) {
        logger.warn('BookInfoProvider: getChapters failed', err);
        return [];
      }
    },
  };
}
