# Incoming-file bookId drift — design

**Date:** 2026-04-21
**Scope:** Fix "missing EPUB" error after adding a book via iOS share-sheet / drag-and-drop.

## Problem

When a user drops an EPUB and an audio file into the app (in any order, via share-sheet or simulator drag-and-drop) and confirms the add, opening the Reader sometimes shows:

> This book is missing its EPUB file and has been removed from your library. Please re-add it.

Diagnostic logging confirmed the symptom: the book's cache dir contains the audio file named `{bookId}_audio.m4b` but no `{bookId}_epub.epub`. The EPUB was cached under a **different** bookId from the one saved as the book's identifier.

## Root cause

Two independent bugs compound:

### 1. `pendingBookId` drifts mid-session

`LibraryScreen` regenerates `pendingBookId` in three places:

1. Initial `useState(() => Crypto.randomUUID())` at mount.
2. `handleOpenModal` — when the user taps "+".
3. `handleIncomingFile` — on every incoming file drop.

When more than one of these fires inside a single "add book" session, the two files end up cached under different bookIds, but only one of those IDs is saved as the book's identifier.

Triggering scenarios:

- Tap "+", pick one file inside the modal, then drop the other via share-sheet (drop regenerates `pendingBookId` mid-session).
- Drop one file, then drop a second file (second drop regenerates).
- Drop a file while the modal is already open from a prior "+" tap.

### 2. Reader ignores `book.epubPath`

`ReaderScreen` resolves the EPUB via `getCachedPath(params.bookId, 'epub', 'epub')`, which reconstructs the path `{bookId}_epub.epub`. It never reads `book.epubPath` from the saved metadata. So even when the metadata correctly points at the actual cached file, the reader misses it.

The audio-detection effect in the same file has the same bug (reconstructs from `bookId` + extracted extension, ignores `book.audioPath`).

## Fix — two independent layers

### Layer 1 — session bookId (LibraryScreen)

One bookId per "add book" session. The session opens on the first action (modal open or first incoming drop) and ends on successful confirm or modal dismissal.

**Changes to `src/screens/library/LibraryScreen.tsx`:**

- Add `sessionBookIdRef: useRef<string | null>(null)` — the source of truth for the active session's bookId.
- Add helpers:
  - `startOrReuseSession(): string` — if the ref is null, generate a UUID, store it in the ref, and mirror it to `setPendingBookId`. Returns the ref's current value.
  - `endSession(): void` — clears the ref. (Leaves `pendingBookId` as-is; it's only read via `startOrReuseSession` going forward, so the stale state value doesn't matter.)
- Rewire callers:
  - `handleOpenModal` calls `startOrReuseSession()` before `setModalVisible(true)` (replaces `setPendingBookId(Crypto.randomUUID())`).
  - `handleIncomingFile` uses `const bookId = startOrReuseSession()` in place of `const bookId = Crypto.randomUUID(); setPendingBookId(bookId);`.
  - `handlePickEpub` / `handlePickAudio` read from `startOrReuseSession()` instead of closing over `pendingBookId`. Removes `pendingBookId` from their dep arrays.
  - `handleConfirm` reads `sessionBookIdRef.current` (falling back to `pendingBookId` only if the ref is somehow null), calls `endSession()` after successful save.
  - Modal `onClose` prop calls `endSession()` alongside `setModalVisible(false)` and `setPreselectedIncoming(null)`.

### Layer 2 — reader uses saved paths (ReaderScreen)

**Changes to `src/screens/reader/ReaderScreen.tsx`:**

- EPUB-load effect (currently around line 215): replace `const epubUri = await getCachedPath(params.bookId, 'epub', 'epub')` with:
  - Read the book's metadata via `localListBooks`.
  - If `book.epubPath` exists and `new File(book.epubPath)` reports `exists && size > 0`, use that path directly.
  - Otherwise, fall back to the existing `getCachedPath(params.bookId, 'epub', 'epub')` reconstruction (preserves backward compat for any pre-fix books whose paths happen to match the canonical convention).
- Audio-detection effect (currently around line 200): same pattern — prefer `book.audioPath` after a file-existence check, fall back to reconstruction.
- Self-heal delete stays disabled (already removed in the diagnostic patch). The "missing EPUB" error keeps its diagnostic payload (bookId, expected filename, cache dir listing) but never deletes the book. `BookDetail`'s manual delete handles genuinely broken books.

## Data flow (fixed)

1. User drops a file OR taps "+".
2. `startOrReuseSession()` returns bookId `X` (new UUID on first call; same `X` on all subsequent calls in this session).
3. Any file cached via `cacheFile` (whether from incoming drop or inside-modal picker) uses bookId `X`. All cache paths are `{X}_epub.epub` / `{X}_audio.m4b`.
4. `handleConfirm` writes the book with `id = X`, `epubPath = {X}_epub.epub`, `audioPath = {X}_audio.m4b`. Calls `endSession()`.
5. Reader reads `book.epubPath` directly, finds the file, loads successfully.

## Edge cases

- **Modal dismissed without confirm, then reopened:** `endSession` cleared the ref; next open generates a fresh UUID. Aborted-session cache files are orphaned until `evictOldFiles` reclaims them on next cache pressure. Acceptable — no correctness impact.
- **Two drops in rapid succession:** both reuse the same session bookId. Modal's `initialSelection` only fills the slot matching the *latest* drop; if the first drop had already been selected into a slot in the modal's local state, it stays. Acceptable.
- **Pre-fix books already in the library:** reader's fallback to `getCachedPath` covers any whose paths happen to match the old convention. Any that don't will show the diagnostic error message (cache dir listing) and require manual re-add; the self-heal won't silently delete them.
- **Session bookId survives across component remounts:** refs are per-instance. If `LibraryScreen` unmounts (e.g., user navigates away mid-session), the ref is lost. This is the same as the current behavior — if the user navigates away before confirming, the session is abandoned.

## Testing (manual, iOS simulator)

1. Drop EPUB, pick audio via modal, confirm → open reader → ✓
2. Drop audio, pick EPUB via modal, confirm → open reader → ✓
3. Tap "+", pick EPUB inside modal, drop audio externally → confirm → open reader → ✓ (previously broken)
4. Drop EPUB, drop a second EPUB (replaces), pick audio, confirm → open reader → ✓
5. Drop EPUB, dismiss modal (cancel), tap "+", start over → confirm → ✓ (no bookId leak)

No new unit tests. The logic is React state choreography around iOS share-sheet behavior; the manual flow is the actual test surface.

## Out of scope

- Cleanup of orphaned cache files from aborted sessions (existing `evictOldFiles` handles via LRU).
- Migrating pre-fix books whose paths don't match the canonical convention (they'll surface via the diagnostic error; user re-adds manually).
- Refactoring `pendingBookId` state away entirely — it stays as a convenience mirror for any consumer that still reads it; the ref is the source of truth going forward.
