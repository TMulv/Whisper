import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { alignTokens, extractAnchors, normalizeToken, EpubToken } from '../dtw';
import { WhisperToken } from '../whisperAdapter';

function wt(text: string, start: number, end: number): WhisperToken {
  return { text, startSeconds: start, endSeconds: end };
}

function et(
  text: string,
  charOffset: number,
  cfi: string,
  sentenceId: number,
  percentComplete: number,
): EpubToken {
  return { text, charOffset, cfi, sentenceId, percentComplete };
}

describe('dtw — normalizeToken', () => {
  it('lowercases and strips punctuation', () => {
    assert.equal(normalizeToken('Hello,'), 'hello');
    assert.equal(normalizeToken("don't"), "don't");
    assert.equal(normalizeToken('!!!'), '');
  });
});

describe('dtw — perfect match', () => {
  // Two sentences, each 3 words. Audio time flows linearly.
  const audio: WhisperToken[] = [
    wt('The', 0, 0.3),
    wt('quick', 0.3, 0.6),
    wt('fox.', 0.6, 1.0),
    wt('It', 1.0, 1.2),
    wt('jumps', 1.2, 1.6),
    wt('high.', 1.6, 2.0),
  ];
  const epub: EpubToken[] = [
    et('The', 0, 'cfi(s1)', 0, 0.0),
    et('quick', 4, 'cfi(s1)', 0, 0.05),
    et('fox', 10, 'cfi(s1)', 0, 0.1),
    et('It', 14, 'cfi(s2)', 1, 0.5),
    et('jumps', 17, 'cfi(s2)', 1, 0.55),
    et('high', 23, 'cfi(s2)', 1, 0.6),
  ];

  it('produces one pair per token', () => {
    const r = alignTokens(audio, epub);
    assert.equal(r.pairs.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(r.pairs[i].audio, i);
      assert.equal(r.pairs[i].epub, i);
    }
    assert.equal(r.cost, 0);
  });

  it('extracts two sentence anchors at sentence starts', () => {
    const r = alignTokens(audio, epub);
    const anchors = extractAnchors(audio, epub, r);
    assert.equal(anchors.length, 2);
    assert.equal(anchors[0].audioSeconds, 0);
    assert.equal(anchors[0].epubCfi, 'cfi(s1)');
    assert.ok(Math.abs(anchors[1].audioSeconds - 1.0) < 1e-6);
    assert.equal(anchors[1].epubCfi, 'cfi(s2)');
    assert.ok(anchors[0].confidence >= 0.99);
    assert.ok(anchors[1].confidence >= 0.99);
  });
});

describe('dtw — partial mismatch drops low-confidence anchors', () => {
  const audio: WhisperToken[] = [
    wt('aaa', 0, 0.2),
    wt('bbb', 0.2, 0.4),
    wt('ccc', 0.4, 0.6),
    wt('ddd', 0.6, 0.8),
  ];
  // Sentence id 0 matches perfectly; sentence id 1 is all different.
  const epub: EpubToken[] = [
    et('aaa', 0, 'cfi(ok)', 0, 0.0),
    et('bbb', 3, 'cfi(ok)', 0, 0.05),
    et('zzz', 6, 'cfi(bad)', 1, 0.5),
    et('yyy', 9, 'cfi(bad)', 1, 0.6),
  ];

  it('keeps only the high-confidence sentence', () => {
    const r = alignTokens(audio, epub);
    const anchors = extractAnchors(audio, epub, r, { minConfidence: 0.6 });
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].epubCfi, 'cfi(ok)');
  });
});

describe('dtw — monotonicity', () => {
  it('produced pairs are monotone non-decreasing on both axes', () => {
    const audio: WhisperToken[] = [
      wt('one', 0, 0.2),
      wt('two', 0.2, 0.4),
      wt('three', 0.4, 0.6),
      wt('four', 0.6, 0.8),
      wt('five', 0.8, 1.0),
    ];
    const epub: EpubToken[] = [
      et('one', 0, 'c', 0, 0),
      et('two', 1, 'c', 0, 0.1),
      et('three', 2, 'c', 0, 0.2),
      et('four', 3, 'c', 0, 0.3),
      et('five', 4, 'c', 0, 0.4),
    ];
    const r = alignTokens(audio, epub);
    for (let i = 1; i < r.pairs.length; i++) {
      assert.ok(r.pairs[i].audio >= r.pairs[i - 1].audio);
      assert.ok(r.pairs[i].epub >= r.pairs[i - 1].epub);
    }
  });
});

describe('dtw — empty inputs', () => {
  it('returns no pairs for empty audio', () => {
    const r = alignTokens([], [et('x', 0, 'c', 0, 0)]);
    assert.equal(r.pairs.length, 0);
  });
  it('returns no pairs for empty epub', () => {
    const r = alignTokens([wt('x', 0, 1)], []);
    assert.equal(r.pairs.length, 0);
  });
});
