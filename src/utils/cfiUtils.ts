/**
 * Utilities for working with EPUB CFI (Canonical Fragment Identifier) strings.
 * CFI format: epubcfi(/6/4[chap01]!/4/2/1:0)
 */

/**
 * Extract the spine item index from a CFI string.
 * The spine index is the number at /6/N where N is the step number.
 */
export function getSpineIndexFromCfi(cfi: string): number {
  const match = cfi.match(/epubcfi\(\/6\/(\d+)/);
  if (match) {
    // CFI steps are 2-based for spine items (step 2 = index 0, step 4 = index 1, etc.)
    return (parseInt(match[1], 10) - 2) / 2;
  }
  return 0;
}

/**
 * Extract the character offset from a CFI string.
 * The char offset appears after the last colon: "...1:42" → 42
 */
export function getCharOffsetFromCfi(cfi: string): number {
  const match = cfi.match(/:(\d+)\)$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

/**
 * Build a base CFI for a spine item (chapter start).
 * spineIndex 0 → epubcfi(/6/2)
 */
export function buildChapterBaseCfi(spineIndex: number): string {
  const step = (spineIndex + 1) * 2;
  return `epubcfi(/6/${step})`;
}

/**
 * Compare two CFI strings. Returns negative if a < b, 0 if equal, positive if a > b.
 * Simplified: compare spine index first, then char offset.
 */
export function compareCfi(a: string, b: string): number {
  const aSpine = getSpineIndexFromCfi(a);
  const bSpine = getSpineIndexFromCfi(b);
  if (aSpine !== bSpine) return aSpine - bSpine;
  return getCharOffsetFromCfi(a) - getCharOffsetFromCfi(b);
}

export function isValidCfi(cfi: string): boolean {
  return cfi.startsWith('epubcfi(') && cfi.endsWith(')');
}
