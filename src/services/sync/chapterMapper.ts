import { EpubPosition, AudioPosition } from '@/types/position';
import { BookSyncMap, ChapterMapping } from '@/types/sync';
import { buildChapterBaseCfi } from '@/utils/cfiUtils';

function findChapterByIndex(chapters: ChapterMapping[], index: number): ChapterMapping | undefined {
  return chapters.find((c) => c.chapterIndex === index);
}

function findChapterByPercent(chapters: ChapterMapping[], percent: number): ChapterMapping {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (chapters[i].percentStart <= percent) return chapters[i];
  }
  return chapters[0];
}

// ── Chapter mode ─────────────────────────────────────────────────────────────

export function epubPositionToAudio(
  pos: EpubPosition,
  syncMap: BookSyncMap,
): AudioPosition {
  if (syncMap.mode === 'chapter') {
    const chapter = findChapterByIndex(syncMap.chapters, pos.chapterIndex);
    if (chapter) {
      return {
        chapterIndex: chapter.chapterIndex,
        timestampSeconds: chapter.audioStartSeconds,
        percentComplete: chapter.percentStart,
      };
    }
  }
  // Percentage fallback
  const chapter = findChapterByPercent(syncMap.chapters, pos.percentComplete);
  const chapterProgress =
    (pos.percentComplete - chapter.percentStart) /
    Math.max(chapter.percentEnd - chapter.percentStart, 0.001);
  const timestampSeconds =
    chapter.audioStartSeconds +
    chapterProgress * (chapter.audioEndSeconds - chapter.audioStartSeconds);
  return {
    chapterIndex: chapter.chapterIndex,
    timestampSeconds,
    percentComplete: pos.percentComplete,
  };
}

export function audioPositionToEpub(
  pos: AudioPosition,
  syncMap: BookSyncMap,
): EpubPosition {
  if (syncMap.mode === 'chapter') {
    const chapter = findChapterByIndex(syncMap.chapters, pos.chapterIndex);
    if (chapter) {
      return {
        chapterIndex: chapter.chapterIndex,
        cfi: chapter.epubCfiBase || buildChapterBaseCfi(chapter.epubSpineIndex),
        charOffset: 0,
        percentComplete: chapter.percentStart,
      };
    }
  }
  // Percentage fallback
  const chapter = findChapterByPercent(syncMap.chapters, pos.percentComplete);
  return {
    chapterIndex: chapter.chapterIndex,
    cfi: chapter.epubCfiBase || buildChapterBaseCfi(chapter.epubSpineIndex),
    charOffset: 0,
    percentComplete: pos.percentComplete,
  };
}
