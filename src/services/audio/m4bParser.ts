import { M4BChapter } from '@/types/sync';
import type { AudnexusChapter } from './chapterLookupService';

interface RawChapter {
  id: number;
  time_base: string;
  start: number;
  start_time: string;
  end: number;
  end_time: string;
  tags?: {
    title?: string;
  };
}

interface FfprobeChaptersOutput {
  chapters: RawChapter[];
}

/**
 * Parse a chapters.json file produced by:
 *   ffprobe -v quiet -print_format json -show_chapters book.m4b
 */
export function parseChaptersJson(json: string): M4BChapter[] {
  const data = JSON.parse(json) as FfprobeChaptersOutput;

  if (!data.chapters || data.chapters.length === 0) {
    return [];
  }

  return data.chapters.map((ch, index) => ({
    index,
    title: ch.tags?.title ?? `Chapter ${index + 1}`,
    startSeconds: parseFloat(ch.start_time),
    endSeconds: parseFloat(ch.end_time),
  }));
}

/**
 * Create a single fallback chapter for audio files without chapter metadata.
 */
export function createFallbackChapter(totalDurationSeconds: number): M4BChapter[] {
  return [
    {
      index: 0,
      title: 'Track',
      startSeconds: 0,
      endSeconds: totalDurationSeconds,
    },
  ];
}

/**
 * Evenly distribute a list of chapter titles across the total audio duration.
 */
export function distributeChapters(titles: string[], totalDurationSeconds: number): M4BChapter[] {
  const chapterDuration = totalDurationSeconds / titles.length;
  return titles.map((title, index) => ({
    index,
    title,
    startSeconds: index * chapterDuration,
    endSeconds: (index + 1) * chapterDuration,
  }));
}

/**
 * Convert Audnexus chapter data (with real timestamps) to M4BChapter[].
 */
export function chaptersFromAudnexus(audnexusChapters: AudnexusChapter[]): M4BChapter[] {
  return audnexusChapters.map((ch, index) => ({
    index,
    title: ch.title,
    startSeconds: ch.startSec,
    endSeconds: ch.endSec,
  }));
}

/**
 * Serialize M4BChapter[] to the ffprobe JSON format understood by parseChaptersJson.
 */
export function serializeChapters(chapters: M4BChapter[]): string {
  return JSON.stringify({
    chapters: chapters.map((ch) => ({
      id: ch.index,
      time_base: '1/1000',
      start: Math.round(ch.startSeconds * 1000),
      start_time: ch.startSeconds.toFixed(6),
      end: Math.round(ch.endSeconds * 1000),
      end_time: ch.endSeconds.toFixed(6),
      tags: { title: ch.title },
    })),
  });
}
