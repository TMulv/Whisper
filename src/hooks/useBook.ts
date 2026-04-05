import { useState, useEffect } from 'react';
import { LocalBook } from '@/types/book';
import { listBooks } from '@/services/firebase/firestoreService';
import { logger } from '@/utils/logger';

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

    setLoading(true);
    listBooks(userId)
      .then((firestoreBooks) => {
        const localBooks: LocalBook[] = firestoreBooks.map((b) => ({
          id: b.id,
          title: b.title,
          author: b.author,
          coverUri: b.coverUrl ?? null,
          epubPath: b.epubPath,
          audioPath: b.audioPath,
          syncMapPath: b.syncMapPath,
          storageProvider: 'dropbox',
          syncMode: b.syncMode,
          totalChapters: b.totalChapters,
          totalDurationSeconds: b.totalDurationSeconds,
          addedAt: b.addedAt,
          updatedAt: b.updatedAt,
          localEpubUri: null,
          localAudioUri: null,
          isDownloaded: false,
          downloadProgress: 0,
        }));
        setBooks(localBooks);
      })
      .catch((err) => {
        logger.error('useBooks fetch failed', err);
        setError('Failed to load books');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  return { books, loading, error };
}
