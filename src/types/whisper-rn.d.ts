// Ambient type declarations for whisper.rn.
//
// The upstream package.json has `exports: { "./*": ... }` but no `.` entry,
// so `moduleResolution: "bundler"` can't resolve the bare `import
// 'whisper.rn'`. The real types at lib/typescript/index.d.ts are rich but
// unreachable from outside the package. We redeclare the minimum surface
// our adapter actually uses so typecheck passes without importing
// anything unsafe. The runtime side is unaffected — require() doesn't
// care about the exports field in the same way.

declare module 'whisper.rn' {
  export interface TranscribeResultSegment {
    text: string;
    /** Start time in centiseconds (10 ms ticks) relative to the audio span. */
    t0: number;
    /** End time in centiseconds (10 ms ticks) relative to the audio span. */
    t1: number;
  }

  export interface TranscribeResult {
    result: string;
    segments: TranscribeResultSegment[];
    isAborted?: boolean;
  }

  export interface TranscribeFileOptions {
    language?: string;
    tokenTimestamps?: boolean;
    maxLen?: number;
    /** Offset into the audio in ms. */
    offset?: number;
    /** Duration to process in ms. */
    duration?: number;
    onProgress?: (progress: number) => void;
  }

  export class WhisperContext {
    transcribe(
      filePathOrBase64: string | number,
      options?: TranscribeFileOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    release(): Promise<void>;
  }

  export interface ContextOptions {
    filePath: string | number;
    isBundleAsset?: boolean;
    useCoreMLIos?: boolean;
    useGpu?: boolean;
    useFlashAttn?: boolean;
  }

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>;
}
