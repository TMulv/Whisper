import { AssemblyWord } from '@/services/sync/assemblyAiAdapter';
import { tokenizeSnippet } from '@/services/sync/handoff';

export interface AudioSearchResult {
  startSeconds: number;
  endSeconds: number;
  contextBefore: string;
  matchText: string;
  contextAfter: string;
  score: number; // 0..1
}

export interface AudioSearchIndex {
  words: AssemblyWord[];
  normalized: string[]; // parallel array, lowercase + stripped
}

const CONTEXT_WORDS = 4;
const MAX_QUERY_TOKENS = 8;
const MIN_SCORE_RATIO = 0.75; // ≥75% of query tokens must match

export function buildSearchIndex(words: AssemblyWord[]): AudioSearchIndex {
  return {
    words,
    normalized: words.map((w) => {
      const token = tokenizeSnippet(w.text);
      return token.length > 0 ? token[0] : '';
    }),
  };
}

export function searchAudio(
  index: AudioSearchIndex,
  query: string,
  maxResults = 20,
): AudioSearchResult[] {
  const tokens = tokenizeSnippet(query);
  if (tokens.length === 0) return [];

  const target = tokens.slice(0, MAX_QUERY_TOKENS);
  const tLen = target.length;
  const minScore = Math.ceil(tLen * MIN_SCORE_RATIO);
  const { words, normalized } = index;
  const results: AudioSearchResult[] = [];

  for (let i = 0; i + tLen <= normalized.length; i++) {
    let score = 0;
    for (let j = 0; j < tLen; j++) {
      if (normalized[i + j] === target[j]) score++;
    }
    if (score < minScore) continue;

    const beforeStart = Math.max(0, i - CONTEXT_WORDS);
    const afterEnd = Math.min(words.length, i + tLen + CONTEXT_WORDS);

    results.push({
      startSeconds: words[i].start / 1000,
      endSeconds: words[i + tLen - 1].end / 1000,
      contextBefore: words
        .slice(beforeStart, i)
        .map((w) => w.text)
        .join(' '),
      matchText: words
        .slice(i, i + tLen)
        .map((w) => w.text)
        .join(' '),
      contextAfter: words
        .slice(i + tLen, afterEnd)
        .map((w) => w.text)
        .join(' '),
      score: score / tLen,
    });

    if (results.length >= maxResults) break;
  }

  return results.sort(
    (a, b) => b.score - a.score || a.startSeconds - b.startSeconds,
  );
}
