// ── Audiobook/ebook alignment (handoff sync) ────────────────────────────────
// See docs/superpowers/specs/2026-04-20-audiobook-ebook-sync-design.md.

/**
 * Per-chapter mapping between the audio (m4b) and ebook (epub) domains.
 * Produced at Layer 0 from m4b chapter timestamps + epub spine/percent distribution.
 */
export interface ChapterAlignment {
  // Audio domain
  audioChapterIndex: number;
  audioStartSeconds: number;
  audioEndSeconds: number;

  // Epub domain
  epubChapterIndex: number;
  epubCfiBase: string;

  // Chapter's span over the book's [0..1] epub percent axis. Used by the
  // resolver for proportional-within-chapter fallback when no L1 anchors are
  // available.
  epubPercentStart: number;
  epubPercentEnd: number;
}

/**
 * A Layer 1 sentence-level anchor produced by Whisper + DTW.
 * Empty for Phase 1; resolver is structurally ready to consume them.
 */
export interface SentenceAnchor {
  audioSeconds: number;
  epubCfi: string;
  charOffset: number;
  percentComplete: number; // book-wide epub percent, for L0-style interpolation between anchors
  confidence: number; // 0..1
}

/**
 * Layer 0.5 — paragraph-level weight for a chapter. Produced by the epub
 * WebView on first render of each chapter (DOM walk, no ASR). The resolver
 * uses these to interpolate inside a chapter when L1 anchors aren't
 * available yet, giving paragraph-accurate handoff without needing Whisper.
 */
export interface ParagraphWeight {
  /** Epub CFI of the paragraph's first text node. */
  cfi: string;
  /** Characters in this paragraph (whitespace-collapsed). */
  charCount: number;
}

export type AlignmentStatus =
  | 'pending' // no L0 built yet
  | 'partial' // L0 ready, L1 not started/in-progress
  | 'processing' // L1 actively being produced
  | 'complete' // L1 complete for every chapter
  | 'failed';

/**
 * Full alignment record persisted per book.
 * Layer 0 (chapters) is always populated once built. Layer 1 (l1Anchors) is a
 * map keyed by audioChapterIndex — absent entries mean that chapter is still L0-only.
 */
export interface BookAlignment {
  bookId: string;
  version: number; // bump if we change the shape incompatibly
  chapters: ChapterAlignment[];
  l1Anchors: Record<number, SentenceAnchor[]>;
  /**
   * Layer 0.5 paragraph weights, keyed by audioChapterIndex. Absent entries
   * mean we haven't visited that chapter in the reader yet (or it only has
   * L1 anchors, which take precedence).
   */
  paragraphWeights?: Record<number, ParagraphWeight[]>;
  status: AlignmentStatus;
  updatedAt: number;
}

export interface M4BChapter {
  index: number;
  title: string;
  startSeconds: number;
  endSeconds: number;
}

