import { BookAlignment, ChapterAlignment, M4BChapter } from '@/types/sync';
import { buildChapterBaseCfi } from '@/utils/cfiUtils';

// Build a Layer 0 alignment from m4b chapter timestamps + epub chapter count.
// L0 is chapter-accurate: audio boundaries come from ffprobe; epub boundaries
// are assumed uniformly distributed across the book's percent axis. L1
// (Whisper sentence anchors) later refines sub-chapter accuracy.
//
// When the audio and epub have the same number of chapters (the common case
// for properly-paired audiobooks), each audio chapter maps 1:1 to its epub
// counterpart. Otherwise we proportionally map audio chapter i → epub chapter
// round(i * (N-1) / (M-1)).

export interface BuildLayer0Input {
  bookId: string;
  audioChapters: M4BChapter[];
  epubChapterCount: number;
  // Optional: precise CFI bases indexed by epub chapter. If absent, we fall
  // back to a synthetic base from buildChapterBaseCfi, which is sufficient for
  // chapter-level navigation via the epub.js bridge.
  epubChapterCfis?: string[];
}

export function buildLayer0(input: BuildLayer0Input): BookAlignment {
  const { bookId, audioChapters, epubChapterCount, epubChapterCfis } = input;

  const chapters: ChapterAlignment[] = [];
  const M = audioChapters.length;
  const N = Math.max(1, epubChapterCount);

  for (let i = 0; i < M; i++) {
    const audio = audioChapters[i];
    const epubIdx =
      N === M
        ? i
        : Math.round((i / Math.max(M - 1, 1)) * (N - 1));
    const clampedEpubIdx = Math.max(0, Math.min(epubIdx, N - 1));

    // Epub percent span: divide the book proportionally among audio chapters
    // so there are no gaps and no overlaps regardless of M:N ratio.
    // epubChapterIndex is kept for navigation (which chapter to display), but
    // percent bounds drive L0 position math and must cover the full [0,1] range.
    // e.g. M=1 → [0, 1], M=3 → [0,.33], [.33,.67], [.67,1]
    chapters.push({
      audioChapterIndex: i,
      audioStartSeconds: audio.startSeconds,
      audioEndSeconds: audio.endSeconds,
      epubChapterIndex: clampedEpubIdx,
      epubCfiBase:
        epubChapterCfis?.[clampedEpubIdx] ?? buildChapterBaseCfi(clampedEpubIdx),
      epubPercentStart: i / M,
      epubPercentEnd: (i + 1) / M,
    });
  }

  return {
    bookId,
    version: 1,
    chapters,
    l1Anchors: {},
    status: M > 0 ? 'partial' : 'pending',
    updatedAt: Date.now(),
  };
}
