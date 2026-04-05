import { M4BChapter } from '@/types/sync';

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
