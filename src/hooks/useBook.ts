import React, { useState, useEffect, useCallback } from 'react';
import { File } from 'expo-file-system';
import { LocalBook, SyncMode } from '@/types/book';
import { listBooks, writeBook, deleteBook } from '@/services/firebase/firestoreService';
import { localListBooks, localWriteBook, localDeleteBook } from '@/services/book/localBookStore';
import { fetchBookCover } from '@/services/book/coverLookupService';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { logger } from '@/utils/logger';
import { getBookDisplay } from '@/utils/bookDisplay';

// ── One-shot migration: drop the `aeneas` SyncMode ─────────────────────────
// Legacy books may have `syncMode: 'aeneas'` — the standalone Mac-side
// aeneas workflow is replaced by on-device Whisper + the cloud worker.
// Rewrite to 'chapter' (the safe default that works for every book) on
// first read. Firestore rewrite is fire-and-forget so offline clients
// still get the local fix immediately.
//
// `SyncMode` no longer includes 'aeneas', so we take `unknown` and narrow
// to avoid a never-matching comparison at the type level.
const migrationsRun = new Set<string>();

async function migrateAeneasSyncMode(
  userId: string,
  books: ReadonlyArray<{ id: string; syncMode: string }>,
): Promise<void> {
  if (migrationsRun.has(userId)) return;
  migrationsRun.add(userId);

  const stale = books.filter((b) => b.syncMode === 'aeneas');
  if (stale.length === 0) return;

  logger.info('Migrating legacy aeneas syncMode to chapter', {
    userId,
    count: stale.length,
  });

  for (const b of stale) {
    const migrated = {
      ...(b as unknown as Parameters<typeof localWriteBook>[2]),
      syncMode: 'chapter' as SyncMode,
      updatedAt: Date.now(),
    };
    try {
      await localWriteBook(userId, b.id, migrated);
    } catch (err) {
      logger.warn('aeneas migration: local write failed', err);
    }
    writeBook(userId, b.id, migrated).catch((err) =>
      logger.warn('aeneas migration: firestore write failed', err),
    );
  }
}

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
    const d = getBookDisplay(book);
    const url = await fetchBookCover(d.title, d.author || undefined);
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

    // BookRow.syncMode is `string` (not `SyncMode`) because legacy rows
    // may still carry 'aeneas' before the migration below rewrites them.
    type BookRow = { id: string; title: string; author: string; coverUrl?: string | null; epubPath: string; audioPath: string; syncMapPath: string | null; syncMode: string; totalChapters: number; totalDurationSeconds: number; addedAt: number; updatedAt: number };
    const normalizeSyncMode = (raw: string): SyncMode =>
      raw === 'percentage' ? 'percentage' : 'chapter';
    const toLocalBook = (b: BookRow): LocalBook => ({
      id: b.id,
      title: b.title,
      author: b.author,
      coverUri: b.coverUrl ?? null,
      epubPath: b.epubPath,
      audioPath: b.audioPath,
      syncMapPath: b.syncMapPath,
      storageProvider: 'local',
      syncMode: normalizeSyncMode(b.syncMode),
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
        // Run the aeneas→chapter migration on the raw stored rows before
        // normalizing — the migration rewrites both local + Firestore
        // copies; toLocalBook then downgrades any still-stale values so
        // the in-memory state is always clean.
        await migrateAeneasSyncMode(userId, stored);
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
