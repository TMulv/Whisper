export function getFileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function getFileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function isEpub(path: string): boolean {
  return getFileExtension(path) === 'epub';
}

export function isAudio(path: string): boolean {
  const ext = getFileExtension(path);
  return ['mp3', 'm4b', 'm4a', 'aac', 'ogg', 'flac'].includes(ext);
}

export function isM4B(path: string): boolean {
  return getFileExtension(path) === 'm4b';
}

export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}
