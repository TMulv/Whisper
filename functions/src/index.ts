/**
 * Alignment-job dispatcher.
 *
 * Triggered when a new doc lands in `/alignmentJobs/{jobId}`. The Function's
 * only job is to forward the spec to the Cloud Run worker with an
 * authenticated POST — the worker does the real work and writes progress back
 * to Firestore for the app to observe.
 *
 * Quota enforcement lives here (not in the worker) so abusive clients can't
 * burn through a user's monthly budget by re-enqueuing.
 */

import {
  onDocumentCreated,
  FirestoreEvent,
  QueryDocumentSnapshot,
} from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

initializeApp();
const db = getFirestore();

const WORKER_URL = process.env.WORKER_URL; // set via `firebase functions:config`
const MONTHLY_JOB_CAP = Number(process.env.MONTHLY_JOB_CAP ?? 10);

async function currentMonthJobCount(userId: string): Promise<number> {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const snap = await db
    .collection('alignmentJobs')
    .where('userId', '==', userId)
    .where('createdAt', '>=', since.getTime())
    .count()
    .get();
  return snap.data().count;
}

export const dispatchAlignmentJob = onDocumentCreated(
  'alignmentJobs/{jobId}',
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined>) => {
    const snap = event.data;
    if (!snap) return;

    const job = snap.data();
    const jobId = event.params.jobId;
    logger.info('dispatch job', { jobId, userId: job.userId, bookId: job.bookId });

    if (!WORKER_URL) {
      await snap.ref.set({ status: 'failed', error: 'WORKER_URL not configured' }, { merge: true });
      return;
    }

    // Quota check — don't charge the budget until the job is actually running.
    const monthlyCount = await currentMonthJobCount(job.userId);
    if (monthlyCount > MONTHLY_JOB_CAP) {
      await snap.ref.set(
        { status: 'quota-exceeded', failedAt: Date.now() },
        { merge: true },
      );
      return;
    }

    try {
      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(WORKER_URL);
      const response = await client.request({
        url: WORKER_URL,
        method: 'POST',
        data: { ...job, jobId },
        timeout: 10_000,
      });
      logger.info('worker accepted', { jobId, status: response.status });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('dispatch failed', { jobId, error: message });
      await snap.ref.set(
        { status: 'failed', error: message, failedAt: Date.now() },
        { merge: true },
      );
    }
  },
);
