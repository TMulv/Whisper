// Dynamic time warping for text-to-text alignment.
//
// Inputs: whisper transcript tokens (audio times) and epub tokens (char
// offsets + CFIs, grouped by sentence). Output: a monotone alignment path,
// and helpers to turn that path into sentence-level anchors for the resolver.
//
// Cost model is straightforward — 0 when the two normalized strings match,
// 1 otherwise — which is robust for word-level alignment and sidesteps the
// tuning burden of edit-distance weights. A Sakoe-Chiba band keeps memory
// and time manageable for chapter-length inputs.

import { WhisperToken } from './whisperAdapter';
import { SentenceAnchor } from '../../types/sync';

export interface EpubToken {
  text: string;
  /** Char offset into the chapter text (used for anchor.charOffset). */
  charOffset: number;
  /** CFI this token lives in — typically sentence-granularity. */
  cfi: string;
  /** Book-wide epub percent for this token's position. */
  percentComplete: number;
  /** Tokens sharing an id belong to the same sentence. First token wins per anchor. */
  sentenceId: number;
}

export interface AlignmentPair {
  audio: number;
  epub: number;
}

export interface DtwResult {
  pairs: AlignmentPair[];
  cost: number;
  /** Average per-pair cost — roughly 1 - match-rate. */
  averageCost: number;
}

const PUNCT_RE = /[^\p{L}\p{N}'']/gu;

export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(PUNCT_RE, '').trim();
}

function tokenCost(a: string, b: string): number {
  return a === b ? 0 : 1;
}

/**
 * Banded DTW alignment. `bandFraction` constrains how far the path can
 * diverge from the diagonal — 0.15 means a token can be matched up to 15%
 * of max(N, M) positions away from its proportional counterpart.
 */
export function alignTokens(
  audio: WhisperToken[],
  epub: EpubToken[],
  opts: { bandFraction?: number } = {},
): DtwResult {
  const n = audio.length;
  const m = epub.length;

  if (n === 0 || m === 0) {
    return { pairs: [], cost: 0, averageCost: 0 };
  }

  const band = Math.max(
    32,
    Math.ceil((opts.bandFraction ?? 0.15) * Math.max(n, m)),
  );

  const audioNorm = audio.map((t) => normalizeToken(t.text));
  const epubNorm = epub.map((t) => normalizeToken(t.text));

  const INF = Number.POSITIVE_INFINITY;
  const cols = m + 1;
  const cost = new Float64Array((n + 1) * cols);
  const back = new Uint8Array((n + 1) * cols); // 0 diag, 1 up (skip epub), 2 left (skip audio)
  cost.fill(INF);
  cost[0] = 0;

  for (let i = 1; i <= n; i++) {
    const jMin = Math.max(1, i - band);
    const jMax = Math.min(m, i + band);
    for (let j = jMin; j <= jMax; j++) {
      const c = tokenCost(audioNorm[i - 1], epubNorm[j - 1]);
      const diag = cost[(i - 1) * cols + (j - 1)] + c;
      const up = cost[(i - 1) * cols + j] + 1; // audio advances, epub waits
      const left = cost[i * cols + (j - 1)] + 1; // epub advances, audio waits
      let best = diag;
      let choice: 0 | 1 | 2 = 0;
      if (up < best) {
        best = up;
        choice = 1;
      }
      if (left < best) {
        best = left;
        choice = 2;
      }
      cost[i * cols + j] = best;
      back[i * cols + j] = choice;
    }
  }

  const totalCost = cost[n * cols + m];
  if (!Number.isFinite(totalCost)) {
    // Band was too tight to reach the corner — fall back to a wider run.
    if ((opts.bandFraction ?? 0.15) < 0.5) {
      return alignTokens(audio, epub, { bandFraction: 0.5 });
    }
    return { pairs: [], cost: Infinity, averageCost: 1 };
  }

  const pairs: AlignmentPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const step = back[i * cols + j];
    if (step === 0) {
      pairs.push({ audio: i - 1, epub: j - 1 });
      i -= 1;
      j -= 1;
    } else if (step === 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();

  const averageCost =
    pairs.length > 0 ? totalCost / Math.max(n, m) : 1;
  return { pairs, cost: totalCost, averageCost };
}

/**
 * Extract sentence-level anchors from a DTW alignment. For each sentence in
 * the epub tokens, emit one anchor keyed to the first whisper token that
 * aligned inside that sentence. Confidence reflects the fraction of the
 * sentence's epub tokens that matched their aligned audio token.
 */
export function extractAnchors(
  audio: WhisperToken[],
  epub: EpubToken[],
  alignment: DtwResult,
  opts: { minConfidence?: number } = {},
): SentenceAnchor[] {
  const minConfidence = opts.minConfidence ?? 0.35;
  if (alignment.pairs.length === 0) return [];

  interface Acc {
    firstAudioIdx: number;
    firstEpub: EpubToken;
    matched: number;
    total: number;
  }

  const bySentence = new Map<number, Acc>();
  const audioNorm = audio.map((t) => normalizeToken(t.text));
  const epubNorm = epub.map((t) => normalizeToken(t.text));

  for (const pair of alignment.pairs) {
    const ep = epub[pair.epub];
    const existing = bySentence.get(ep.sentenceId);
    const matched = audioNorm[pair.audio] === epubNorm[pair.epub] ? 1 : 0;
    if (!existing) {
      bySentence.set(ep.sentenceId, {
        firstAudioIdx: pair.audio,
        firstEpub: ep,
        matched,
        total: 1,
      });
    } else {
      existing.matched += matched;
      existing.total += 1;
      if (pair.audio < existing.firstAudioIdx) {
        existing.firstAudioIdx = pair.audio;
        existing.firstEpub = ep;
      }
    }
  }

  const anchors: SentenceAnchor[] = [];
  for (const acc of bySentence.values()) {
    const confidence = acc.total > 0 ? acc.matched / acc.total : 0;
    if (confidence < minConfidence) continue;
    const audioToken = audio[acc.firstAudioIdx];
    anchors.push({
      audioSeconds: audioToken.startSeconds,
      epubCfi: acc.firstEpub.cfi,
      charOffset: acc.firstEpub.charOffset,
      percentComplete: acc.firstEpub.percentComplete,
      confidence,
    });
  }

  anchors.sort((a, b) => a.audioSeconds - b.audioSeconds);
  return anchors;
}
