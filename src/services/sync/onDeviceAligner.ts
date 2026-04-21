// Opportunistic on-device aligner.
//
// Drains a persistent per-chapter queue: for each entry it fetches the
// chapter's audio span + epub tokens, transcribes the audio with the active
// whisper adapter, DTW-aligns the two, and writes sentence-level anchors
// into the alignment store. The queue survives process restarts (AsyncStorage)
// and is idempotent — re-processing a chapter simply overwrites its anchors.
//
// Chunks are chapter-granularity for now. Resume-after-kill therefore means
// restarting the in-flight chapter, which is acceptable for typical chapter
// durations. Finer sub-chapter chunking is an upgrade path when needed.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { M4BChapter } from '@/types/sync';
import { alignTokens, extractAnchors, EpubToken } from './dtw';
import { setChapterAnchors, getAlignment } from './alignmentStore';
import { getWhisperAdapter, WhisperAdapter } from './whisperAdapter';

const QUEUE_KEY = '@whisper/aligner/queue/v1';
const MAX_ATTEMPTS = 3;

export interface QueueItem {
  bookId: string;
  audioChapterIndex: number;
  addedAt: number;
  attempts: number;
  lastError?: string;
}

export interface EpubTextProvider {
  /** Return the flat, sentence-tagged token list for a single epub chapter. */
  getChapterTokens(bookId: string, epubChapterIndex: number): Promise<EpubToken[]>;
}

export interface BookInfoProvider {
  getAudioPath(bookId: string): Promise<string | null>;
  getChapters(bookId: string): Promise<M4BChapter[]>;
}

export interface AlignerDeps {
  epubTextProvider: EpubTextProvider;
  bookInfoProvider: BookInfoProvider;
  /** Override for tests. Defaults to `getWhisperAdapter()`. */
  whisperAdapter?: WhisperAdapter;
  /** Override for tests. Defaults to AsyncStorage. */
  storage?: {
    getItem: (k: string) => Promise<string | null>;
    setItem: (k: string, v: string) => Promise<void>;
  };
}

export interface ProcessResult {
  processed: boolean;
  bookId?: string;
  audioChapterIndex?: number;
  anchorCount?: number;
  error?: string;
}

export class AlignerQueue {
  private queue: QueueItem[] = [];
  private hydrated = false;
  private inFlight: QueueItem | null = null;

  constructor(private deps: AlignerDeps) {}

  private get storage() {
    return this.deps.storage ?? AsyncStorage;
  }

  private get whisper(): WhisperAdapter {
    return this.deps.whisperAdapter ?? getWhisperAdapter();
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await this.storage.getItem(QUEUE_KEY);
      this.queue = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    } catch {
      this.queue = [];
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  size(): number {
    return this.queue.length;
  }

  peek(): QueueItem | null {
    return this.queue[0] ?? null;
  }

  /** Enqueue a single chapter. Dedupes against pending + in-flight. */
  async enqueue(bookId: string, audioChapterIndex: number): Promise<void> {
    await this.hydrate();
    const already =
      this.queue.some(
        (q) => q.bookId === bookId && q.audioChapterIndex === audioChapterIndex,
      ) ||
      (this.inFlight?.bookId === bookId &&
        this.inFlight?.audioChapterIndex === audioChapterIndex);
    if (already) return;
    this.queue.push({
      bookId,
      audioChapterIndex,
      addedAt: Date.now(),
      attempts: 0,
    });
    await this.persist();
  }

  /**
   * Enqueue every chapter of a book that doesn't yet have anchors. Skips
   * chapters whose L1 list is already populated.
   */
  async enqueueAllPending(bookId: string): Promise<number> {
    await this.hydrate();
    const alignment = await getAlignment(bookId);
    if (!alignment) return 0;
    let added = 0;
    for (const chapter of alignment.chapters) {
      const existing = alignment.l1Anchors[chapter.audioChapterIndex];
      if (existing && existing.length > 0) continue;
      await this.enqueue(bookId, chapter.audioChapterIndex);
      added += 1;
    }
    return added;
  }

  /**
   * Pop and process one chapter. Safe to call while idle (returns
   * `{ processed: false }`). Never throws — errors are captured into the
   * item and re-queued until MAX_ATTEMPTS.
   */
  async processNext(signal?: AbortSignal): Promise<ProcessResult> {
    await this.hydrate();
    if (this.inFlight) {
      return { processed: false, error: 'busy' };
    }
    if (this.queue.length === 0) {
      return { processed: false };
    }

    if (!(await this.whisper.isAvailable())) {
      return { processed: false, error: 'whisper-unavailable' };
    }

    const item = this.queue.shift()!;
    this.inFlight = item;
    await this.persist();

    try {
      const result = await this.runItem(item, signal);
      this.inFlight = null;
      await this.persist();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const next: QueueItem = {
        ...item,
        attempts: item.attempts + 1,
        lastError: message,
      };
      this.inFlight = null;
      if (next.attempts < MAX_ATTEMPTS) {
        this.queue.push(next);
      }
      await this.persist();
      return {
        processed: false,
        bookId: item.bookId,
        audioChapterIndex: item.audioChapterIndex,
        error: message,
      };
    }
  }

  private async runItem(
    item: QueueItem,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const alignment = await getAlignment(item.bookId);
    if (!alignment) {
      throw new Error(`no alignment for ${item.bookId}`);
    }
    const chapter = alignment.chapters.find(
      (c) => c.audioChapterIndex === item.audioChapterIndex,
    );
    if (!chapter) {
      throw new Error(
        `chapter ${item.audioChapterIndex} not in alignment for ${item.bookId}`,
      );
    }

    const [audioPath, epubTokens] = await Promise.all([
      this.deps.bookInfoProvider.getAudioPath(item.bookId),
      this.deps.epubTextProvider.getChapterTokens(
        item.bookId,
        chapter.epubChapterIndex,
      ),
    ]);
    if (!audioPath) throw new Error('no audio path');
    if (epubTokens.length === 0) {
      // Empty chapter — record an empty anchor list so we don't retry.
      await setChapterAnchors(item.bookId, item.audioChapterIndex, []);
      return {
        processed: true,
        bookId: item.bookId,
        audioChapterIndex: item.audioChapterIndex,
        anchorCount: 0,
      };
    }

    const whisperTokens = await this.whisper.transcribeChapter({
      audioPath,
      startSeconds: chapter.audioStartSeconds,
      endSeconds: chapter.audioEndSeconds,
      signal,
    });

    const dtw = alignTokens(whisperTokens, epubTokens);
    const anchors = extractAnchors(whisperTokens, epubTokens, dtw);
    await setChapterAnchors(item.bookId, item.audioChapterIndex, anchors);

    return {
      processed: true,
      bookId: item.bookId,
      audioChapterIndex: item.audioChapterIndex,
      anchorCount: anchors.length,
    };
  }
}

// Shared singleton for the app. Tests should instantiate their own.
let singleton: AlignerQueue | null = null;
export function initAlignerQueue(deps: AlignerDeps): AlignerQueue {
  singleton = new AlignerQueue(deps);
  return singleton;
}
export function getAlignerQueue(): AlignerQueue | null {
  return singleton;
}
