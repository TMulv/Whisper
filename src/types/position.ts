export interface EpubPosition {
  chapterIndex: number;
  cfi: string;
  charOffset: number;
  percentComplete: number;
}

export interface AudioPosition {
  chapterIndex: number;
  timestampSeconds: number;
  percentComplete: number;
}

export interface SyncedPosition {
  bookId: string;
  deviceId: string;
  chapterIndex: number;
  epubCfi: string;
  charOffset: number;
  audioTimestamp: number;
  percentComplete: number;
  source: 'epub' | 'audio';
  updatedAt: number;
}

export interface PositionConflict {
  local: SyncedPosition;
  remote: SyncedPosition;
  resolution: 'local' | 'remote' | 'prompt';
}
