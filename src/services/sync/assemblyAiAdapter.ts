// AssemblyAI WhisperAdapter — drop-in replacement for whisperRnAdapter.
//
// Transcribes the full audio file once via AssemblyAI and caches the word-level
// result to disk. Subsequent calls for other chapters of the same book just
// filter the cached words — no re-upload, no re-transcription.
//
// Deduplication: a per-audioPath in-flight promise ensures concurrent chapter
// requests (e.g. during fast chapter transitions) don't trigger duplicate jobs.

import { File, Directory, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/utils/logger';
import { WhisperAdapter, WhisperToken, TranscribeOptions } from './whisperAdapter';

export type TranscriptionPhase = 'upload' | 'submit' | 'poll' | 'done';

export interface TranscriptionStatus {
  /** Overall progress, 0..1, used to drive the bar. */
  fraction: number;
  /** Current phase — used by the UI to show phase-specific copy. */
  phase: TranscriptionPhase;
  /** Estimated seconds remaining; null when we don't have a usable signal. */
  etaSeconds: number | null;
}

const API_KEY = process.env.EXPO_PUBLIC_ASSEMBLYAI_API_KEY ?? '';
const BASE_URL = 'https://api.assemblyai.com/v2';
const CACHE_SUBDIR = 'assemblyai';
const POLL_INTERVAL_MS = 5_000;

// ── AssemblyAI response types ────────────────────────────────────────────────

export interface AssemblyWord {
  text: string;
  start: number; // milliseconds
  end: number;
  confidence: number;
}

interface TranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  words?: AssemblyWord[];
  audio_duration?: number; // seconds
  error?: string;
}

// ── Disk cache ───────────────────────────────────────────────────────────────

function cacheFile(audioPath: string): File {
  const key = audioPath.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'unknown';
  const dir = new Directory(Paths.document, CACHE_SUBDIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, `${key}.json`);
}

async function loadCache(audioPath: string): Promise<AssemblyWord[] | null> {
  try {
    const f = cacheFile(audioPath);
    if (!f.exists) return null;
    const raw = await f.text();
    return JSON.parse(raw) as AssemblyWord[];
  } catch {
    return null;
  }
}

async function saveCache(audioPath: string, words: AssemblyWord[]): Promise<void> {
  try {
    const f = cacheFile(audioPath);
    await f.write(JSON.stringify(words));
  } catch (err) {
    logger.warn('AssemblyAI: failed to write transcript cache', { err });
  }
}

// ── API helpers ──────────────────────────────────────────────────────────────

/**
 * Persist the AssemblyAI job id keyed by audio path so polling can resume
 * after the app is force-quit during a transcription. Without this, killing
 * the app mid-transcription forces a complete re-upload + re-transcribe;
 * with it, we just resume polling.
 */
const JOB_KEY_PREFIX = '@whisper/aai/job/';

interface PersistedJob {
  jobId: string;
  audioPath: string;
  submittedAt: number;
  audioDurationSeconds?: number; // for ETA estimation on resume
}

function jobStorageKey(audioPath: string): string {
  // Use the same sanitization as the cache file naming so the keys align.
  const k = audioPath.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'unknown';
  return `${JOB_KEY_PREFIX}${k}`;
}

async function loadPersistedJob(audioPath: string): Promise<PersistedJob | null> {
  try {
    const raw = await AsyncStorage.getItem(jobStorageKey(audioPath));
    return raw ? (JSON.parse(raw) as PersistedJob) : null;
  } catch { return null; }
}

async function savePersistedJob(job: PersistedJob): Promise<void> {
  try {
    await AsyncStorage.setItem(jobStorageKey(job.audioPath), JSON.stringify(job));
  } catch (err) {
    logger.warn('AssemblyAI: failed to persist job', { err });
  }
}

async function clearPersistedJob(audioPath: string): Promise<void> {
  try { await AsyncStorage.removeItem(jobStorageKey(audioPath)); } catch { /* ignore */ }
}

async function uploadAudio(
  audioPath: string,
  onProgress?: (f: number, etaSeconds: number | null) => void,
): Promise<string> {
  // Stream the file from disk via the OS networking stack, with byte-level
  // progress. Doing this through `fetch(file://).blob()` loaded the entire
  // (often >300MB) audio into JS memory, which on the Android legacy
  // architecture would OOM or hang silently — that's why earlier runs got
  // stuck at the "0.05" pre-upload progress mark.
  const startedAt = Date.now();
  let lastBytes = 0;
  let lastTimeMs = startedAt;
  // Exponential moving average of bytes/ms for a stable ETA on noisy
  // throughput. New samples weighted at 0.3, prior at 0.7.
  let smoothedRate = 0;
  return new Promise<string>((resolve, reject) => {
    const task = LegacyFS.createUploadTask(
      `${BASE_URL}/upload`,
      audioPath,
      {
        httpMethod: 'POST',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          authorization: API_KEY,
          'content-type': 'application/octet-stream',
        },
      },
      (data) => {
        if (data.totalBytesExpectedToSend > 0) {
          const f = data.totalBytesSent / data.totalBytesExpectedToSend;
          const now = Date.now();
          const dBytes = data.totalBytesSent - lastBytes;
          const dMs = Math.max(1, now - lastTimeMs);
          const instantRate = dBytes / dMs; // bytes per ms
          smoothedRate = smoothedRate === 0
            ? instantRate
            : smoothedRate * 0.7 + instantRate * 0.3;
          lastBytes = data.totalBytesSent;
          lastTimeMs = now;
          let eta: number | null = null;
          if (smoothedRate > 0 && now - startedAt > 1500) {
            const remainingBytes =
              data.totalBytesExpectedToSend - data.totalBytesSent;
            eta = Math.max(1, Math.round(remainingBytes / smoothedRate / 1000));
          }
          onProgress?.(f, eta);
        }
      },
    );
    task
      .uploadAsync()
      .then((result) => {
        if (!result || result.status < 200 || result.status >= 300) {
          reject(
            new Error(
              `AssemblyAI upload failed: ${result?.status ?? 'no response'} ${
                result?.body ?? ''
              }`.trim(),
            ),
          );
          return;
        }
        try {
          const json = JSON.parse(result.body) as { upload_url: string };
          resolve(json.upload_url);
        } catch (err) {
          reject(
            new Error(
              `AssemblyAI upload returned non-JSON: ${result.body.slice(0, 200)}`,
            ),
          );
        }
      })
      .catch(reject);
  });
}

async function submitJob(audioUrl: string, language?: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/transcript`, {
    method: 'POST',
    headers: {
      authorization: API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: language ?? 'en',
    }),
  });
  if (!resp.ok) throw new Error(`AssemblyAI submit failed: ${resp.status}`);
  const json = (await resp.json()) as { id: string };
  return json.id;
}

/**
 * Poll the AssemblyAI job until it completes. Reports a normalized
 * progress fraction in [0, 1] AND a heuristic ETA (seconds) — Universal-1
 * typically processes audio at ~10–20% of the audio's own duration in
 * wall-clock time, so for a 12h audiobook expect 75–150 minutes.
 */
async function pollUntilDone(
  jobId: string,
  audioDurationSeconds: number | undefined,
  startedAtMs: number,
  signal?: AbortSignal,
  onProgress?: (fraction: number, etaSeconds: number | null) => void,
): Promise<AssemblyWord[]> {
  // 15% of audio duration is a reasonable middle-of-the-range heuristic.
  // We refine the ETA over time as wall-clock elapses.
  const heuristicTotalMs = audioDurationSeconds && audioDurationSeconds > 0
    ? audioDurationSeconds * 0.15 * 1000
    : null;
  onProgress?.(0.2, heuristicTotalMs ? Math.round(heuristicTotalMs / 1000) : null);

  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));

    const resp = await fetch(`${BASE_URL}/transcript/${jobId}`, {
      headers: { authorization: API_KEY },
    });
    if (!resp.ok) throw new Error(`AssemblyAI poll failed: ${resp.status}`);
    const json = (await resp.json()) as TranscriptResponse;

    if (json.status === 'completed') {
      onProgress?.(1, 0);
      return json.words ?? [];
    }
    if (json.status === 'error') {
      throw new Error(`AssemblyAI transcription error: ${json.error ?? 'unknown'}`);
    }
    if (json.status === 'processing' || json.status === 'queued') {
      // Estimate progress + ETA from elapsed wall-clock vs. heuristic total.
      const elapsedMs = Date.now() - startedAtMs;
      let fraction = 0.5;
      let etaSeconds: number | null = null;
      if (heuristicTotalMs) {
        fraction = Math.min(0.97, 0.2 + (elapsedMs / heuristicTotalMs) * 0.77);
        etaSeconds = Math.max(
          5,
          Math.round((heuristicTotalMs - elapsedMs) / 1000),
        );
      }
      onProgress?.(fraction, etaSeconds);
    }
  }
}

// ── In-flight deduplication ──────────────────────────────────────────────────

const inFlight = new Map<string, Promise<AssemblyWord[]>>();

async function getFullTranscript(
  audioPath: string,
  language?: string,
  signal?: AbortSignal,
  onStatus?: (s: TranscriptionStatus) => void,
  audioDurationSeconds?: number,
): Promise<AssemblyWord[]> {
  const cached = await loadCache(audioPath);
  if (cached) {
    onStatus?.({ fraction: 1, phase: 'done', etaSeconds: 0 });
    return cached;
  }

  if (inFlight.has(audioPath)) {
    return inFlight.get(audioPath)!;
  }

  const job = (async () => {
    try {
      // ── Resume path ──
      // If there's a persisted job for this audio file, skip upload+submit
      // and jump straight to polling. This is the case when the user opens
      // a reader for which transcription was previously kicked off in a
      // session that was force-quit before the poll finished.
      const persisted = await loadPersistedJob(audioPath);
      let jobId: string;
      let pollStartedAt: number;

      if (persisted?.jobId) {
        logger.info('AssemblyAI: resuming persisted job', {
          jobId: persisted.jobId,
          submittedAt: persisted.submittedAt,
          audioPath,
        });
        jobId = persisted.jobId;
        pollStartedAt = persisted.submittedAt;
        onStatus?.({ fraction: 0.45, phase: 'poll', etaSeconds: null });
      } else {
        // Phase 1: upload (0..0.4). Bytes streamed from disk; ETA from
        // a smoothed bytes/ms rate.
        logger.info('AssemblyAI: uploading audio', { audioPath });
        onStatus?.({ fraction: 0.01, phase: 'upload', etaSeconds: null });
        const uploadUrl = await uploadAudio(audioPath, (uploadFraction, eta) => {
          onStatus?.({
            fraction: 0.01 + uploadFraction * 0.39,
            phase: 'upload',
            etaSeconds: eta,
          });
        });

        // Phase 2: submit (0.4..0.45). ~1s. Persist the job id immediately
        // so a force-quit between submit and first poll still resumes.
        onStatus?.({ fraction: 0.4, phase: 'submit', etaSeconds: null });
        logger.info('AssemblyAI: submitting transcription job');
        jobId = await submitJob(uploadUrl, language);
        pollStartedAt = Date.now();
        await savePersistedJob({
          jobId,
          audioPath,
          submittedAt: pollStartedAt,
          audioDurationSeconds,
        });
        onStatus?.({ fraction: 0.45, phase: 'poll', etaSeconds: null });
      }

      // Phase 3: poll (0.45..1.0). Survives backgrounding — even if the
      // app is suspended mid-poll, AAI keeps processing on its servers
      // and the next foreground will resume from the persisted job id.
      logger.info('AssemblyAI: polling for result', { jobId });
      const words = await pollUntilDone(
        jobId,
        audioDurationSeconds ?? persisted?.audioDurationSeconds,
        pollStartedAt,
        signal,
        (pollFraction, etaSeconds) => {
          // pollFraction is a [0.2..1.0] curve from pollUntilDone's
          // local space. Map its tail into [0.45..1.0] of the overall bar.
          const clamped = Math.max(0.2, Math.min(1, pollFraction));
          const overall = 0.45 + ((clamped - 0.2) / 0.8) * 0.55;
          onStatus?.({
            fraction: overall,
            phase: pollFraction >= 1 ? 'done' : 'poll',
            etaSeconds,
          });
        },
      );

      await saveCache(audioPath, words);
      await clearPersistedJob(audioPath);
      logger.info('AssemblyAI: transcript cached', { wordCount: words.length });
      onStatus?.({ fraction: 1, phase: 'done', etaSeconds: 0 });
      return words;
    } finally {
      inFlight.delete(audioPath);
    }
  })();

  inFlight.set(audioPath, job);
  return job;
}

// ── Adapter factory ──────────────────────────────────────────────────────────

export function createAssemblyAiAdapter(): WhisperAdapter {
  return {
    async isAvailable(): Promise<boolean> {
      return API_KEY.length > 0;
    },

    async transcribeChapter(opts: TranscribeOptions): Promise<WhisperToken[]> {
      if (!API_KEY) {
        throw new Error(
          'AssemblyAI API key not set. Add EXPO_PUBLIC_ASSEMBLYAI_API_KEY to your .env file.',
        );
      }

      // Adapt the legacy WhisperAdapter onProgress(fraction) to the new
      // status-shaped callback. Drops phase + ETA, which the queue-driven
      // aligner doesn't surface anywhere visible.
      const allWords = await getFullTranscript(
        opts.audioPath,
        opts.language,
        opts.signal,
        opts.onProgress
          ? (s) => opts.onProgress?.(s.fraction)
          : undefined,
      );

      // Filter to the requested chapter window and convert ms → seconds.
      return allWords
        .filter(
          (w) => w.end / 1000 >= opts.startSeconds && w.start / 1000 <= opts.endSeconds,
        )
        .map((w) => ({
          text: w.text,
          startSeconds: w.start / 1000,
          endSeconds: w.end / 1000,
          confidence: w.confidence,
        }));
    },
  };
}

/**
 * Load the AssemblyAI word-level transcript from disk if it has been cached
 * for this audio file. Returns null when the file hasn't been transcribed
 * yet — callers should fall back to a coarser sync tier in that case.
 */
export async function loadCachedAssemblyAiWords(
  audioPath: string,
): Promise<AssemblyWord[] | null> {
  return loadCache(audioPath);
}

/**
 * Fire-and-forget: ensure an AssemblyAI transcript exists on disk for this
 * audio file. Idempotent (returns immediately if cached or in-flight) and
 * safe to call from a component effect. The caller does not await — the
 * background job populates the cache so that the *next* reader→audio
 * handoff can do word-accurate sync. The first handoff after import will
 * still fall back to L0/L0.5 because transcription takes minutes.
 */
export function kickoffAssemblyAiTranscription(
  audioPath: string,
  onStatus?: (s: TranscriptionStatus) => void,
  audioDurationSeconds?: number,
): void {
  if (!API_KEY) return;
  // Ignore the returned promise; getFullTranscript handles in-flight
  // dedup, persistence, and disk caching internally.
  getFullTranscript(
    audioPath,
    undefined,
    undefined,
    onStatus,
    audioDurationSeconds,
  ).catch((err) => {
    logger.warn('kickoffAssemblyAiTranscription failed', {
      audioPath,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Delete the on-disk cache for a given audio file (e.g. on book delete). */
export async function clearAssemblyAiCache(audioPath: string): Promise<void> {
  try {
    const f = cacheFile(audioPath);
    if (f.exists) await f.delete();
  } catch (err) {
    logger.warn('AssemblyAI: failed to clear cache', { err });
  }
}
