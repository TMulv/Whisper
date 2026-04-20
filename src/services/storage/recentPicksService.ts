import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import { CACHE_DIR } from '@/constants/config';

const RECENTS_KEY = '@whisper/recent_picks';
const MAX_RECENTS = 20;

export type PickKind = 'epub' | 'audio' | 'other';

export interface RecentPick {
  uri: string;
  name: string;
  kind: PickKind;
  sizeBytes: number;
  pickedAt: number;
}

export interface CachedFile {
  uri: string;
  name: string;
  kind: PickKind;
  sizeBytes: number;
  modifiedAt: number;
}

const AUDIO_EXT = /\.(m4b|mp3|m4a|aac|ogg|flac|opus|wav)$/i;
const EPUB_EXT = /\.epub$/i;

export function classifyName(name: string): PickKind {
  if (EPUB_EXT.test(name)) return 'epub';
  if (AUDIO_EXT.test(name)) return 'audio';
  return 'other';
}

export async function getRecentPicks(): Promise<RecentPick[]> {
  const raw = await AsyncStorage.getItem(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentPick[];
    return parsed
      .filter((p) => {
        try {
          return new File(p.uri).exists;
        } catch {
          return false;
        }
      })
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export async function addRecentPick(pick: Omit<RecentPick, 'pickedAt'>): Promise<void> {
  const current = await getRecentPicks();
  const deduped = current.filter((p) => p.uri !== pick.uri);
  deduped.unshift({ ...pick, pickedAt: Date.now() });
  const trimmed = deduped.slice(0, MAX_RECENTS);
  await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
}

export async function clearRecentPicks(): Promise<void> {
  await AsyncStorage.removeItem(RECENTS_KEY);
}

export function listCachedFiles(): CachedFile[] {
  try {
    const dir = new Directory(Paths.cache, CACHE_DIR);
    if (!dir.exists) return [];
    const entries = dir.list();
    const files: CachedFile[] = [];
    for (const entry of entries) {
      if (!(entry instanceof File)) continue;
      const name = entry.uri.split('/').pop() ?? '';
      const kind = classifyName(name);
      if (kind === 'other') continue;
      files.push({
        uri: entry.uri,
        name,
        kind,
        sizeBytes: entry.size ?? 0,
        modifiedAt: entry.modificationTime ? entry.modificationTime * 1000 : Date.now(),
      });
    }
    return files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    return [];
  }
}
