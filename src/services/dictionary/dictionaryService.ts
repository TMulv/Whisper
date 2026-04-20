import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/utils/logger';
import { COMMON_WORDS } from './commonWords';

export interface DictionaryDefinition {
  partOfSpeech: string;
  definition: string;
  example?: string;
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  definitions: DictionaryDefinition[];
}

export type LookupSource = 'cache' | 'network' | 'none';

export interface LookupResult {
  entry: DictionaryEntry | null;
  source: LookupSource;
}

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const CACHE_PREFIX = '@whisper/dict/';
const CACHE_INDEX_KEY = '@whisper/dict/_index';
const OFFLINE_ONLY_KEY = '@whisper/dict/offline_only';

function keyFor(word: string): string {
  return CACHE_PREFIX + word.trim().toLowerCase();
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(words: string[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(words));
}

async function cacheEntry(entry: DictionaryEntry): Promise<void> {
  const word = entry.word.trim().toLowerCase();
  if (!word) return;
  await AsyncStorage.setItem(keyFor(word), JSON.stringify(entry));
  const idx = await readIndex();
  if (!idx.includes(word)) {
    idx.push(word);
    await writeIndex(idx);
  }
}

async function readCached(word: string): Promise<DictionaryEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(word));
    if (!raw) return null;
    return JSON.parse(raw) as DictionaryEntry;
  } catch {
    return null;
  }
}

async function fetchFromNetwork(word: string): Promise<DictionaryEntry | null> {
  try {
    const res = await fetch(API + encodeURIComponent(word));
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{
      word: string;
      phonetic?: string;
      phonetics?: Array<{ text?: string }>;
      meanings: Array<{
        partOfSpeech: string;
        definitions: Array<{ definition: string; example?: string }>;
      }>;
    }>;
    if (!Array.isArray(json) || !json.length) return null;
    const first = json[0];
    const phonetic =
      first.phonetic ?? first.phonetics?.find((p) => p.text)?.text ?? undefined;
    const definitions: DictionaryDefinition[] = [];
    for (const m of first.meanings ?? []) {
      for (const d of m.definitions ?? []) {
        definitions.push({
          partOfSpeech: m.partOfSpeech,
          definition: d.definition,
          example: d.example,
        });
        if (definitions.length >= 5) break;
      }
      if (definitions.length >= 5) break;
    }
    return { word: first.word, phonetic, definitions };
  } catch (err) {
    logger.warn('dictionary network lookup failed', { word, err });
    return null;
  }
}

export async function lookupWord(
  word: string,
  options: { offlineOnly?: boolean } = {},
): Promise<LookupResult> {
  const clean = word.trim().toLowerCase();
  if (!clean) return { entry: null, source: 'none' };

  const cached = await readCached(clean);
  if (cached) return { entry: cached, source: 'cache' };

  const offlineOnly =
    options.offlineOnly ?? (await getOfflineOnly());
  if (offlineOnly) return { entry: null, source: 'none' };

  const net = await fetchFromNetwork(clean);
  if (net) {
    await cacheEntry(net).catch(() => {});
    return { entry: net, source: 'network' };
  }
  return { entry: null, source: 'none' };
}

export async function getOfflineOnly(): Promise<boolean> {
  const v = await AsyncStorage.getItem(OFFLINE_ONLY_KEY);
  return v === 'true';
}

export async function setOfflineOnly(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_ONLY_KEY, enabled ? 'true' : 'false');
}

export async function getCachedCount(): Promise<number> {
  const idx = await readIndex();
  return idx.length;
}

export async function clearCache(): Promise<void> {
  const idx = await readIndex();
  const keys = idx.map(keyFor);
  if (keys.length) await AsyncStorage.multiRemove(keys);
  await AsyncStorage.removeItem(CACHE_INDEX_KEY);
}

export interface PreloadProgress {
  completed: number;
  total: number;
  cached: number;
  failed: number;
}

export async function preloadCommonWords(
  onProgress?: (p: PreloadProgress) => void,
  signal?: { cancelled: boolean },
): Promise<PreloadProgress> {
  const existing = new Set(await readIndex());
  const queue = COMMON_WORDS.filter((w) => !existing.has(w.toLowerCase()));
  const total = queue.length;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    if (signal?.cancelled) break;
    const w = queue[i];
    const entry = await fetchFromNetwork(w);
    if (entry) {
      await cacheEntry(entry).catch(() => {});
      cached++;
    } else {
      failed++;
    }
    onProgress?.({ completed: i + 1, total, cached, failed });
  }

  return { completed: total, total, cached, failed };
}
