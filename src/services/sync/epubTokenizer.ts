// Tokenize a cached chapter's plain text into EpubToken[] for DTW alignment.
//
// We don't have real epub CFIs at this layer — those live in the WebView's
// epub.js instance, which we don't want to round-trip through for every
// aligner run. Instead we emit "pseudo" CFIs of the form `pseudo:ch{N}/s{M}`
// that match the scheme the cloud worker uses, so downstream resolver code
// can treat them uniformly. When a pseudo-CFI surfaces in the UI (e.g.
// sentence anchor lookup), the reader-side ingest is responsible for
// mapping it to a real CFI — out of scope here.
//
// Sentence boundaries: `.` `!` or `?` followed by whitespace. Not perfect
// (think "Mr.") but robust enough for DTW, which only needs sentence ids to
// group tokens — the anchors are emitted at the first token of a sentence.
//
// Pacing for `percentComplete`: linear within the chapter's book-wide span.
// The aligner uses this for book-level progress estimation only; within a
// chapter the DTW path itself dictates where each anchor lands.

import { EpubToken } from './dtw';

export interface ChapterSpan {
  /** 0-based epub chapter index (stable across devices — spine order). */
  epubChapterIndex: number;
  /** Chapter's book-wide percent span. Same as ChapterAlignment fields. */
  epubPercentStart: number;
  epubPercentEnd: number;
}

// Tokens with at least one letter or digit — drops punctuation-only tokens
// that whisper won't emit anyway and would otherwise poison DTW cost.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'']*/gu;
const SENTENCE_TERMINATORS = new Set(['.', '!', '?']);

export function tokenizeChapter(text: string, span: ChapterSpan): EpubToken[] {
  if (!text || text.length === 0) return [];
  const tokens: EpubToken[] = [];
  const chapterPercentSpan = span.epubPercentEnd - span.epubPercentStart;
  const totalChars = text.length;

  let sentenceId = 0;
  let lastMatchEnd = 0;
  // Emit every word, with the running sentenceId. A sentence terminator in
  // the gap between two word matches flips the id for the next word.
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;

    // Did we cross a sentence terminator in the gap?
    const gap = text.slice(lastMatchEnd, start);
    if (hasSentenceBoundary(gap)) {
      sentenceId += 1;
    }

    const charOffset = start;
    const percentComplete =
      span.epubPercentStart +
      (totalChars > 0 ? (charOffset / totalChars) * chapterPercentSpan : 0);

    tokens.push({
      text: match[0],
      charOffset,
      cfi: `pseudo:ch${span.epubChapterIndex}/s${sentenceId}`,
      percentComplete,
      sentenceId,
    });

    lastMatchEnd = start + match[0].length;
  }
  return tokens;
}

function hasSentenceBoundary(gap: string): boolean {
  if (!gap) return false;
  // A sentence ends when we see `.!?` followed by whitespace (or end of
  // gap). Walk backwards so we don't misfire on ellipses inside a word run.
  let sawTerminator = false;
  for (const ch of gap) {
    if (SENTENCE_TERMINATORS.has(ch)) {
      sawTerminator = true;
    } else if (/\s/.test(ch)) {
      if (sawTerminator) return true;
    } else if (sawTerminator) {
      // non-space after terminator with no whitespace between (e.g. "A.B") —
      // treat as mid-token abbreviation, not a sentence break.
      sawTerminator = false;
    }
  }
  return false;
}
