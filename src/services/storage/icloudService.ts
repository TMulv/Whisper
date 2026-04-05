import { Platform } from 'react-native';
import { File, Directory } from 'expo-file-system';
import { logger } from '@/utils/logger';

// iCloud Drive is only accessible on iOS
function assertIOS(): void {
  if (Platform.OS !== 'ios') {
    throw new Error('iCloud is only available on iOS');
  }
}

export function listICloudDocuments(subPath: string = ''): string[] {
  if (Platform.OS !== 'ios') return [];

  try {
    const icloudBase = 'file:///private/var/mobile/Library/Mobile Documents/';
    const dir = new Directory(icloudBase + (subPath || ''));
    return dir.list().map((item) => item.uri);
  } catch (err) {
    logger.warn('listICloudDocuments failed', err);
    return [];
  }
}

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

export function isAvailable(): boolean {
  return Platform.OS === 'ios';
}
