import { SyncMode } from './book';

export interface ChapterMapping {
  chapterIndex: number;
  epubSpineIndex: number;
  epubCfiBase: string;
  audioStartSeconds: number;
  audioEndSeconds: number;
  percentStart: number;
  percentEnd: number;
}

export interface AeneasFragment {
  id: string;
  begin: string;
  end: string;
  language: string;
  lines: string[];
  children: AeneasFragment[];
}

export interface AeneasSyncMap {
  fragments: AeneasFragment[];
}

export interface BookSyncMap {
  bookId: string;
  mode: SyncMode;
  chapters: ChapterMapping[];
  aeneas: AeneasSyncMap | null;
}

export interface M4BChapter {
  index: number;
  title: string;
  startSeconds: number;
  endSeconds: number;
}
