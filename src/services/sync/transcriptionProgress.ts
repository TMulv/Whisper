import { logger } from '@/utils/logger';

export type TranscriptionStatus = {
  progress?: number;
  status?: string;
};

export function watchTranscriptionProgress(
  bookId: string,
  callback: (status: TranscriptionStatus) => void,
): () => void {
  logger.debug('transcriptionProgress: stub watcher started', { bookId });
  return () => {
    logger.debug('transcriptionProgress: stub watcher stopped', { bookId });
  };
}
