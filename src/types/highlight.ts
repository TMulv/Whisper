export interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
  chapterIndex: number;
  createdAt: number;
  note?: string;
}

export const HIGHLIGHT_COLORS = [
  { key: 'yellow', hex: '#FFD700' },
  { key: 'green',  hex: '#90EE90' },
  { key: 'blue',   hex: '#87CEEB' },
  { key: 'pink',   hex: '#FFB6C1' },
  { key: 'orange', hex: '#FFA07A' },
] as const;

export type HighlightColorKey = (typeof HIGHLIGHT_COLORS)[number]['key'];
