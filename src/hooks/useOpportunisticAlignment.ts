// Drives the on-device aligner while the app is usable (foreground or
// actively playing audio). Yields between chunks to keep the UI thread
// responsive — a chapter transcription is long, but AlignerQueue.processNext
// resolves once the chapter is done and the hook re-enters for the next one.
//
// Safe to mount unconditionally. If no AlignerQueue has been initialised
// (native whisper not available yet) the hook is a no-op.

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { usePlaybackState, State } from 'react-native-track-player';
import { getAlignerQueue } from '@/services/sync/onDeviceAligner';
import { logger } from '@/utils/logger';

const IDLE_COOLDOWN_MS = 2000;

export function useOpportunisticAlignment(enabled: boolean = true): void {
  const playback = usePlaybackState();
  const isPlaying = playback.state === State.Playing;
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const queue = getAlignerQueue();
    if (!queue) return;

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    const loop = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        while (!cancelled) {
          const allowed =
            appStateRef.current === 'active' || isPlaying;
          if (!allowed) break;
          if (queue.size() === 0) break;

          const result = await queue.processNext(controller.signal);
          if (!result.processed) {
            if (result.error === 'whisper-unavailable') break;
            // Cool off briefly on idle / transient errors to avoid a hot loop.
            await new Promise((r) => setTimeout(r, IDLE_COOLDOWN_MS));
          }
        }
      } catch (err) {
        logger.error('opportunistic alignment loop failed', err);
      } finally {
        runningRef.current = false;
      }
    };

    loop();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, isPlaying]);
}
