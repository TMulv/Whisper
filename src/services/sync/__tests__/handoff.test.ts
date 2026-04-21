import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readerToAudio, audioToReader } from '../handoff';
import { buildLayer0 } from '../alignmentBuilder';
import { BookAlignment, M4BChapter } from '../../../types/sync';

// Fixture: 3-chapter book, 30 min audio. 10 min per chapter.
// Epub percent is uniform: 0–0.333, 0.333–0.666, 0.666–1.0.
const audioChapters: M4BChapter[] = [
  { index: 0, title: 'Ch 1', startSeconds: 0, endSeconds: 600 },
  { index: 1, title: 'Ch 2', startSeconds: 600, endSeconds: 1200 },
  { index: 2, title: 'Ch 3', startSeconds: 1200, endSeconds: 1800 },
];

const baseAlignment = buildLayer0({
  bookId: 'test',
  audioChapters,
  epubChapterCount: 3,
});

describe('handoff — L0 readerToAudio', () => {
  it('maps chapter start exactly to audio chapter start', () => {
    const r = readerToAudio(
      { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 0);
    assert.equal(r.timestampSeconds, 0);
  });

  it('maps 50% into chapter 2 to 15 min into audio', () => {
    // Chapter 2 spans epub percent 0.333..0.666. Halfway in is 0.5 overall.
    const r = readerToAudio(
      { chapterIndex: 1, cfi: '', charOffset: 0, percentComplete: 0.5 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 1);
    // Audio ch 2 is [600, 1200]. Half way in is 900.
    assert.ok(Math.abs(r.timestampSeconds - 900) < 1);
  });

  it('chapter end lands at chapter end (not overshoot)', () => {
    const r = readerToAudio(
      { chapterIndex: 2, cfi: '', charOffset: 0, percentComplete: 1.0 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 2);
    assert.ok(r.timestampSeconds <= 1800);
    assert.ok(r.timestampSeconds >= 1200);
  });

  it('returns zero position when alignment is null', () => {
    const r = readerToAudio(
      { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0.5 },
      null,
    );
    assert.equal(r.timestampSeconds, 0);
  });
});

describe('handoff — L0 audioToReader', () => {
  it('maps 0s to chapter 0 start', () => {
    const r = audioToReader(
      { chapterIndex: 0, timestampSeconds: 0, percentComplete: 0 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 0);
    assert.ok(Math.abs(r.percentComplete - 0) < 1e-6);
  });

  it('maps 15 min to chapter 1 half-way', () => {
    const r = audioToReader(
      { chapterIndex: 1, timestampSeconds: 900, percentComplete: 0 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 1);
    assert.ok(Math.abs(r.percentComplete - 0.5) < 0.01);
  });

  it('maps 29 min (near end of ch 3) into chapter 2', () => {
    const r = audioToReader(
      { chapterIndex: 2, timestampSeconds: 1740, percentComplete: 0 },
      baseAlignment,
    );
    assert.equal(r.chapterIndex, 2);
    assert.ok(r.percentComplete > 0.9 && r.percentComplete <= 1.0);
  });

  it('L0 fallback returns empty cfi so callers navigate by chapterIndex', () => {
    // epub.js' rendition.display crashes on a chapter-base-only CFI like
    // `epubcfi(/6/4)` (no `!` separator). The L0 resolver has no real CFI
    // to offer, so it must return '' — callers (e.g. ReaderScreen) use
    // chapterIndex to navigate in that case.
    const r = audioToReader(
      { chapterIndex: 1, timestampSeconds: 900, percentComplete: 0 },
      baseAlignment,
    );
    assert.equal(r.cfi, '');
    assert.equal(r.chapterIndex, 1);
  });

  it('roundtrip: audio → reader → audio lands within 1s', () => {
    const original = 750; // mid-chapter-2
    const epub = audioToReader(
      { chapterIndex: 1, timestampSeconds: original, percentComplete: 0 },
      baseAlignment,
    );
    const back = readerToAudio(epub, baseAlignment);
    assert.ok(Math.abs(back.timestampSeconds - original) < 1);
  });
});

describe('handoff — unequal M and N (audio vs epub chapter counts)', () => {
  // 3 audio chapters, 6 epub chapters → audio ch 0 maps to epub 0, ch 1 → 3, ch 2 → 6 clamped to 5.
  const mismatchAlignment = buildLayer0({
    bookId: 'mismatch',
    audioChapters,
    epubChapterCount: 6,
  });

  it('audio ch 1 start maps to its bound epub chapter', () => {
    const r = audioToReader(
      { chapterIndex: 1, timestampSeconds: 600, percentComplete: 0 },
      mismatchAlignment,
    );
    // With M=3,N=6: audio i=1 → round((1/2)*5) = round(2.5) = 3 (bankers) or 3 depending on impl.
    // Accept 2 or 3 — both indicate proportional mapping is in use, not 1:1.
    assert.ok(r.chapterIndex === 2 || r.chapterIndex === 3);
  });

  it('chapters array length equals audio chapter count', () => {
    assert.equal(mismatchAlignment.chapters.length, 3);
  });
});

describe('handoff — L1 anchors win over L0 proportional', () => {
  const withAnchors: BookAlignment = {
    ...baseAlignment,
    l1Anchors: {
      1: [
        // Three anchors inside chapter 2 [600, 1200]
        { audioSeconds: 650, epubCfi: 'epubcfi(/6/4!/a)', charOffset: 0, percentComplete: 0.40, confidence: 0.9 },
        { audioSeconds: 900, epubCfi: 'epubcfi(/6/4!/b)', charOffset: 0, percentComplete: 0.50, confidence: 0.9 },
        { audioSeconds: 1150, epubCfi: 'epubcfi(/6/4!/c)', charOffset: 0, percentComplete: 0.64, confidence: 0.9 },
      ],
    },
  };

  it('audioToReader uses nearest anchor CFI inside aligned chapter', () => {
    const r = audioToReader(
      { chapterIndex: 1, timestampSeconds: 910, percentComplete: 0 },
      withAnchors,
    );
    assert.equal(r.cfi, 'epubcfi(/6/4!/b)');
  });

  it('readerToAudio interpolates between two anchors', () => {
    const r = readerToAudio(
      { chapterIndex: 1, cfi: '', charOffset: 0, percentComplete: 0.45 },
      withAnchors,
    );
    // Between first (0.40 / 650s) and second (0.50 / 900s). Linear: 0.45 → 775s.
    assert.ok(Math.abs(r.timestampSeconds - 775) < 1);
  });

  it('falls back to L0 for chapters without anchors', () => {
    const r = readerToAudio(
      { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0.1667 },
      withAnchors,
    );
    // ~half way through ch 1: audio ~300s
    assert.ok(Math.abs(r.timestampSeconds - 300) < 10);
  });
});

describe('handoff — edge: single-chapter book', () => {
  const single = buildLayer0({
    bookId: 'single',
    audioChapters: [{ index: 0, title: 'Full', startSeconds: 0, endSeconds: 3600 }],
    epubChapterCount: 1,
  });

  it('mid-book percent maps to mid-duration', () => {
    const r = readerToAudio(
      { chapterIndex: 0, cfi: '', charOffset: 0, percentComplete: 0.5 },
      single,
    );
    assert.ok(Math.abs(r.timestampSeconds - 1800) < 1);
  });
});
