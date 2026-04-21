export type SyncMode = 'chapter' | 'percentage';
export type StorageProvider = 'googledrive' | 'nextcloud' | 'icloud' | 'local';

export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  coverUri: string | null;
  epubPath: string;
  audioPath: string;
  syncMapPath: string | null;
  storageProvider: StorageProvider;
  syncMode: SyncMode;
  totalChapters: number;
  totalDurationSeconds: number;
  addedAt: number;
  updatedAt: number;
}

export interface LocalBook extends BookMetadata {
  localEpubUri: string | null;
  localAudioUri: string | null;
  isDownloaded: boolean;
  downloadProgress: number;
}
