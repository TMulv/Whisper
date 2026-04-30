import { logger } from '@/utils/logger';
import type { TranscriptionStatus } from '@/types/sync';

export function watchTranscriptionProgress(
  bookId: string,
  callback: (status: TranscriptionStatus) => void,
): () => void {
  logger.debug('transcriptionProgress: stub watcher started', { bookId });
  return () => {
    logger.debug('transcriptionProgress: stub watcher stopped', { bookId });
  };
}
