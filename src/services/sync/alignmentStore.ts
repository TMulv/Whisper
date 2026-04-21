import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookAlignment, M4BChapter, SentenceAnchor } from '@/types/sync';
import { buildLayer0 } from './alignmentBuilder';

// Persistence for BookAlignment. AsyncStorage is adequate for Phase 1 — a
// single record per book, read at handoff time. Move to SQLite in Phase 2
// when L1 anchor lists grow large enough to warrant it.

const keyFor = (bookId: string) => `@whisper/alignment/${bookId}`;

const memCache = new Map<string, BookAlignment>();

export async function getAlignment(bookId: string): Promise<BookAlignment | null> {
  const cached = memCache.get(bookId);
  if (cached) return cached;

  try {
    const raw = await AsyncStorage.getItem(keyFor(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookAlignment;
    memCache.set(bookId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAlignment(alignment: BookAlignment): Promise<void> {
  memCache.set(alignment.bookId, alignment);
  await AsyncStorage.setItem(
    keyFor(alignment.bookId),
    JSON.stringify(alignment),
  );
}

export async function deleteAlignment(bookId: string): Promise<void> {
  memCache.delete(bookId);
  await AsyncStorage.removeItem(keyFor(bookId));
}

/**
 * Fetch existing alignment or build a fresh Layer 0 if absent. Used at handoff
 * time so the first reader↔audio transition for a newly-imported book still
 * gets chapter-accurate handoff without requiring an explicit build step.
 */
export async function getOrBuildLayer0(
  bookId: string,
  audioChapters: M4BChapter[],
  epubChapterCount: number,
): Promise<BookAlignment> {
  const existing = await getAlignment(bookId);
  if (existing && existing.chapters.length > 0) return existing;

  const built = buildLayer0({ bookId, audioChapters, epubChapterCount });
  await saveAlignment(built);
  return built;
}

/**
 * Rebuild L0 if the stored alignment disagrees with the current chapter
 * counts (e.g. the provisional alignment was built at import using
 * book.totalChapters as a placeholder, and the reader has since reported the
 * real epub spine length). Preserves any L1 anchors that still map cleanly.
 */
export async function ensureLayer0Fresh(
  bookId: string,
  audioChapters: M4BChapter[],
  epubChapterCount: number,
): Promise<BookAlignment> {
  const existing = await getAlignment(bookId);
  const audioLen = audioChapters.length;
  if (
    existing &&
    existing.chapters.length === audioLen &&
    existing.chapters.every(
      (c, i) =>
        c.audioStartSeconds === audioChapters[i].startSeconds &&
        c.audioEndSeconds === audioChapters[i].endSeconds,
    ) &&
    // If the existing alignment's epub span reflects the current chapter
    // count, no rebuild needed. Uniform-distribution L0 puts the last
    // chapter's epubPercentEnd at (N / N) = 1.0 when counts agree.
    Math.abs(
      (existing.chapters[existing.chapters.length - 1]?.epubPercentEnd ?? 0) -
        1,
    ) < 1e-6 &&
    existing.chapters.every(
      (c) => c.epubChapterIndex < epubChapterCount,
    )
  ) {
    return existing;
  }

  const built = buildLayer0({ bookId, audioChapters, epubChapterCount });
  // Keep any anchors that still map to an audio chapter index within range.
  if (existing?.l1Anchors) {
    built.l1Anchors = {};
    for (const [k, v] of Object.entries(existing.l1Anchors)) {
      const idx = Number(k);
      if (idx >= 0 && idx < built.chapters.length) built.l1Anchors[idx] = v;
    }
    const hasAnchors = Object.values(built.l1Anchors).some(
      (list) => list && list.length > 0,
    );
    if (hasAnchors && built.status === 'partial') built.status = 'processing';
  }
  await saveAlignment(built);
  return built;
}

/**
 * Replace the L1 anchor list for a single chapter and persist. Used by the
 * on-device aligner as chunks finish. Returns the updated alignment so
 * callers can react (e.g., bump status to 'processing' or 'complete').
 */
export async function setChapterAnchors(
  bookId: string,
  audioChapterIndex: number,
  anchors: SentenceAnchor[],
): Promise<BookAlignment | null> {
  const existing = await getAlignment(bookId);
  if (!existing) return null;

  const updated: BookAlignment = {
    ...existing,
    l1Anchors: { ...existing.l1Anchors, [audioChapterIndex]: anchors },
    updatedAt: Date.now(),
  };

  const totalChapters = updated.chapters.length;
  const chaptersWithAnchors = Object.values(updated.l1Anchors).filter(
    (list) => list && list.length > 0,
  ).length;
  if (chaptersWithAnchors === 0) {
    // nothing changed in practice
  } else if (chaptersWithAnchors >= totalChapters) {
    updated.status = 'complete';
  } else {
    updated.status = 'processing';
  }

  await saveAlignment(updated);
  return updated;
}
