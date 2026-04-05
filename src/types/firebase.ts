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
