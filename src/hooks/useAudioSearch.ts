import { useState, useEffect, useCallback, useRef } from 'react';
import { loadCachedAssemblyAiWords } from '@/services/sync/assemblyAiAdapter';
import {
  buildSearchIndex,
  searchAudio,
  AudioSearchIndex,
  AudioSearchResult,
} from '@/services/audio/audioSearch';
import { M4BChapter } from '@/types/sync';

export type SearchReadiness = 'loading' | 'ready' | 'unavailable';

export interface ChapterResult {
  startSeconds: number;
  label: string;
}

export interface UseAudioSearchReturn {
  readiness: SearchReadiness;
  search: (query: string) => AudioSearchResult[];
  searchChapters: (query: string) => ChapterResult[];
}

// Module-level cache so the index survives modal open/close cycles.
const indexCache = new Map<string, AudioSearchIndex>();

export function useAudioSearch(
  audioPath: string | null,
  chapters: M4BChapter[],
): UseAudioSearchReturn {
  const [readiness, setReadiness] = useState<SearchReadiness>('loading');
  const indexRef = useRef<AudioSearchIndex | null>(null);

  useEffect(() => {
    if (!audioPath) {
      setReadiness('unavailable');
      return;
    }

    const cached = indexCache.get(audioPath);
    if (cached) {
      indexRef.current = cached;
      setReadiness('ready');
      return;
    }

    setReadiness('loading');
    loadCachedAssemblyAiWords(audioPath).then((words) => {
      if (words && words.length > 0) {
        const idx = buildSearchIndex(words);
        indexCache.set(audioPath, idx);
        indexRef.current = idx;
        setReadiness('ready');
      } else {
        setReadiness('unavailable');
      }
    });
  }, [audioPath]);

  const search = useCallback(
    (query: string): AudioSearchResult[] => {
      if (!indexRef.current || query.trim().length < 2) return [];
      return searchAudio(indexRef.current, query);
    },
    // readiness as dep ensures the callback is stable once the index is built
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readiness],
  );

  const searchChapters = useCallback(
    (query: string): ChapterResult[] => {
      const q = query.toLowerCase().trim();
      if (q.length === 0) return [];
      return chapters
        .filter((ch) => ch.title.toLowerCase().includes(q))
        .map((ch) => ({ startSeconds: ch.startSeconds, label: ch.title }));
    },
    [chapters],
  );

  return { readiness, search, searchChapters };
}
