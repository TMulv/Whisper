---
phase: "03"
phase_name: "position-restore-redesign"
status: spec
generated: 2026-04-30
ambiguity: 0.1625
forensic_ref: ".planning/forensics/report-20260430-073532.md"
review_ref: ".planning/phases/01-position-sync-fix/01-REVIEW.md"
---

# Phase 03 SPEC — Position-restore redesign (single-writer model)

## Why this phase

Phase 01 (`01-position-sync-fix`) closed on 2026-04-28 declaring the EPUB
position-restore bug fixed. The peer code review (`01-REVIEW.md`, 2026-04-29)
returned `status: issues` with two CRITICAL findings (CR-01 bridge timing
heuristic, CR-02 unconditional `pendingCfi` clear). Four `fix(position):`
commits to `ReaderView.tsx` then landed between 2026-04-29 09:05 and 21:36 —
each closing one race and exposing another. The user's reproducible symptom
("the EPUB never remembers where I left off") still occurs.

The forensic report (`report-20260430-073532.md`) attributes this to **structural
drift**: four independent code paths write the EPUB position, and three gates
decide whether each write is allowed. The architecture cannot be made correct
by another single-line guard.

This phase replaces the four-writer / three-gate model with a single-writer
module driven by exactly three triggers, eliminating the entire class of races.

## Goal

Cold-opening a book always seeks to the user's last-known reading position —
on slow devices, on large EPUBs, after force-quit, after a sync from another
device. No `fix(position):` commit should be needed for any subsequent race
discovered after this phase ships.

## Requirements

### R1 — Single position writer

**Current state:** Four code paths write `@whisper/positions_cache:${bookId}:epub`
to AsyncStorage:
1. `src/hooks/useEpubPosition.ts:23-31` — debounced 2s on every `POSITION_CHANGE`
2. `src/screens/book/BookSessionScreen.tsx:159-160` — `beforeRemove` handler
3. `src/screens/book/BookSessionScreen.tsx:225-226` — `handleSwitchMode('listen')`
   snap-flush
4. `src/components/book/ReaderView.tsx:442-443` — AppState `background` handler

Plus `src/services/sync/syncEngine.ts:34` (`pushPosition`) is called from
`ReaderView.tsx:543` for the Firestore push.

**Target state:** A new module `src/services/storage/positionStore.ts` is the
**only** code path that writes the EPUB position. It exposes:

```ts
type EpubLastPosition = {
  cfi: string;
  chapterIndex: number;
  percentComplete: number;
  updatedAt: number;
  deviceId: string;
};

savePosition(bookId: string, pos: EpubLastPosition): void  // fire-and-forget
loadPosition(bookId: string): Promise<EpubLastPosition | null>
```

`savePosition` writes to AsyncStorage synchronously-from-the-caller's-perspective
(it returns immediately) and queues the Firestore push as `void promise`. It
**never blocks the UI** and **never throws** — all errors are logged.

The four existing writers are deleted. Their callers route through `savePosition`.

**Acceptance criterion:**
- `git grep -n "AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub" src/` returns
  exactly one match — inside `src/services/storage/positionStore.ts`.
- `git grep -n "pushPosition" src/` shows `pushPosition` called from exactly
  one place: `src/services/storage/positionStore.ts`.

### R2 — Exactly three save triggers

**Current state:** Position is saved on at least seven event sources:
- Every `POSITION_CHANGE` from the WebView (debounced 2s)
- `beforeRemove` navigation
- `handleSwitchMode` (read→listen)
- AppState change → 'background'
- Implicit: `livePositionRef` being read by other code paths
- `LOCATIONS_READY` synthetic position (currently gated)
- Initial chapter-0 render (currently gated by `programmatic` flag)

**Target state:** `savePosition` is called from exactly three triggers:

1. **AppState transition** to `'background'` or `'inactive'` — captures
   backgrounding, force-quit warmup, and the iOS lock-screen path.
2. **Chapter change** — `position.chapterIndex !== lastSavedChapterIndex`.
3. **30-second debounce while foregrounded and reading** — i.e., the user is
   on `BookSessionScreen`, AppState is `'active'`, and a position has changed
   since the last save.

No other call site exists. In particular: there is no save inside
`handlePositionChange` itself (other than scheduling the 30s debounce), no save
inside `beforeRemove` (R3 explains why), no save inside `handleSwitchMode`.

**Acceptance criterion:**
- `git grep -n "savePosition\b" src/` shows call sites only matching the three
  triggers above (or test files).
- Every call site has a one-line comment naming its trigger
  (e.g., `// trigger: chapter-change`).

### R3 — `beforeRemove` reads, does not write

**Current state:** `BookSessionScreen.tsx` `beforeRemove` calls
`AsyncStorage.setItem` synchronously, racing with `pendingCfi` and the
debounced writer.

**Target state:** Backgrounding the app (R2 trigger 1) covers navigation-away
in practice — React Navigation fires `beforeRemove` and within milliseconds
the screen unmounts and the AppState change handler runs the same save anyway.
But to remove the race surface, `beforeRemove` is replaced with a synchronous
read of `livePositionRef` and a single call to `savePosition` — using the
same code path as the other triggers, not its own AsyncStorage write.

**Acceptance criterion:**
- `git grep -n "AsyncStorage" src/screens/book/BookSessionScreen.tsx` shows zero
  position-related writes (only theme/preference reads).

### R4 — Synchronous read on cold-open

**Current state:** `useEpubPosition.loadLocalPosition` is async and is awaited
inside React effects. `prepareBookForPlayback.ts:96` reads the same key
asynchronously. Both paths exist; both can race.

**Target state:** `loadPosition(bookId)` returns the cached position from
AsyncStorage. Cold-open path: `ReaderView` calls `loadPosition` once during
its first effect, sets `pendingCfi` from the result, and waits for
`locationsReady` to call `goTo(pendingCfi)`. The result is cached in-memory in
`positionStore` so subsequent reads in the same session are synchronous.

**Acceptance criterion:**
- `loadPosition` is called exactly once per book per session (verified by
  log inspection or a small in-memory call counter exposed for tests).
- The first render of `ReaderView` after cold-open with a saved CFI shows the
  correct page within one render cycle of `locationsReady` firing — no
  intermediate flash of chapter-0 content (the existing `pendingCfi`
  hide-until-ready mechanism is preserved).

### R5 — Conflict resolution: max-percent wins

**Current state:** `src/services/sync/syncEngine.ts:12-27` `resolvePosition`
uses time-based logic: remote >5 min newer → remote, same chapter → local,
else prompt.

**Target state:** `resolvePosition` is replaced with: "keep whichever side has
higher `percentComplete`." Tiebreaker on equal percent: keep `local` (the
currently-active session). The `'prompt'` resolution path is removed — there
is no UI that surfaces it today, so it dead-ends.

```ts
// New rule
if (remote.percentComplete > local.percentComplete) return { resolution: 'remote' };
return { resolution: 'local' };  // tie or local-ahead
```

If `percentComplete` is unavailable on either side (e.g., before
`locations.generate()` finishes on a cold-open), `local` wins by default —
the user's current page is more reliable than a remote stub.

**Acceptance criterion:**
- `resolvePosition` returns `'local' | 'remote'` only — no `'prompt'`.
- Test case: local at 12%, remote at 47% on another device → resolution is
  `remote`.
- Test case: local at 50%, remote at 5% (stub) → resolution is `local`.

### R6 — Stop using the bridge `programmatic` flag as a save-gate

**Current state:** `epubBridgeHtml.ts:172` computes
`prog = (Date.now() - _lastProgrammaticNavMs) < 1000` — a 1000ms wall-clock
heuristic. `ReaderView.tsx:405-411` uses it to decide whether the current
`POSITION_CHANGE` was user-driven, and `setPendingCfi(null)` based on the
result. CR-01 in `01-REVIEW.md` proves this misclassifies on slow cold-opens.

**Target state:** Save decisions no longer consult `programmatic`. The bridge
flag stays for diagnostic/log purposes but is removed from the save-gate path.
The only thing that gates `savePosition` is "has any of the three R2 triggers
fired since the last save?". Since saves are no longer fired from
`POSITION_CHANGE`, the misclassification cannot clobber storage.

**Acceptance criterion:**
- `git grep -n "programmatic" src/components/book/ReaderView.tsx` shows
  zero references inside save-related code paths (the flag may remain inside
  log statements only).

### R7 — Restore is unconditional and recoverable

**Current state:** `ReaderView.tsx:529-534`'s `useEffect [locationsReady, pendingCfi]`
calls `goTo(pendingCfi)` and unconditionally `setPendingCfi(null)`. CR-02
shows that if `goTo` fails, `pendingCfi` is gone and the next chapter-0 event
overwrites storage.

**Target state:** `pendingCfi` is cleared only when `POSITION_CHANGE` confirms
the new position is at or past the saved chapter. The `goTo` retry on the same
mount is implicit — `pendingCfi` stays set, so if `locationsReady` re-fires for
any reason (rare but possible during rotation), the restore re-runs.

**Acceptance criterion:**
- `pendingCfi` is cleared inside `handlePositionChange` only when the new
  position's `chapterIndex >= savedPosition.chapterIndex`.
- The `useEffect [locationsReady, pendingCfi]` no longer calls
  `setPendingCfi(null)` synchronously.

## In scope

- New file: `src/services/storage/positionStore.ts` (the single writer)
- New file: `src/services/storage/__tests__/positionStore.test.ts`
- Edits to: `src/components/book/ReaderView.tsx`,
  `src/screens/book/BookSessionScreen.tsx`, `src/hooks/useEpubPosition.ts`
  (or its deletion — see R1), `src/services/sync/syncEngine.ts` (R5).
- Reuse of existing AsyncStorage key `@whisper/positions_cache:${bookId}:epub`
  (no schema migration). Existing on-disk values keep working.
- Reuse of existing Firestore path via `pushPosition` (no schema change).

## Out of scope

- **Audio position storage.** The `:audio` key in `POSITIONS_CACHE_KEY` and the
  audio-side writers (`BookSessionScreen.tsx:177-178`,
  `prepareBookForPlayback.ts:96`, `NowPlayingContext.tsx:48`) are NOT touched.
  Audio position is a separate problem and applying this redesign there is a
  follow-up phase. *Reasoning:* keeping the diff narrow makes the regression
  surface auditable. Audio sync hasn't shown the same race.
- **Bridge-side rewrites of `epubBridgeHtml.ts`.** R6 removes our *use* of the
  `programmatic` flag for saves; it does not modify the bridge. *Reasoning:*
  changing WebView-side JavaScript is high-risk and unnecessary if the React
  side stops trusting the flag for save decisions.
- **The `useSync` UI conflict prompt.** R5 removes the `'prompt'` resolution
  but leaves `useSync.conflict` state in place; it just never gets the prompt
  value. UI cleanup (deleting unused conflict-prompt rendering, if any) is a
  cosmetic follow-up. *Reasoning:* avoid scope creep into UI surfaces.
- **Firestore schema changes.** `FirestorePosition` and the
  `users/{uid}/books/{bookId}/positions/{deviceId}` path stay as-is.
  *Reasoning:* zero migration risk.
- **AsyncStorage migration / key rename.** Keep
  `@whisper/positions_cache:${bookId}:epub`. *Reasoning:* migrating live user
  data without explicit cause is a separate risk surface.
- **Remote-position-on-foreground fetch.** `useSync.checkSync` runs on
  AppState `'active'`; that path is preserved. We change only its
  resolver (R5).

## Acceptance criteria (pass/fail)

A reviewer can run each of these with no judgment calls:

- [ ] **AC-1 (R1):** Exactly one match for
  `git grep -nE "AsyncStorage\\.setItem.*POSITIONS_CACHE_KEY.*epub" src/`,
  located in `src/services/storage/positionStore.ts`.
- [ ] **AC-2 (R1):** Exactly one match for `git grep -n "pushPosition" src/`
  inside non-test code, located in `src/services/storage/positionStore.ts`.
- [ ] **AC-3 (R2):** `git grep -nE "savePosition\\b" src/ | grep -v __tests__`
  lists only call sites with adjacent comments naming one of the three
  triggers.
- [ ] **AC-4 (R3):**
  `git grep -nE "AsyncStorage\\.setItem" src/screens/book/BookSessionScreen.tsx`
  returns zero position-related lines.
- [ ] **AC-5 (R4 + manual test):** Cold-open a book with a saved mid-book CFI
  on Android with the simulated-slow option enabled (or a release-mode large
  EPUB); the WebView shows the correct page after `locationsReady` without an
  intermediate chapter-0 flash, and `loadPosition` is called exactly once
  (verified via `logger.info('positionStore: load')`).
- [ ] **AC-6 (R5 + unit test):** `positionStore.test.ts` includes the two test
  cases from R5 (local 12% vs remote 47% → remote; local 50% vs remote 5% →
  local) and both pass.
- [ ] **AC-7 (R6):**
  `git grep -n "programmatic" src/components/book/ReaderView.tsx | grep -v "logger\\.\\|// "`
  returns zero matches (i.e., `programmatic` is referenced only in log lines
  or comments, never in conditional save logic).
- [ ] **AC-8 (R7 + manual test):** Force-quit the app while on a mid-book
  page; reopen; the saved CFI is restored. Repeat 5 times in a row — every
  reopen lands on the same page (no drift to chapter-0).
- [ ] **AC-9 (regression):** Cold-open a brand-new book that has no saved
  position; the reader opens at chapter 0 and a save happens within 30s of
  reading without errors.
- [ ] **AC-10 (regression):** Sign in on a second device; cold-open the same
  book that has a higher remote percentComplete; the second device opens at
  the remote position. Then advance one chapter on device 2; cold-open device
  1; device 1 opens at device-2's newer position.

## Constraints

- **No UI thread blocking on disk or network.** `savePosition` returns
  synchronously; AsyncStorage write is fire-and-forget; Firestore push is
  fire-and-forget.
- **No new top-level dependencies.** Use existing `AsyncStorage`,
  existing Firestore client, existing `pushPosition`.
- **Backwards-compatible storage.** Existing on-disk
  `@whisper/positions_cache:${bookId}:epub` values must still parse and load.
- **No deletion of `useSync`.** It still pulls remote on foreground; only the
  resolver is replaced.
- **Tests run.** A unit test file at
  `src/services/storage/__tests__/positionStore.test.ts` is required even
  though no Jest runner is wired in `package.json`. Adding a Jest config or
  npm script is out of scope for this phase, but the test file must be
  written and structured to run when Jest is added.

## Ambiguity Report

| Dimension          | Score | Min  | Status |
|--------------------|------:|-----:|--------|
| Goal Clarity       | 0.90  | 0.75 | ✓      |
| Boundary Clarity   | 0.85  | 0.70 | ✓      |
| Constraint Clarity | 0.75  | 0.65 | ✓      |
| Acceptance Criteria| 0.80  | 0.70 | ✓      |
| **Ambiguity**      | **0.1625** | ≤ 0.20 | ✓ |

All dimensions meet minimums. Spec is ready for `/discuss-phase`.

## Open questions for `/discuss-phase` (HOW, not WHAT)

These are deferred to discuss-phase per the spec/plan boundary — not
ambiguities about *what* this phase delivers, just decisions about *how*:

1. **Where exactly does the AppState subscription live?** Options:
   inside `positionStore` itself (module-level singleton listening with
   `AppState.addEventListener`), or in `ReaderView` (component-scoped) routed
   through `savePosition`. Module-level is simpler but has lifecycle
   implications.
2. **Should `loadPosition`'s in-memory cache invalidate on remote sync?** When
   `useSync` resolves `remote` wins, the in-memory cache must be updated so
   the next `loadPosition` returns the remote value.
3. **Is `useEpubPosition` deleted or repurposed?** It still exposes
   `position` state for the chrome (progress bar). Likely it stays as a
   read-only state holder fed by `positionStore` instead of writing.
