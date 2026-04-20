import { Platform } from 'react-native';
import { File, Directory } from 'expo-file-system';
import { logger } from '@/utils/logger';

const ICLOUD_ROOT = 'file:///private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/';
const BOOKS_SUBFOLDER = 'Books';

export interface ICloudEntry {
  type: 'file' | 'folder';
  name: string;
  uri: string;
}

export function isAvailable(): boolean {
  return Platform.OS === 'ios';
}

function assertIOS(): void {
  if (Platform.OS !== 'ios') throw new Error('iCloud is only available on iOS');
}

/**
 * List entries inside an iCloud Drive subfolder.
 * Defaults to the iCloud Drive root.
 */
export function listICloudDocuments(subPath: string = ''): ICloudEntry[] {
  if (Platform.OS !== 'ios') return [];

  try {
    const dirUri = ICLOUD_ROOT + (subPath ? subPath.replace(/^\//, '') : '');
    const dir = new Directory(dirUri);
    return dir.list().map((item) => {
      const name = item.uri.replace(/\/$/, '').split('/').pop() ?? '';
      const isDir = item.uri.endsWith('/');
      return { type: isDir ? 'folder' : 'file', name, uri: item.uri };
    });
  } catch (err) {
    logger.warn('listICloudDocuments failed', err);
    return [];
  }
}

/**
 * List all book folders in iCloud Drive / Books /
 */
export function listICloudBooks(): ICloudEntry[] {
  return listICloudDocuments(BOOKS_SUBFOLDER).filter((e) => e.type === 'folder');
}

/**
 * List files inside a specific iCloud book folder.
 */
export function listICloudBookFiles(folderUri: string): ICloudEntry[] {
  if (Platform.OS !== 'ios') return [];

  try {
    const dir = new Directory(folderUri);
    return dir.list()
      .map((item) => {
        const name = item.uri.replace(/\/$/, '').split('/').pop() ?? '';
        const isDir = item.uri.endsWith('/');
        return { type: isDir ? 'folder' : 'file', name, uri: item.uri } as ICloudEntry;
      })
      .filter((e) => e.type === 'file');
  } catch (err) {
    logger.warn('listICloudBookFiles failed', err);
    return [];
  }
}

/**
 * Copy an iCloud Drive file to a local cache URI.
 */
export function copyFromICloud(icloudUri: string, localUri: string): void {
  assertIOS();
  try {
    const source = new File(icloudUri);
    const dest = new File(localUri);
    source.copy(dest);
  } catch (err) {
    logger.error('copyFromICloud failed', err);
    throw err;
  }
}

/** @deprecated Use copyFromICloud */
export function downloadFromICloud(icloudPath: string, localPath: string): void {
  assertIOS();
  try {
    const source = new File(icloudPath);
    const dest = new File(localPath);
    source.move(dest);
  } catch (err) {
    logger.error('downloadFromICloud failed', err);
    throw err;
  }
}
