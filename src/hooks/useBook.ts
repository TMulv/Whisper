import React, { useState, useEffect, useCallback } from 'react';
import { File } from 'expo-file-system';
import { LocalBook } from '@/types/book';
import { listBooks, writeBook, deleteBook } from '@/services/firebase/firestoreService';
import { localListBooks, localWriteBook, localDeleteBook } from '@/services/book/localBookStore';
import { fetchBookCover } from '@/services/book/coverLookupService';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { logger } from '@/utils/logger';

function fileExists(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

async function pruneMissingBooks(
  userId: string,
  books: LocalBook[],
): Promise<LocalBook[]> {
  const kept: LocalBook[] = [];
  for (const b of books) {
    if (fileExists(b.epubPath) && fileExists(b.audioPath)) {
      kept.push(b);
      continue;
    }
    logger.info('Pruning book with missing files', {
      bookId: b.id,
      title: b.title,
      epubMissing: !fileExists(b.epubPath),
      audioMissing: !fileExists(b.audioPath),
    });
    localDeleteBook(userId, b.id).catch((err) =>
      logger.warn('localDeleteBook during prune failed', err),
    );
    deleteBook(userId, b.id).catch(() => {});
  }
  return kept;
}

async function backfillMissingCovers(
  userId: string,
  books: LocalBook[],
  setBooks: React.Dispatch<React.SetStateAction<LocalBook[]>>,
  onCoverFetched?: (bookId: string, coverUri: string) => void,
) {
  const missing = books.filter((b) => !b.coverUri);
  if (missing.length === 0) return;

  for (const book of missing) {
    const url = await fetchBookCover(book.title, book.author || undefined);
    if (!url) continue;

    setBooks((prev) =>
      prev.map((b) => (b.id === book.id ? { ...b, coverUri: url } : b)),
    );
    onCoverFetched?.(book.id, url);

    try {
      await writeBook(userId, book.id, {
        title: book.title,
        author: book.author,
        coverUrl: url,
        epubPath: book.epubPath,
        audioPath: book.audioPath,
        syncMapPath: book.syncMapPath,
        totalChapters: book.totalChapters,
        totalDurationSeconds: book.totalDurationSeconds,
        syncMode: book.syncMode,
        addedAt: book.addedAt,
        updatedAt: book.updatedAt,
      });
    } catch (err) {
      logger.error('backfillMissingCovers writeBook failed', err);
    }
  }
}

export function useBooks(userId: string | null) {
  const [books, setBooks] = useState<LocalBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { updateBookCover, book: nowPlayingBook, clearNowPlaying } = useNowPlaying();

  // Keep refs so our async/callback code sees the current values without
  // re-running the load effect when the now-playing book changes.
  const nowPlayingIdRef = React.useRef<string | null>(null);
  nowPlayingIdRef.current = nowPlayingBook?.id ?? null;
  const clearNowPlayingRef = React.useRef(clearNowPlaying);
  clearNowPlayingRef.current = clearNowPlaying;

  const maybeClearNowPlaying = useCallback((removedIds: string[]) => {
    const currentId = nowPlayingIdRef.current;
    if (currentId && removedIds.includes(currentId)) {
      clearNowPlayingRef.current().catch((err) =>
        logger.warn('clearNowPlaying after removal failed', err),
      );
    }
  }, []);

  const refresh = useCallback(() => {
    if (!userId) {
      setBooks([]);
      setLoading(false);
      return;
    }

    type BookRow = { id: string; title: string; author: string; coverUrl?: string | null; epubPath: string; audioPath: string; syncMapPath: string | null; syncMode: LocalBook['syncMode']; totalChapters: number; totalDurationSeconds: number; addedAt: number; updatedAt: number };
    const toLocalBook = (b: BookRow): LocalBook => ({
      id: b.id,
      title: b.title,
      author: b.author,
      coverUri: b.coverUrl ?? null,
      epubPath: b.epubPath,
      audioPath: b.audioPath,
      syncMapPath: b.syncMapPath,
      storageProvider: 'local',
      syncMode: b.syncMode,
      totalChapters: b.totalChapters,
      totalDurationSeconds: b.totalDurationSeconds,
      addedAt: b.addedAt,
      updatedAt: b.updatedAt,
      localEpubUri: null,
      localAudioUri: null,
      isDownloaded: false,
      downloadProgress: 0,
    });

    setLoading(true);

    const applyPruned = (pruned: LocalBook[], input: LocalBook[]) => {
      const keptIds = new Set(pruned.map((b) => b.id));
      const removedIds = input.map((b) => b.id).filter((id) => !keptIds.has(id));
      if (removedIds.length > 0) maybeClearNowPlaying(removedIds);
    };

    // Load from local store immediately so the UI is never blocked by network
    localListBooks(userId)
      .then(async (stored) => {
        const localBooks = stored.map(toLocalBook);
        const pruned = await pruneMissingBooks(userId, localBooks);
        applyPruned(pruned, localBooks);
        setBooks(pruned);
        setLoading(false);
        // Covers are now chosen explicitly via CoverPickerModal on BookDetail;
        // no auto-backfill here to respect user's cover choice.
      })
      .catch((err) => logger.error('localListBooks failed', err));

    // Sync from Firestore in the background — updates if online
    listBooks(userId)
      .then(async (firestoreBooks) => {
        const localBooks = firestoreBooks.map(toLocalBook);
        const pruned = await pruneMissingBooks(userId, localBooks);
        applyPruned(pruned, localBooks);
        setBooks(pruned);
        setLoading(false);
        backfillMissingCovers(userId, pruned, setBooks, updateBookCover);
      })
      .catch((err) => {
        logger.error('useBooks Firestore fetch failed', err);
        setLoading(false);
        setError((prev) => prev ?? 'Failed to load books');
      });
  }, [userId, maybeClearNowPlaying, updateBookCover]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const removeBook = useCallback(async (bookId: string) => {
    if (!userId) return;
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    maybeClearNowPlaying([bookId]);
    await localDeleteBook(userId, bookId);
  }, [userId, maybeClearNowPlaying]);

  return { books, loading, error, removeBook, refresh };
}
