// Whisper adapter — thin interface between the aligner and whatever ASR
// implementation is available. The real implementation will be a whisper.rn
// wrapper (installed in the native phase of Phase 2); this module defines the
// contract so the aligner, queue, and tests can be built and exercised
// without the native dependency in place.

export interface WhisperToken {
  /** Normalized text for this token (typically a word or sub-word). */
  text: string;
  /** Start time of the token in audio-file seconds. */
  startSeconds: number;
  /** End time of the token in audio-file seconds. */
  endSeconds: number;
  /** Model-reported confidence in [0, 1], when available. */
  confidence?: number;
}

export interface TranscribeOptions {
  audioPath: string;
  /** Chapter start in audio-file seconds. */
  startSeconds: number;
  /** Chapter end in audio-file seconds. */
  endSeconds: number;
  /** Language hint, e.g. 'en'. Undefined lets the model auto-detect. */
  language?: string;
  /** If provided, implementation should bail out when aborted. */
  signal?: AbortSignal;
  /** Reported [0..1] while transcribing — total progress, not per-chunk. */
  onProgress?: (fraction: number) => void;
}

export interface WhisperAdapter {
  /** True when the native binding and model are ready to transcribe. */
  isAvailable(): Promise<boolean>;
  /** Transcribe a single chapter's audio span. */
  transcribeChapter(opts: TranscribeOptions): Promise<WhisperToken[]>;
}

// Default no-op adapter. Used until the native whisper.rn integration lands
// — keeps the rest of the alignment pipeline compilable, testable, and
// opt-in from a runtime standpoint (the queue drains to zero work when the
// adapter reports unavailable).
export const stubWhisperAdapter: WhisperAdapter = {
  async isAvailable() {
    return false;
  },
  async transcribeChapter() {
    throw new Error(
      'Whisper adapter not installed. Phase 2 native integration is pending.',
    );
  },
};

let current: WhisperAdapter = stubWhisperAdapter;

export function setWhisperAdapter(adapter: WhisperAdapter): void {
  current = adapter;
}

export function getWhisperAdapter(): WhisperAdapter {
  return current;
}
