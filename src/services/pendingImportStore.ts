/**
 * Module-level store for a file that arrived via iOS "Open with" / share sheet.
 *
 * The store is write-once / read-once: `takePendingImport` clears the value so
 * duplicate processing can't happen if LibraryScreen re-mounts. Subscribers
 * are notified when a file is set so an already-mounted LibraryScreen picks it
 * up immediately without waiting for a focus event.
 */

export interface PendingImportFile {
  /** file:// URI delivered by iOS */
  uri: string;
  /** Original filename including extension */
  name: string;
  kind: 'audio' | 'epub';
}

let pending: PendingImportFile | null = null;
const listeners = new Set<(file: PendingImportFile) => void>();

export function setPendingImport(file: PendingImportFile): void {
  pending = file;
  // Snapshot so a listener mutating the store mid-notify doesn't skip others.
  for (const l of Array.from(listeners)) {
    try {
      l(file);
    } catch {
      /* ignore listener errors */
    }
  }
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

/** Subscribe to newly-set imports. Returns an unsubscribe function. */
export function subscribeToPendingImport(
  listener: (file: PendingImportFile) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
