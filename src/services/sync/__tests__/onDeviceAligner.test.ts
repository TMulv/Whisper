import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AlignerQueue, EpubTextProvider, BookInfoProvider } from '../onDeviceAligner';
import { WhisperAdapter, WhisperToken } from '../whisperAdapter';
import { BookAlignment, M4BChapter } from '../../../types/sync';
import { buildLayer0 } from '../alignmentBuilder';
import { saveAlignment, getAlignment, deleteAlignment } from '../alignmentStore';

// In-memory AsyncStorage stand-in.
function memStore() {
  const map = new Map<string, string>();
  return {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
    _dump: () => Object.fromEntries(map),
  };
}

// Patch the module-level AsyncStorage used by alignmentStore. We import the
// real module (it uses @react-native-async-storage/async-storage) in nodeland
// where the RN module maps to a no-op default. For these tests we work
// through the AlignerQueue's storage override for queue persistence and
// accept that the alignmentStore itself runs against the real (node-stub)
// AsyncStorage. Since we never assert on what alignmentStore reads from disk
// between test runs, that's fine — we re-save each test.
const chapters: M4BChapter[] = [
  { index: 0, title: 'Ch 1', startSeconds: 0, endSeconds: 600 },
  { index: 1, title: 'Ch 2', startSeconds: 600, endSeconds: 1200 },
];

function makeAlignment(bookId: string): BookAlignment {
  return buildLayer0({ bookId, audioChapters: chapters, epubChapterCount: 2 });
}

class FakeWhisper implements WhisperAdapter {
  calls: Array<{ start: number; end: number }> = [];
  failures: number;
  tokens: WhisperToken[];
  constructor(tokens: WhisperToken[], failures = 0) {
    this.tokens = tokens;
    this.failures = failures;
  }
  async isAvailable() {
    return true;
  }
  async transcribeChapter(opts: {
    startSeconds: number;
    endSeconds: number;
  }) {
    this.calls.push({ start: opts.startSeconds, end: opts.endSeconds });
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('simulated whisper failure');
    }
    return this.tokens;
  }
}

const epubProvider: EpubTextProvider = {
  async getChapterTokens(_bookId, epubChapterIndex) {
    // Two-word sentence per chapter. Contents are stable so DTW matches.
    return [
      {
        text: 'hello',
        charOffset: 0,
        cfi: `cfi(ch${epubChapterIndex}-s0)`,
        sentenceId: 0,
        percentComplete: 0 + epubChapterIndex * 0.5,
      },
      {
        text: 'world',
        charOffset: 6,
        cfi: `cfi(ch${epubChapterIndex}-s0)`,
        sentenceId: 0,
        percentComplete: 0.05 + epubChapterIndex * 0.5,
      },
    ];
  },
};

const bookInfo: BookInfoProvider = {
  async getAudioPath() {
    return 'file:///tmp/book.m4b';
  },
  async getChapters() {
    return chapters;
  },
};

const whisperTokens: WhisperToken[] = [
  { text: 'hello', startSeconds: 10, endSeconds: 10.3 },
  { text: 'world', startSeconds: 10.3, endSeconds: 10.6 },
];

describe('AlignerQueue — basics', () => {
  beforeEach(async () => {
    await deleteAlignment('bk');
    await saveAlignment(makeAlignment('bk'));
  });

  it('is empty before enqueue', async () => {
    const storage = memStore();
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens),
      storage,
    });
    await q.hydrate();
    assert.equal(q.size(), 0);
  });

  it('enqueueAllPending adds every chapter without anchors', async () => {
    const storage = memStore();
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens),
      storage,
    });
    const added = await q.enqueueAllPending('bk');
    assert.equal(added, 2);
    assert.equal(q.size(), 2);
  });

  it('dedupes a chapter already enqueued', async () => {
    const storage = memStore();
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens),
      storage,
    });
    await q.enqueue('bk', 0);
    await q.enqueue('bk', 0);
    assert.equal(q.size(), 1);
  });

  it('processNext writes anchors and drains the queue', async () => {
    const storage = memStore();
    const whisper = new FakeWhisper(whisperTokens);
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: whisper,
      storage,
    });
    await q.enqueueAllPending('bk');
    const first = await q.processNext();
    assert.equal(first.processed, true);
    assert.equal(first.anchorCount, 1);
    const second = await q.processNext();
    assert.equal(second.processed, true);
    assert.equal(q.size(), 0);

    const updated = await getAlignment('bk');
    assert.ok(updated);
    assert.equal(updated!.l1Anchors[0]?.length, 1);
    assert.equal(updated!.l1Anchors[1]?.length, 1);
    assert.equal(updated!.status, 'complete');

    // Whisper was called with chapter bounds, not whole-book.
    assert.deepEqual(whisper.calls, [
      { start: 0, end: 600 },
      { start: 600, end: 1200 },
    ]);
  });

  it('transient failure retries up to max attempts', async () => {
    const storage = memStore();
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens, 1),
      storage,
    });
    await q.enqueue('bk', 0);
    const r1 = await q.processNext();
    assert.equal(r1.processed, false);
    assert.match(r1.error ?? '', /simulated/);
    assert.equal(q.size(), 1); // re-queued
    const r2 = await q.processNext();
    assert.equal(r2.processed, true);
  });

  it('reports whisper-unavailable without draining the queue', async () => {
    const storage = memStore();
    const whisper: WhisperAdapter = {
      async isAvailable() {
        return false;
      },
      async transcribeChapter() {
        throw new Error('never called');
      },
    };
    const q = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: whisper,
      storage,
    });
    await q.enqueue('bk', 0);
    const r = await q.processNext();
    assert.equal(r.processed, false);
    assert.equal(r.error, 'whisper-unavailable');
    assert.equal(q.size(), 1);
  });

  it('queue survives a fresh instance via storage', async () => {
    const storage = memStore();
    const q1 = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens),
      storage,
    });
    await q1.enqueue('bk', 1);

    const q2 = new AlignerQueue({
      epubTextProvider: epubProvider,
      bookInfoProvider: bookInfo,
      whisperAdapter: new FakeWhisper(whisperTokens),
      storage,
    });
    await q2.hydrate();
    assert.equal(q2.size(), 1);
    assert.equal(q2.peek()?.audioChapterIndex, 1);
  });
});
