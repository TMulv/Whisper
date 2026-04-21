// App-startup wiring for the on-device alignment pipeline.
//
// Kept in its own module so App.tsx doesn't need to know the details.
// Idempotent — safe to call from a component effect even though it
// installs a process-wide singleton.

import { setWhisperAdapter } from './whisperAdapter';
import { createWhisperRnAdapter } from './whisperRnAdapter';
import { initAlignerQueue, getAlignerQueue } from './onDeviceAligner';
import {
  createEpubTextProvider,
  createBookInfoProvider,
} from './providers';
import { getCurrentUser } from '@/services/firebase/authService';
import { logger } from '@/utils/logger';

let installed = false;

export function installAlignmentPipeline(): void {
  if (installed) return;
  installed = true;

  try {
    setWhisperAdapter(createWhisperRnAdapter());

    const epubTextProvider = createEpubTextProvider();
    const bookInfoProvider = createBookInfoProvider(
      () => getCurrentUser()?.uid ?? null,
    );

    initAlignerQueue({ epubTextProvider, bookInfoProvider });
    // Pre-hydrate so we know the queue's persisted state without waiting for
    // the first processNext call.
    getAlignerQueue()?.hydrate().catch(() => {});

    logger.info('Alignment pipeline installed');
  } catch (err) {
    logger.error('Failed to install alignment pipeline', err);
  }
}
