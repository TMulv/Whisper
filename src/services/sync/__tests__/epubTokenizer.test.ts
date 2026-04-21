import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { tokenizeChapter } from '../epubTokenizer';

const span = {
  epubChapterIndex: 3,
  epubPercentStart: 0.1,
  epubPercentEnd: 0.2,
};

describe('epubTokenizer — tokenizeChapter', () => {
  it('emits one token per word with stable char offsets', () => {
    const text = 'Hello world.';
    const toks = tokenizeChapter(text, span);
    assert.equal(toks.length, 2);
    assert.equal(toks[0].text, 'Hello');
    assert.equal(toks[0].charOffset, 0);
    assert.equal(toks[1].text, 'world');
    assert.equal(toks[1].charOffset, 6);
  });

  it('advances sentenceId on ". " / "! " / "? "', () => {
    const text = 'First one. Second! Third? Fourth.';
    const toks = tokenizeChapter(text, span);
    // sentence 0: First one
    // sentence 1: Second
    // sentence 2: Third
    // sentence 3: Fourth
    assert.equal(toks.find((t) => t.text === 'First')!.sentenceId, 0);
    assert.equal(toks.find((t) => t.text === 'one')!.sentenceId, 0);
    assert.equal(toks.find((t) => t.text === 'Second')!.sentenceId, 1);
    assert.equal(toks.find((t) => t.text === 'Third')!.sentenceId, 2);
    assert.equal(toks.find((t) => t.text === 'Fourth')!.sentenceId, 3);
  });

  it("does NOT advance sentenceId on mid-word abbreviations like 'Mr.Smith'", () => {
    // No whitespace after `.` — treat as one sentence.
    const text = 'Mr.Smith walked in.';
    const toks = tokenizeChapter(text, span);
    const ids = new Set(toks.map((t) => t.sentenceId));
    assert.equal(ids.size, 1);
  });

  it('emits pseudo CFI using the span chapter index + running sentence id', () => {
    const toks = tokenizeChapter('Alpha. Beta.', span);
    assert.equal(toks[0].cfi, 'pseudo:ch3/s0');
    assert.equal(toks[1].cfi, 'pseudo:ch3/s1');
  });

  it('interpolates percentComplete linearly across chapter span', () => {
    // 10 chars of text, span 0.1..0.2 — halfway char is 50% along span.
    const text = 'abc. defg.';
    const toks = tokenizeChapter(text, {
      epubChapterIndex: 0,
      epubPercentStart: 0.1,
      epubPercentEnd: 0.2,
    });
    // 'abc' starts at char 0 → percentComplete = 0.10
    assert.ok(Math.abs(toks[0].percentComplete - 0.1) < 1e-9);
    // 'defg' starts at char 5 → percentComplete = 0.1 + 0.5 * 0.1 = 0.15
    assert.ok(Math.abs(toks[1].percentComplete - 0.15) < 1e-9);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(tokenizeChapter('', span), []);
  });

  it('drops punctuation-only tokens', () => {
    const toks = tokenizeChapter('-- ... !!! Hello', span);
    assert.equal(toks.length, 1);
    assert.equal(toks[0].text, 'Hello');
  });
});
