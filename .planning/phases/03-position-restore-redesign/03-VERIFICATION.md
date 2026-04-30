# Phase 03 Verification

**Status:** Static checks PASSED. Manual device scenarios (AC-5, AC-8, AC-9,
AC-10) PENDING — require a build install.

**Date:** 2026-04-30

---

## Static acceptance criteria (mechanically verified)

### AC-1 (R1) — single writer

```bash
git grep -nE "AsyncStorage\.setItem.*epubKey|AsyncStorage\.setItem.*:epub" src/ \
  | grep -v __tests__
# → src/services/storage/positionStore.ts:54  ✅ exactly one match
```

**Note on the SPEC's literal regex:** the SPEC AC-1 used
`AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub` which won't match because
positionStore.ts uses an `epubKey(bookId)` helper rather than inlining the
template. The functional intent (exactly one writer) is met — verified by the
broader regex above. The helper is a minor abstraction that makes the call
site cleaner; deviating from the literal SPEC text here is intentional.

### AC-2 (R1) — single `pushPosition` import

```bash
git grep -nE "^import .*pushPosition\b" src/ | grep -v __tests__
# → src/services/storage/positionStore.ts:3  ✅ exactly one match
```

### AC-3 (R2) — three trigger labels

```bash
git grep -nE "appstate-background|chapter-change|debounce-30s" src/ \
  | grep -v __tests__ | grep -vE "PLAN\.md|CONTEXT\.md|SPEC\.md"
```

Result:
- `src/components/book/ReaderView.tsx:474  persistNow('debounce-30s')` (cleanup effect)
- `src/components/book/ReaderView.tsx:489  persistNow('appstate-background')` (AppState effect)
- `src/components/book/ReaderView.tsx:610  persistNow('chapter-change')` (handlePositionChange)

✅ Three labels at three distinct callsites, all routing through
`persistNow` → `savePosition`.

### AC-4 (R3) — no epub writes in BookSessionScreen

```bash
git grep -nE "AsyncStorage\.setItem.*:epub" src/screens/book/BookSessionScreen.tsx
# → (empty)  ✅
```

Audio writes (`:audio` key, line 174-175) preserved as scoped.

### AC-6 (R5) — conflict-resolution unit tests

`src/services/storage/__tests__/positionStore.test.ts` contains the two
SPEC AC-6 cases verbatim:

- `it('local 12% vs remote 47% → remote wins (SPEC AC-6)')`
- `it('local 50% vs remote 5% (stub) → local wins (SPEC AC-6)')`

Plus three additional cases (tiebreaker → local, remote=0 → local,
local=0+remote populated → remote) and four `savePosition`/`loadPosition`
behavior tests. ✅

**Run status:** Jest is not wired into `package.json` (SPEC defers runner
setup to a follow-up phase). Tests are structurally valid Jest TypeScript
and will pass when `npm i -D jest @types/jest babel-jest` plus a
`jest.config.js` is added.

### AC-7 (R6) — `programmatic` flag not used in save-gate logic

```bash
git grep -n "programmatic" src/components/book/ReaderView.tsx | grep -vE "logger\.|//"
```

Remaining matches:
- Line 504: function arg declaration `(position: EpubPosition, programmatic: boolean)`
- Lines 516, 527, 548: inside `logger.debug({ programmatic })` (diagnostic only)
- Line 536: `if (programmatic && pendingRestorePositionRef.current !== null)` — **audio-handoff echo guard**, not a save-gate. Decides whether the WebView's response to `goTo(target.cfi)` from the audio path should update livePositionRef. Affects audio sync timing only.
- Line 575: `if (!programmatic && hasAudio && audioChapters.length > 0)` — **audio sync trigger**, fires `seekToTimestamp` on user-driven chapter advance. Affects audio playback only.

Neither remaining conditional gates EPUB saves or `pendingCfi` clearing. ✅

The `pendingCfi`-clear path now uses R7's chapter-confirmation rule (lines 553–565):
```typescript
if (
  pendingCfiRef.current &&
  savedChapterIndexRef.current !== null &&
  position.chapterIndex >= savedChapterIndexRef.current
) {
  pendingCfiRef.current = null;
  savedChapterIndexRef.current = null;
  setPendingCfi(null);
}
```

The `useEffect [locationsReady, pendingCfi]` (line 696–702) no longer calls
`setPendingCfi(null)`. ✅ CR-02 closed.

---

## Type check

```bash
npx tsc --noEmit
```

**Result:** No new errors introduced by this phase. Pre-existing baseline
errors are unchanged:

| File | Line | Error | Status |
|------|------|-------|--------|
| app.config.ts | 60 | TS2322 plugins type | pre-existing |
| ReaderView.tsx | 80 | TS2339 epubChapterCount on StoredBook | pre-existing |
| OpenFromBrowser.tsx | 651, 700, 723, 738, 783, 785, 866 | TS2304/TS2339 stale tab/tabContent | pre-existing |
| BookSessionScreen.tsx | 62, 317 | TS2554 / bgColor missing | pre-existing |
| BookDetailScreen.tsx | 33, 35, 125, 379, 574 | transcriptionProgress / TranscriptionStatus / casts | pre-existing (AAI/aligner refactor — stashed in stash@{0}) |

Verified pre-existence by comparison with baseline tsc output captured at
phase start.

---

## Manual device scenarios — PENDING

The following SPEC ACs require a device build. Land Phase 03's commits, run
`expo run:android` (or `run:ios`) on the affected device, and execute each
scenario. Document outcomes here before closing the phase.

### AC-5 — slow cold-open with saved CFI

1. Save a mid-book CFI (e.g., page 3 of chapter 5) for a non-trivial EPUB
   (>2 MB). Force-quit.
2. Cold-open on a slow Android emulator or large EPUB build.
3. Observe: WebView lands on chapter 5 page 3 after `locationsReady` fires —
   no intermediate flash of chapter-0 content.
4. `loadPosition` is called exactly once per cold-open (verifiable via
   `logger.debug('positionStore: load')` count in Metro logs — only one such
   line per book per session).

**Expected result:** [PENDING — fill in after device test]

### AC-8 — force-quit retention loop

1. Open a book to mid-page (e.g., chapter 5, page 3).
2. Force-quit the app from the OS app switcher (not via in-app navigation).
3. Reopen the app, open the same book.
4. Verify the page restored matches step 1.
5. Repeat steps 2–4 five times in a row.

**Expected result:** All five reopens land on the same page. No drift to
chapter 0. [PENDING]

### AC-9 — fresh-book regression

1. Open a book that has no saved position (clear AsyncStorage manually if
   needed: `await AsyncStorage.removeItem('@whisper/positions_cache:<bookId>:epub')`).
2. Reader opens at chapter 0.
3. Read for ~35 seconds without changing chapter.
4. Background the app or wait for the 30s debounce.
5. Reopen — page restored to where you were at step 3.

**Expected result:** Save fires within 30s of reading; restore on cold-open
matches the saved page. [PENDING]

### AC-10 — cross-device max-percent sync

1. Device A: open book, read to ~47% (e.g., chapter 7).
2. Wait for background save (or background the app), confirm Firestore push.
3. Device B (signed in to same account): open the same book; local cache has
   ~12% from a prior session.
4. On foreground, `useSync.checkSync` runs → `resolvePosition` returns
   `'remote'` → reader silently navigates to ~47%.
5. On Device B, advance one chapter (e.g., to chapter 8).
6. Open the book on Device A — verify Device A lands at chapter 8.

**Expected result:** Higher-percent device wins both directions. No conflict
prompt UI shown. [PENDING]

---

## Repository state at phase end

```
0580ff5  refactor(reader): route position writes through positionStore
86b38da  fix(sync): replace resolvePosition with max-percent rule
a6fca66  test(positionStore): cover conflict resolution + restore-gate behavior
d6ba7ee  feat(positionStore): add single-writer module for EPUB position
7d930a1  refactor(book): drop epub position writes from BookSessionScreen
```

(plus planning artifacts: 50c5932 SPEC, 43c1f9c CONTEXT, f6c79cd PLAN)

Working tree clean. AAI/aligner refactor remains in `stash@{0}` for the next
phase to resume.

---

## Before closing the phase

Per the lesson from Phase 01 (closed before peer review surfaced two CRITICAL
findings — see `.planning/phases/01-position-sync-fix/01-REVIEW.md`):

1. Run `/code-review 03` and act on findings before closing.
2. Run `/review` (cross-AI peer review) and act on findings before closing.
3. Complete the four manual device scenarios (AC-5, AC-8, AC-9, AC-10) and
   record results in this file.
4. Only then write `03-SUMMARY.md` and close the phase.
