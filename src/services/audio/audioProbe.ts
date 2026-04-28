import TrackPlayer from 'react-native-track-player';
import { setupPlayer } from './trackPlayerService';
import { logger } from '@/utils/logger';

// Probe an audio file's duration by briefly loading it into TrackPlayer.
// Used at import time (and as a self-heal fallback) so that the rest of the
// sync pipeline has a real audio span to align against — without it,
// alignmentBuilder produces a `[0, 0]` chapter and every reader→audio
// handoff resolves to 0:00.
//
// Side effects: calls TrackPlayer.reset() at start and end. Callers must
// only invoke this when no playback is active (or is about to be replaced
// anyway, e.g. immediately before loadBook). The import-time call sites
// run before any track is loaded; the self-heal path runs immediately
// before prepareBookForPlayback returns, and loadBook calls reset() itself.
export async function probeAudioDuration(uri: string): Promise<number> {
  try {
    await setupPlayer(); // idempotent — internal try/catch swallows the
                         // "already initialised" error

    await TrackPlayer.reset();
    await TrackPlayer.add({
      id: '__probe__',
      url: uri,
      title: 'probe',
      artist: '',
    });

    // getDuration returns 0 until metadata is read off the file. Poll
    // briefly with a 3 s cap — typical m4b decode is well under 500 ms in
    // practice on the simulator and on-device.
    let d = await TrackPlayer.getDuration();
    const start = Date.now();
    while (d <= 0 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      d = await TrackPlayer.getDuration();
    }

    await TrackPlayer.reset();

    if (d <= 0) {
      logger.warn('probeAudioDuration: timed out waiting for duration', { uri });
      return 0;
    }
    logger.info('probeAudioDuration: ok', { uri, duration: d });
    return d;
  } catch (err) {
    logger.warn('probeAudioDuration failed', {
      uri,
      error: err instanceof Error ? err.message : String(err),
    });
    try { await TrackPlayer.reset(); } catch { /* ignore */ }
    return 0;
  }
}
