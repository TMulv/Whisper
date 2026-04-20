import React, { useState, useEffect, useCallback } from 'react';
import { LocalBook } from '@/types/book';
import { listBooks, writeBook } from '@/services/firebase/firestoreService';
import { localListBooks, localWriteBook, localDeleteBook } from '@/services/book/localBookStore';
import { fetchBookCover } from '@/services/book/coverLookupService';
import { logger } from '@/utils/logger';

async function backfillMissingCovers(
  userId: string,
  books: LocalBook[],
  setBooks: React.Dispatch<React.SetStateAction<LocalBook[]>>,
) {
  const missing = books.filter((b) => !b.coverUri);
  if (missing.length === 0) return;

  for (const book of missing) {
    const url = await fetchBookCover(book.title, book.author || undefined);
    if (!url) continue;

    setBooks((prev) =>
      prev.map((b) => (b.id === book.id ? { ...b, coverUri: url } : b)),
    );

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

  useEffect(() => {
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

    // Load from local store immediately so the UI is never blocked by network
    localListBooks(userId)
      .then((stored) => {
        if (stored.length > 0) {
          const localBooks = stored.map(toLocalBook);
          setBooks(localBooks);
          setLoading(false);
          backfillMissingCovers(userId, localBooks, setBooks);
        }
      })
      .catch((err) => logger.error('localListBooks failed', err));

    // Sync from Firestore in the background — updates if online
    listBooks(userId)
      .then((firestoreBooks) => {
        const localBooks = firestoreBooks.map(toLocalBook);
        setBooks(localBooks);
        setLoading(false);
        backfillMissingCovers(userId, localBooks, setBooks);
      })
      .catch((err) => {
        logger.error('useBooks Firestore fetch failed', err);
        setLoading(false);
        if (books.length === 0) setError('Failed to load books');
      });
  }, [userId]);

  const removeBook = useCallback(async (bookId: string) => {
    if (!userId) return;
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    await localDeleteBook(userId, bookId);
  }, [userId]);

  return { books, loading, error, removeBook };
}
