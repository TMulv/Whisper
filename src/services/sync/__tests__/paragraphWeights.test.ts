import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  audioSecondsToParagraphCfi,
  paragraphIndexForFraction,
  paragraphPositionToAudioSeconds,
} from '../paragraphWeights';
import { ParagraphWeight } from '../../../types/sync';

// Fixture: 3 paragraphs with char counts [100, 200, 100] in a chapter that
// spans 400 s. Paragraph 0 covers 0–100 s, paragraph 1 covers 100–300 s,
// paragraph 2 covers 300–400 s (share of cum char = 25 % / 50 % / 25 %).
const weights: ParagraphWeight[] = [
  { cfi: 'cfi:p0', charCount: 100 },
  { cfi: 'cfi:p1', charCount: 200 },
  { cfi: 'cfi:p2', charCount: 100 },
];

describe('paragraphWeights — paragraphIndexForFraction', () => {
  it('lands paragraph 0 for fractions inside [0, 0.25]', () => {
    assert.equal(paragraphIndexForFraction(weights, 0), 0);
    assert.equal(paragraphIndexForFraction(weights, 0.1), 0);
    assert.equal(paragraphIndexForFraction(weights, 0.25), 0);
  });

  it('lands paragraph 1 for fractions inside (0.25, 0.75]', () => {
    assert.equal(paragraphIndexForFraction(weights, 0.26), 1);
    assert.equal(paragraphIndexForFraction(weights, 0.5), 1);
    assert.equal(paragraphIndexForFraction(weights, 0.75), 1);
  });

  it('lands paragraph 2 for fractions inside (0.75, 1]', () => {
    assert.equal(paragraphIndexForFraction(weights, 0.76), 2);
    assert.equal(paragraphIndexForFraction(weights, 1), 2);
  });

  it('clamps out-of-range input', () => {
    assert.equal(paragraphIndexForFraction(weights, -1), 0);
    assert.equal(paragraphIndexForFraction(weights, 5), 2);
  });

  it('returns 0 for empty input (caller must guard)', () => {
    assert.equal(paragraphIndexForFraction([], 0.5), 0);
  });
});

describe('paragraphWeights — audioSecondsToParagraphCfi', () => {
  it('returns paragraph 0 cfi near chapter start', () => {
    assert.equal(
      audioSecondsToParagraphCfi(weights, 0, 400, 10),
      'cfi:p0',
    );
  });

  it('returns paragraph 1 cfi mid-chapter', () => {
    assert.equal(
      audioSecondsToParagraphCfi(weights, 0, 400, 200),
      'cfi:p1',
    );
  });

  it('returns paragraph 2 cfi near chapter end', () => {
    assert.equal(
      audioSecondsToParagraphCfi(weights, 0, 400, 380),
      'cfi:p2',
    );
  });

  it('honours chapter offset (not just 0-based)', () => {
    // Same logical 50 % position but the chapter starts at t=600.
    assert.equal(
      audioSecondsToParagraphCfi(weights, 600, 1000, 800),
      'cfi:p1',
    );
  });

  it('returns null on empty weights', () => {
    assert.equal(audioSecondsToParagraphCfi([], 0, 400, 200), null);
  });
});

describe('paragraphWeights — paragraphPositionToAudioSeconds', () => {
  it('maps a known CFI to its paragraph-start timestamp', () => {
    // p1 starts at cum frac 0.25 → 0.25 * 400 = 100 s.
    assert.equal(
      paragraphPositionToAudioSeconds(weights, 0, 400, { cfi: 'cfi:p1' }),
      100,
    );
  });

  it('maps p0 CFI to chapter start', () => {
    assert.equal(
      paragraphPositionToAudioSeconds(weights, 0, 400, { cfi: 'cfi:p0' }),
      0,
    );
  });

  it('falls back to chapterFraction when cfi is unknown', () => {
    // chapterFraction=0.5 hits p1; p1 starts at cum=0.25 → t=100.
    assert.equal(
      paragraphPositionToAudioSeconds(weights, 0, 400, {
        cfi: 'cfi:nonexistent',
        chapterFraction: 0.5,
      }),
      100,
    );
  });

  it('round-trips audio→cfi→audio within the same paragraph window', () => {
    const t = 150; // inside p1 [100, 300)
    const cfi = audioSecondsToParagraphCfi(weights, 0, 400, t);
    assert.equal(cfi, 'cfi:p1');
    const back = paragraphPositionToAudioSeconds(weights, 0, 400, {
      cfi: cfi ?? undefined,
    });
    // Round-trip lands us at the paragraph start (100), which is inside the
    // same paragraph window as `t=150` — same-page, which is the guarantee.
    assert.equal(back, 100);
    assert.ok(back !== null && back <= t && t < 300);
  });
});
