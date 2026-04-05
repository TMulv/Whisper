import AsyncStorage from '@react-native-async-storage/async-storage';
import { OFFLINE_QUEUE_KEY } from '@/constants/config';
import { FirestorePosition } from '@/types/firebase';
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
 * Deduplicate: keep only the latest operation per (userId, bookId) key.
 */
export function deduplicate(operations: QueueOperation[]): QueueOperation[] {
  const seen = new Map<string, QueueOperation>();
  for (const op of operations) {
    const key = `${op.userId}:${op.bookId}:${op.type}`;
    seen.set(key, op);
  }
  return Array.from(seen.values());
}
