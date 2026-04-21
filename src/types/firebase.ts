import { SyncMode } from './book';

export interface FirestoreBook {
  title: string;
  author: string;
  coverUrl: string;
  epubPath: string;
  audioPath: string;
  syncMapPath: string | null;
  totalChapters: number;
  totalDurationSeconds: number;
  syncMode: SyncMode;
  addedAt: number;
  updatedAt: number;
}

export interface FirestorePosition {
  chapterIndex: number;
  epubCfi: string;
  charOffset: number;
  audioTimestamp: number;
  percentComplete: number;
  source: 'epub' | 'audio';
  deviceId: string;
  updatedAt: number;
}

export interface FirestoreUserSettings {
  defaultSyncMode: SyncMode;
  preferredTheme: 'light' | 'dark' | 'eink';
}

export interface FirestoreUser {
  email: string;
  createdAt: number;
  settings: FirestoreUserSettings;
}

// ── Alignment jobs (cloud worker) ───────────────────────────────────────────
// Written by the app, dispatched by a Firebase Function, processed by the
// Cloud Run worker in cloud/alignment-worker. See that README for the full
// lifecycle — these types are the wire format.

export type AlignmentJobSource = 'dropbox' | 'drive';
export type AlignmentJobStatus =
  | 'pending'         // app just wrote the doc; function hasn't dispatched
  | 'running'         // worker accepted, in progress
  | 'complete'
  | 'failed'
  | 'quota-exceeded';

export interface FirestoreAlignmentJob {
  userId: string;
  bookId: string;
  source: AlignmentJobSource;
  /** Short-lived access token forwarded to the worker — rotated each job. */
  accessToken: string;
  /** Provider-specific file ids. */
  audioFileId: string;
  epubFileId: string;
  status: AlignmentJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  completedChapters?: number;
  error?: string;
}

/**
 * Per-book alignment progress doc, updated as chapters finish. The app
 * subscribes to this to drive the SyncBadge + SyncStatusSheet UI.
 */
export interface FirestoreAlignmentStatus {
  status: 'processing' | 'complete' | 'failed';
  totalChapters: number;
  completedChapters: number;
  completedAt?: number;
  error?: string;
}
