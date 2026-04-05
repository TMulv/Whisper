import { AeneasSyncMap, AeneasFragment } from '@/types/sync';
import { parseAeneasTime } from '@/utils/timeUtils';

export function loadSyncMap(json: string): AeneasSyncMap {
  return JSON.parse(json) as AeneasSyncMap;
}

/**
 * Find the Aeneas fragment that contains the given audio timestamp (seconds).
 */
export function audioTimestampToFragment(
  timestampSeconds: number,
  map: AeneasSyncMap,
): AeneasFragment | null {
  for (const fragment of map.fragments) {
    const begin = parseAeneasTime(fragment.begin);
    const end = parseAeneasTime(fragment.end);
    if (timestampSeconds >= begin && timestampSeconds < end) {
      return fragment;
    }
  }
  return map.fragments[map.fragments.length - 1] ?? null;
}

/**
 * Find the audio timestamp for a given fragment id.
 */
export function fragmentIdToTimestamp(
  fragmentId: string,
  map: AeneasSyncMap,
): number {
  const fragment = map.fragments.find((f) => f.id === fragmentId);
  return fragment ? parseAeneasTime(fragment.begin) : 0;
}

/**
 * Search fragments by text content to find the closest matching fragment.
 * Returns the fragment whose lines best match the given text snippet.
 */
export function textToFragment(
  text: string,
  map: AeneasSyncMap,
): AeneasFragment | null {
  const normalizedQuery = text.toLowerCase().trim();
  let bestMatch: AeneasFragment | null = null;
  let bestScore = 0;

  for (const fragment of map.fragments) {
    const fragmentText = fragment.lines.join(' ').toLowerCase();
    if (fragmentText.includes(normalizedQuery)) {
      const score = normalizedQuery.length / fragmentText.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = fragment;
      }
    }
  }

  return bestMatch;
}
