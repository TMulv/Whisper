import AsyncStorage from '@react-native-async-storage/async-storage';
import { OFFLINE_QUEUE_KEY } from '@/constants/config';
import { FirestorePosition } from '@/types/firebase';
import { writePosition, writeSyncState } from '@/services/firebase/firestoreService';
import { logger } from '@/utils/logger';

export type QueueOperation =
  | { type: 'WRITE_POSITION'; userId: string; bookId: string; deviceId: string; payload: FirestorePosition }
  | { type: 'WRITE_SYNC_STATE'; userId: string; bookId: string; payload: FirestorePosition };

export async function enqueue(operation: QueueOperation): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const queue: QueueOperation[] = raw ? JSON.parse(raw) : [];
    queue.push(operation);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    logger.error('offlineQueue.enqueue failed', err);
  }
}

export async function dequeue(): Promise<QueueOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const queue: QueueOperation[] = JSON.parse(raw);
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    return queue;
  } catch (err) {
    logger.error('offlineQueue.dequeue failed', err);
    return [];
  }
}

/**
 * Deduplicate: keep only the latest operation per (userId, bookId, type) key.
 */
export function deduplicate(operations: QueueOperation[]): QueueOperation[] {
  const seen = new Map<string, QueueOperation>();
  for (const op of operations) {
    const key = `${op.userId}:${op.bookId}:${op.type}`;
    seen.set(key, op);
  }
  return Array.from(seen.values());
}

/**
 * Flush all queued operations to Firestore.
 * Deduplicates first, then executes in order.
 * Re-enqueues any that fail.
 */
export async function flush(): Promise<{ flushed: number; failed: number }> {
  const all = await dequeue();
  if (all.length === 0) return { flushed: 0, failed: 0 };

  const ops = deduplicate(all);
  let flushed = 0;
  let failed = 0;

  for (const op of ops) {
    try {
      if (op.type === 'WRITE_POSITION') {
        await writePosition(op.userId, op.bookId, op.deviceId, op.payload);
      } else if (op.type === 'WRITE_SYNC_STATE') {
        await writeSyncState(op.userId, op.bookId, op.payload);
      }
      flushed++;
    } catch (err) {
      logger.warn(`offlineQueue flush failed for ${op.type} ${op.bookId}`, err);
      // Re-enqueue failed operation
      await enqueue(op);
      failed++;
    }
  }

  logger.info(`offlineQueue.flush: ${flushed} written, ${failed} re-queued`);
  return { flushed, failed };
}

export async function size(): Promise<number> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return 0;
  return (JSON.parse(raw) as QueueOperation[]).length;
}
