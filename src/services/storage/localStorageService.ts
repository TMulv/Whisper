import { File, Directory, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CACHE_DIR, MAX_CACHE_SIZE_MB } from '@/constants/config';
import { bytesToMB, mbToBytes } from '@/utils/fileUtils';
import { logger } from '@/utils/logger';

export type FileType = 'epub' | 'audio' | 'syncmap' | 'cover' | 'chapters';

const CACHE_META_KEY = '@whisper/cache_meta';

interface CacheMeta {
  [localUri: string]: { bookId: string; type: FileType; lastAccessedAt: number; sizeBytes: number };
}

function getCacheDir(): Directory {
  return new Directory(Paths.document, CACHE_DIR);
}

function buildCacheFile(bookId: string, type: FileType, extension: string): File {
  return new File(getCacheDir(), `${bookId}_${type}.${extension}`);
}

/**
 * Returns the canonical cache URI for a book file. Use this instead of
 * hand-rolled `${Paths.document}whisper/…` templates so every writer and
 * reader agrees on the same path format.
 */
export function buildCachePath(bookId: string, type: FileType, extension: string): string {
  return buildCacheFile(bookId, type, extension).uri;
}

export async function ensureCacheDir(): Promise<void> {
  const dir = getCacheDir();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
}

async function getCacheMeta(): Promise<CacheMeta> {
  const raw = await AsyncStorage.getItem(CACHE_META_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function setCacheMeta(meta: CacheMeta): Promise<void> {
  await AsyncStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
}

export async function cacheFile(
  sourceUri: string,
  bookId: string,
  type: FileType,
  extension: string,
): Promise<string> {
  await ensureCacheDir();
  const destFile = buildCacheFile(bookId, type, extension);

  // Remove stale file from a previous attempt
  if (destFile.exists) {
    destFile.delete();
  }

  // expo-file-system/next File.copy() rejects content:// URIs on Android (SAF).
  // Use the legacy FileSystem.copyAsync which handles both schemes.
  if (sourceUri.startsWith('content://')) {
    await FileSystem.copyAsync({ from: sourceUri, to: destFile.uri });
  } else {
    const sourceFile = new File(sourceUri);
    sourceFile.copy(destFile);
  }

  // Fail loud if the copy silently produced no file. iOS share-sheet Inbox
  // paths have tripped this before — a successful-looking copy() call with
  // no resulting file, which then surfaces much later as "missing EPUB" in
  // the reader. Catching it here pins the blame on the actual failure site.
  const copiedSize = destFile.exists ? destFile.size ?? 0 : -1;
  if (copiedSize <= 0) {
    logger.error('cacheFile: copy produced no file', {
      sourceUri,
      destUri: destFile.uri,
      destExists: destFile.exists,
      copiedSize,
    });
    throw new Error(
      `File copy failed: ${destFile.uri} is empty or missing after copy from ${sourceUri}`,
    );
  }

  const meta = await getCacheMeta();
  meta[destFile.uri] = {
    bookId,
    type,
    lastAccessedAt: Date.now(),
    sizeBytes: copiedSize,
  };
  await setCacheMeta(meta);

  return destFile.uri;
}

export async function getCachedPath(bookId: string, type: FileType, extension: string): Promise<string | null> {
  const file = buildCacheFile(bookId, type, extension);
  if (!file.exists) return null;

  // Update last accessed time
  const meta = await getCacheMeta();
  if (meta[file.uri]) {
    meta[file.uri].lastAccessedAt = Date.now();
    await setCacheMeta(meta);
  }

  return file.uri;
}

export async function evictOldFiles(maxSizeMb: number = MAX_CACHE_SIZE_MB): Promise<void> {
  const meta = await getCacheMeta();
  const entries = Object.entries(meta).sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

  let totalBytes = entries.reduce((sum, [, v]) => sum + v.sizeBytes, 0);
  const maxBytes = mbToBytes(maxSizeMb);

  for (const [uri, info] of entries) {
    if (totalBytes <= maxBytes) break;
    try {
      const file = new File(uri);
      file.delete();
      totalBytes -= info.sizeBytes;
      delete meta[uri];
      logger.debug(`Evicted cache file: ${uri}`);
    } catch (err) {
      logger.warn(`Failed to evict ${uri}`, err);
    }
  }

  await setCacheMeta(meta);
}

export async function readTextFromCache(
  bookId: string,
  type: FileType,
  extension: string,
): Promise<string | null> {
  const file = buildCacheFile(bookId, type, extension);
  if (!file.exists) return null;
  try {
    return await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.UTF8 });
  } catch {
    return null;
  }
}

export async function writeTextToCache(
  text: string,
  bookId: string,
  type: FileType,
  extension: string,
): Promise<string> {
  await ensureCacheDir();
  const file = buildCacheFile(bookId, type, extension);
  await FileSystem.writeAsStringAsync(file.uri, text, { encoding: FileSystem.EncodingType.UTF8 });

  const meta = await getCacheMeta();
  meta[file.uri] = {
    bookId,
    type,
    lastAccessedAt: Date.now(),
    sizeBytes: text.length,
  };
  await setCacheMeta(meta);

  return file.uri;
}

export async function getStorageStats(): Promise<{ totalMb: number; fileCount: number }> {
  const meta = await getCacheMeta();
  const entries = Object.values(meta);
  const totalBytes = entries.reduce((sum, v) => sum + v.sizeBytes, 0);
  return { totalMb: bytesToMB(totalBytes), fileCount: entries.length };
}

export async function deleteCachedFile(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (err) {
    logger.warn(`Failed to delete ${uri}`, err);
  }
  const meta = await getCacheMeta();
  if (meta[uri]) {
    delete meta[uri];
    await setCacheMeta(meta);
  }
}

/**
 * Deletes every cached file associated with a given bookId (as recorded in
 * cache meta). Used to tidy up after an abandoned import session so files
 * picked but never saved to a Book don't linger on disk.
 */
export async function deleteCacheFilesForBookId(bookId: string): Promise<void> {
  const meta = await getCacheMeta();
  const uris = Object.entries(meta)
    .filter(([, info]) => info.bookId === bookId)
    .map(([uri]) => uri);
  await Promise.all(uris.map((uri) => deleteCachedFile(uri)));
}

/**
 * Deletes cached files that aren't referenced by any active book. Caller
 * supplies the set of URIs still in use (epubPath, audioPath, syncMapPath
 * from every stored book). Walks both the cache meta and the cache
 * directory so entries missing from either source still get cleaned up.
 * Returns the number of files deleted and the freed space in MB.
 */
export async function cleanupOrphanedFiles(
  referencedUris: Iterable<string>,
): Promise<{ deletedCount: number; freedMb: number }> {
  const refSet = new Set(referencedUris);
  const meta = await getCacheMeta();
  const candidates = new Map<string, number>();
  for (const [uri, info] of Object.entries(meta)) {
    if (!refSet.has(uri)) candidates.set(uri, info.sizeBytes);
  }
  try {
    const dir = getCacheDir();
    if (dir.exists) {
      for (const entry of dir.list()) {
        if (!(entry instanceof File)) continue;
        if (refSet.has(entry.uri) || candidates.has(entry.uri)) continue;
        candidates.set(entry.uri, entry.size ?? 0);
      }
    }
  } catch (err) {
    logger.warn('cleanupOrphanedFiles: dir scan failed', err);
  }

  let freedBytes = 0;
  for (const [uri, size] of candidates) {
    await deleteCachedFile(uri);
    freedBytes += size;
  }
  return { deletedCount: candidates.size, freedMb: bytesToMB(freedBytes) };
}
