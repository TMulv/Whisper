export interface EpubPosition {
  chapterIndex: number;
  cfi: string;
  charOffset: number;
  /** Progress within the current chapter [0, 1], computed from page/total.
   * -1 means no data available (e.g., pre-render, or layout not paginated yet). */
  chapterFraction: number;
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
