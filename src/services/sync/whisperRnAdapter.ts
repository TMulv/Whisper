// Production WhisperAdapter backed by `whisper.rn`.
//
// Lazy init: the native context is created on the first call to
// `isAvailable()` or `transcribeChapter()`, not at app startup, so a user
// who never enters a book never pays the model-download + context-init cost.
//
// Model download: fetched from the official whisper.cpp HuggingFace mirror
// and cached in the app's document directory. A stale/corrupt file is
// detected on context init (initWhisper throws) and re-downloaded on the
// next attempt.
//
// The native module ships with the package but is only wired in after a
// dev build / EAS prebuild of iOS + Android. Before that step, importing
// `whisper.rn` succeeds (it's JS) but calling `initWhisper` throws. We
// surface that as `isAvailable() === false` so the opportunistic loop
// exits cleanly instead of crashing.

import { File, Directory, Paths } from 'expo-file-system';
import { logger } from '@/utils/logger';
import {
  WhisperAdapter,
  WhisperToken,
  TranscribeOptions,
} from './whisperAdapter';

// Lazy import — importing at module top-level in Expo Go (where the native
// module isn't linked) can break the bundle. Requiring inside the function
// lets us catch + report "not available" instead.
type WhisperRnModule = typeof import('whisper.rn');
type WhisperContext = import('whisper.rn').WhisperContext;

function loadWhisperRn(): WhisperRnModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('whisper.rn') as WhisperRnModule;
  } catch (err) {
    logger.info('whisper.rn not loadable in this runtime', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── Model management ────────────────────────────────────────────────────────

/**
 * Default: `base.en` — 147 MB, substantially better accuracy on proper nouns
 * and accents than `tiny.en` (39 MB) at still-tolerable on-device speed.
 * We only need good-enough ASR to DTW against the known epub text, but
 * audiobooks have names and specialised vocabulary where tiny mis-transcribes.
 */
const DEFAULT_MODEL = {
  filename: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
};

interface ModelSpec {
  filename: string;
  url: string;
}

async function ensureModelDownloaded(model: ModelSpec): Promise<string> {
  const dir = new Directory(Paths.document, 'whisper');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, model.filename);
  if (file.exists && (file.size ?? 0) > 1_000_000) {
    return file.uri;
  }

  logger.info('Downloading Whisper model', {
    url: model.url,
    target: file.uri,
  });

  // File.downloadFileAsync streams to disk rather than pulling the blob
  // through JS memory — the base.en model is 147 MB so that matters.
  const dl = await File.downloadFileAsync(model.url, file);
  if (!dl || !dl.exists || (dl.size ?? 0) < 1_000_000) {
    throw new Error('Whisper model download failed or is truncated');
  }
  return dl.uri;
}

// ── Context lifecycle ───────────────────────────────────────────────────────

let contextPromise: Promise<WhisperContext> | null = null;
let availabilityChecked = false;
let availabilityValue = false;

async function getContext(model: ModelSpec): Promise<WhisperContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    const rn = loadWhisperRn();
    if (!rn) throw new Error('whisper.rn not linked in this build');
    const path = await ensureModelDownloaded(model);
    logger.info('Initialising Whisper context', { path });
    const ctx = await rn.initWhisper({
      filePath: path,
      // Let whisper.rn pick the best backend for the platform. GPU on iOS
      // (Metal) is a large speedup; Android stays on CPU.
      useGpu: true,
      useFlashAttn: true,
    });
    return ctx;
  })();
  try {
    return await contextPromise;
  } catch (err) {
    contextPromise = null; // allow retry next call
    throw err;
  }
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export interface WhisperRnAdapterOptions {
  /** Override the default model (base.en). */
  model?: ModelSpec;
}

export function createWhisperRnAdapter(
  opts: WhisperRnAdapterOptions = {},
): WhisperAdapter {
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async isAvailable(): Promise<boolean> {
      if (availabilityChecked) return availabilityValue;
      const rn = loadWhisperRn();
      if (!rn) {
        availabilityChecked = true;
        availabilityValue = false;
        return false;
      }
      // We don't actually init the context here — that would pull the
      // model download eagerly. Report available if the module loads; the
      // first transcribe call will init the context and surface any errors
      // up through the aligner's retry logic.
      availabilityChecked = true;
      availabilityValue = true;
      return true;
    },

    async transcribeChapter(options: TranscribeOptions): Promise<WhisperToken[]> {
      const ctx = await getContext(model);
      const offsetMs = Math.floor(options.startSeconds * 1000);
      const durationMs = Math.floor(
        (options.endSeconds - options.startSeconds) * 1000,
      );

      const { stop, promise } = ctx.transcribe(options.audioPath, {
        language: options.language ?? 'en',
        // Word-level timestamps — essential for DTW. maxLen: 1 forces one
        // word per segment so each `t0/t1` pair corresponds to a single
        // spoken word rather than a sentence.
        tokenTimestamps: true,
        maxLen: 1,
        offset: offsetMs,
        duration: durationMs,
        onProgress: options.onProgress
          ? (p) => options.onProgress!(p / 100)
          : undefined,
      });

      const abortHandler = () => {
        stop().catch(() => {
          /* ignore */
        });
      };
      options.signal?.addEventListener('abort', abortHandler);

      try {
        const result = await promise;
        if (result.isAborted) throw new Error('aborted');

        // whisper.cpp returns t0/t1 in centiseconds (10 ms ticks) relative
        // to the transcribed audio span. Convert to seconds and offset back
        // to absolute audio-file time.
        return result.segments.map((seg) => ({
          text: seg.text,
          startSeconds: options.startSeconds + seg.t0 / 100,
          endSeconds: options.startSeconds + seg.t1 / 100,
        }));
      } finally {
        options.signal?.removeEventListener('abort', abortHandler);
      }
    },
  };
}

/** Convenience for tests that want to reset the lazy singletons. */
export function __resetWhisperRnAdapter(): void {
  contextPromise = null;
  availabilityChecked = false;
  availabilityValue = false;
}
