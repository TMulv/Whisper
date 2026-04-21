// Layer 0.5 — paragraph-level interpolation inside a chapter.
//
// Given a list of paragraphs (CFI + char count) and the chapter's audio
// start/end seconds, we can map:
//   paragraph CFI → audio seconds  (reader → audio)
//   audio seconds → paragraph CFI  (audio → reader)
//
// This sits between L0 (proportional-within-chapter) and L1 (Whisper sentence
// anchors). No ASR, no network — just a DOM walk on the reader side to
// collect char counts. Good enough to land within a paragraph on handoff,
// which is the difference between "same chapter" and "same page."

import { ParagraphWeight } from '@/types/sync';

/**
 * Cumulative char-count thresholds for each paragraph, as a fraction of the
 * chapter's total char count. Length = weights.length; element i is the
 * fraction AT THE END of paragraph i (so paragraph 0's range is
 * `[0, cum[0]]`, paragraph 1's range is `[cum[0], cum[1]]`, and so on).
 */
function cumulativeFractions(weights: ParagraphWeight[]): number[] {
  let total = 0;
  for (const w of weights) total += Math.max(0, w.charCount);
  if (total <= 0) {
    // Degenerate: paragraphs without text (images, etc). Fall back to even
    // spacing so we at least land somewhere reasonable.
    return weights.map((_, i) => (i + 1) / weights.length);
  }
  const out: number[] = new Array(weights.length);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i].charCount);
    out[i] = acc / total;
  }
  return out;
}

/**
 * Find the paragraph index whose cumulative-char window contains `fraction`
 * (where 0 ≤ fraction ≤ 1 is the progress through the chapter).
 *
 * Binary search. Returns 0 for empty input (callers should guard).
 */
export function paragraphIndexForFraction(
  weights: ParagraphWeight[],
  fraction: number,
): number {
  if (weights.length === 0) return 0;
  const cum = cumulativeFractions(weights);
  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] >= clamped) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Map an audio timestamp inside a chapter to the paragraph whose char window
 * covers it. Returns the paragraph's CFI.
 *
 * Returns null if weights are empty — callers fall back to L0 proportional.
 */
export function audioSecondsToParagraphCfi(
  weights: ParagraphWeight[],
  chapterStartSeconds: number,
  chapterEndSeconds: number,
  audioSeconds: number,
): string | null {
  if (weights.length === 0) return null;
  const span = chapterEndSeconds - chapterStartSeconds;
  if (span <= 0) return weights[0].cfi;
  const frac = (audioSeconds - chapterStartSeconds) / span;
  const idx = paragraphIndexForFraction(weights, frac);
  return weights[idx]?.cfi ?? null;
}

/**
 * Given an epub position expressed as a fraction of the chapter (0..1) or a
 * known paragraph CFI, return the audio second that lines up with the
 * *start* of that paragraph within the chapter.
 *
 * If `cfi` matches a weight exactly we use its cumulative fraction directly,
 * which is more accurate than re-deriving from a book-wide percent.
 */
export function paragraphPositionToAudioSeconds(
  weights: ParagraphWeight[],
  chapterStartSeconds: number,
  chapterEndSeconds: number,
  opts: { cfi?: string; chapterFraction?: number },
): number | null {
  if (weights.length === 0) return null;
  const span = chapterEndSeconds - chapterStartSeconds;
  if (span <= 0) return chapterStartSeconds;

  const cum = cumulativeFractions(weights);

  let fractionAtParagraphStart: number;
  if (opts.cfi) {
    const idx = weights.findIndex((w) => w.cfi === opts.cfi);
    if (idx >= 0) {
      fractionAtParagraphStart = idx === 0 ? 0 : cum[idx - 1];
      return chapterStartSeconds + fractionAtParagraphStart * span;
    }
    // CFI not in the list — fall through to chapterFraction lookup.
  }

  const frac =
    opts.chapterFraction !== undefined
      ? Math.max(0, Math.min(1, opts.chapterFraction))
      : 0;
  const idx = paragraphIndexForFraction(weights, frac);
  fractionAtParagraphStart = idx === 0 ? 0 : cum[idx - 1];
  return chapterStartSeconds + fractionAtParagraphStart * span;
}
