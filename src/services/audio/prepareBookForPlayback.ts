import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedPath, readTextFromCache } from '@/services/storage/localStorageService';
import { parseChaptersJson, createFallbackChapter } from '@/services/audio/m4bParser';
import { localListBooks, localWriteBook } from '@/services/book/localBookStore';
import { probeAudioDuration } from '@/services/audio/audioProbe';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { getOrBuildLayer0 } from '@/services/sync/alignmentStore';
import { readerToAudio } from '@/services/sync/handoff';
import { EpubPosition, AudioPosition } from '@/types/position';
import { logger } from '@/utils/logger';

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
  livePosition?: EpubPosition,
): Promise<PreparedBook | null> {
  const books = await localListBooks(userId);
  const book = books.find((b) => b.id === bookId);
  if (!book) return null;

  const ext = book.audioPath.split('.').pop() ?? 'm4b';
  const localAudioUri = await getCachedPath(bookId, 'audio', ext);
  if (!localAudioUri) return null;

  // Self-heal for books imported before audioProbe wiring landed: if the
  // persisted duration is 0, alignmentBuilder will produce a [0, 0] audio
  // span and every reader→audio handoff resolves to 0:00. Probe and
  // backfill so the next play (and the alignment we're about to build
  // below) uses a real span.
  let totalDurationSeconds = book.totalDurationSeconds;
  if (totalDurationSeconds <= 0) {
    totalDurationSeconds = await probeAudioDuration(localAudioUri);
    if (totalDurationSeconds > 0) {
      try {
        await localWriteBook(userId, bookId, {
          ...book,
          totalDurationSeconds,
          updatedAt: Date.now(),
        });
        logger.info('prepareBookForPlayback: backfilled totalDurationSeconds', {
          bookId,
          totalDurationSeconds,
        });
      } catch (err) {
        logger.warn('prepareBookForPlayback: failed to persist backfilled duration', err);
      }
    } else {
      logger.warn('prepareBookForPlayback: probe returned 0 — sync will be inaccurate', { bookId });
    }
  }

  let chapters = createFallbackChapter(totalDurationSeconds);
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
    totalDurationSeconds,
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
    const audioKey = `${POSITIONS_CACHE_KEY}:${bookId}:audio`;

    // Load both saved positions
    let savedEpubPos: (EpubPosition & { savedAt?: number }) | null = null;
    let savedAudioPos: (AudioPosition & { updatedAt: number }) | null = null;
    try {
      const epubRaw = await AsyncStorage.getItem(epubKey);
      if (epubRaw) savedEpubPos = JSON.parse(epubRaw) as EpubPosition & { savedAt?: number };
    } catch { /* ignore */ }
    try {
      const audioRaw = await AsyncStorage.getItem(audioKey);
      if (audioRaw) savedAudioPos = JSON.parse(audioRaw) as AudioPosition & { updatedAt: number };
    } catch { /* ignore */ }

    // Two distinct intents:
    //   (a) Caller passed livePosition  → "sync audio to where I'm reading"
    //       (handoff from read mode, in-session). Use livePosition.
    //   (b) No livePosition             → "resume listening where I last
    //       listened" (cold open via Play button). Use saved audio
    //       timestamp directly. The saved EPUB position is irrelevant here
    //       and using it would jump the user backward whenever the audio
    //       has progressed past the reader's last page.
    let epubPos: EpubPosition | null = livePosition ?? null;

    // If livePosition's percentComplete is still 0 (LOCATIONS_READY fired
    // without a valid CFI), borrow from saved EPUB for the same chapter.
    if (
      epubPos &&
      epubPos.percentComplete === 0 &&
      savedEpubPos &&
      savedEpubPos.percentComplete > 0 &&
      savedEpubPos.chapterIndex === epubPos.chapterIndex
    ) {
      epubPos = { ...epubPos, percentComplete: savedEpubPos.percentComplete };
    }

    // Cold-open path: prefer the raw saved audio timestamp. Skips the
    // EPUB→audio conversion entirely so the user resumes EXACTLY where the
    // audio stopped.
    if (!livePosition && savedAudioPos && savedAudioPos.timestampSeconds > 0) {
      startTimestamp = savedAudioPos.timestampSeconds;
      logger.info('prepareBookForPlayback: cold-open using saved audio timestamp', {
        timestampSeconds: startTimestamp,
        chapterIndex: savedAudioPos.chapterIndex,
      });
    } else if (epubPos && (epubPos.cfi || epubPos.chapterIndex > 0 || epubPos.percentComplete > 0 || (epubPos.chapterFraction ?? -1) >= 0)) {
      // Use epub position (from live reader or saved)
      const alignment = await getOrBuildLayer0(
        bookId,
        chapters,
        book.totalChapters || chapters.length,
      );
      const result = readerToAudio(epubPos, alignment);
      startTimestamp = result.timestampSeconds;
      logger.info('prepareBookForPlayback: used epub position', {
        epubPercent: epubPos.percentComplete,
        epubChapterIndex: epubPos.chapterIndex,
        resolvedAudioChapter: result.chapterIndex,
        alignmentChapterCount: alignment.chapters.length,
        startTimestamp,
      });
    } else {
      logger.warn('prepareBookForPlayback: no valid position found, starting from beginning', {
        epubPos,
        audioPos: savedAudioPos,
      });
    }

    // Last-resort: if all epub→audio resolution still yields 0 and a raw audio
    // position exists, use it directly to avoid a jarring restart from 0:00.
    if (startTimestamp === 0 && savedAudioPos && savedAudioPos.timestampSeconds > 0) {
      startTimestamp = savedAudioPos.timestampSeconds;
      logger.info('prepareBookForPlayback: fell back to raw audio timestamp', {
        bookId,
        timestampSeconds: startTimestamp,
      });
    }

    logger.info('prepareBookForPlayback: resolving start position', {
      livePercent: livePosition?.percentComplete,
      liveChapterFraction: livePosition?.chapterFraction,
      savedEpubPercent: savedEpubPos?.percentComplete,
      savedAudioSeconds: savedAudioPos?.timestampSeconds,
      resolvedPercent: epubPos?.percentComplete,
      resolvedChapterFraction: epubPos?.chapterFraction,
      chapterIndex: epubPos?.chapterIndex,
      hasCfi: !!epubPos?.cfi,
      startTimestamp,
    });
  } catch (err) {
    logger.warn('prepareBookForPlayback: position resolve failed, starting from beginning', err);
  }

  return { localBook, chapters, startTimestamp };
}
