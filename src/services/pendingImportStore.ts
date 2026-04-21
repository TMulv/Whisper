/**
 * Module-level store for a file that arrived via iOS "Open with" / share sheet
 * before the Library screen was ready to handle it (e.g. during cold start or
 * before the user has logged in).
 *
 * The store is write-once / read-once: `takePendingImport` clears the value so
 * duplicate processing can't happen if LibraryScreen re-mounts.
 */

export interface PendingImportFile {
  /** file:// URI delivered by iOS */
  uri: string;
  /** Original filename including extension */
  name: string;
  kind: 'audio' | 'epub';
}

let pending: PendingImportFile | null = null;

export function setPendingImport(file: PendingImportFile): void {
  pending = file;
}

/** Consume and return the pending import, or null if none. */
export function takePendingImport(): PendingImportFile | null {
  const f = pending;
  pending = null;
  return f;
}

export function hasPendingImport(): boolean {
  return pending !== null;
}
