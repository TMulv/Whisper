# Phase 03: Position Restore Redesign — Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Source:** SPEC.md (7 requirements locked) + 5-area discussion

<spec_lock>
## Locked by SPEC.md

Requirements R1–R7 are LOCKED — see `.planning/phases/03-position-restore-redesign/03-SPEC.md`.

- **R1** Single writer at `src/services/storage/positionStore.ts`
- **R2** Three save triggers only: AppState→background/inactive, chapter-change, 30s in-foreground debounce
- **R3** `beforeRemove` reads, doesn't write
- **R4** Synchronous-from-caller-perspective save; in-memory cache for sync read
- **R5** Conflict rule: `max(percentComplete)` wins; tiebreaker → local
- **R6** Drop bridge `programmatic` flag from save-gate logic
- **R7** `pendingCfi` cleared only when POSITION_CHANGE confirms `chapterIndex >= savedPosition.chapterIndex`

Acceptance criteria AC-1 through AC-10 in SPEC are pass/fail and MUST be honored
by the planner. Do not duplicate requirement text below.
</spec_lock>

<domain>
## Phase Boundary

Replace the four-writer / three-gate EPUB position-restore architecture with a
single-writer module. EPUB position only — audio position keeps its existing
machinery untouched.

**In scope:** `src/services/storage/positionStore.ts` (new), edits to
`src/components/book/ReaderView.tsx`, `src/screens/book/BookSessionScreen.tsx`,
`src/hooks/useEpubPosition.ts`, `src/services/sync/syncEngine.ts`. Tests at
`src/services/storage/__tests__/positionStore.test.ts`.

**Out of scope:** audio position, `epubBridgeHtml.ts` rewrites, Firestore schema
changes, AsyncStorage key rename, conflict-prompt UI cleanup, useSync's
foreground-pull mechanism (only its resolver changes).
</domain>

<decisions>
## Implementation Decisions (HOW)

### D-G1: AppState subscription lives in ReaderView, not positionStore

`positionStore` is a stateless pure-function module: `savePosition`,
`loadPosition`, `resolvePosition`. All three save triggers (AppState,
chapter-change, 30s debounce) live in `ReaderView` (or a new
`usePositionPersistence` hook it owns).

**Why:** module-level singleton would need a `setActiveBook(bookId)` global
mutable, fighting React's lifecycle. All three triggers are naturally
component-scoped — the active book is BookSessionScreen's lifetime. Cleanup
via React's `useEffect` return — no manual lifecycle management. Cleaner test
surface (mock store via prop, no global to reset).

**Implementation note for planner:** the new `usePositionPersistence(bookId,
readerRef)` hook (or inline in ReaderView) owns:
- `AppState.addEventListener('change', ...)` subscription
- `setTimeout` debounce timer + ref
- `lastSavedChapterIndex` ref for chapter-change detection
- All three trigger handlers, each calling `positionStore.savePosition(bookId, pos)`

### D-G2: Chapter-change saves immediately, resets the 30s timer

Standard leading-edge debounce with reset. When `chapterIndex` differs from
`lastSavedChapterIndex`:
1. Cancel the pending 30s timer.
2. Call `savePosition` immediately.
3. Update `lastSavedChapterIndex`.
4. Schedule the next 30s timer from now.

**Why:** chapter-change is infrequent and high-signal — worth a write.
Resetting the timer prevents a redundant write 30s later when the user is
still reading the new chapter.

**Auto-decided** (no user discussion needed). Standard pattern.

### D-G3: Triggers no-op while `pendingCfi !== null`

`savePosition(bookId, pos)` consults a `restoreInProgress(bookId)` flag and
returns early when set. The flag is `true` while `pendingCfi !== null` for
that book. This is the canonical fix for the cold-open-and-background race
that triggered this entire phase.

**`pendingCfi` clears via two paths only:**
1. R7's mechanism — POSITION_CHANGE confirms `chapterIndex >= savedPosition.chapterIndex`.
2. Explicit user-navigation APIs that clear it synchronously *before* the
   WebView roundtrip:
   - Chapter drawer click — call sites in `ReaderDrawer` invoking
     `webView.goToChapter(idx)` must clear `pendingCfi` first.
   - Any "back to start" / bookmark / TOC-jump UI affordance — same rule.

**Implementation note for planner:** add a `userNav: true` parameter (or a
parallel `goToChapterUser`) to the bridge's `goToChapter` API. The React-side
wrapper synchronously clears `pendingCfi` before invoking `injectJavaScript`.
Audit `src/components/reader/ReaderDrawer.tsx` and any other consumer of
`goToChapter` for the swap.

**State coupling:** `pendingCfiRef` already exists; the `restoreInProgress`
function is just `() => pendingCfiRef.current !== null`. No new state.

### D-G4: `useEpubPosition` becomes a thin read-only wrapper

The hook stays. Its writer logic (debounce timer, AsyncStorage write,
`onPersist` callback) is deleted. What remains is a state-holder:

```ts
export function useEpubPosition(bookId: string) {
  const [position, setPosition] = useState<EpubPosition | null>(null);
  const setFromBridge = useCallback((p: EpubPosition) => setPosition(p), []);
  const loadLocalPosition = useCallback(
    () => positionStore.load(bookId).then((p) => { if (p) setPosition(p); return p; }),
    [bookId],
  );
  return { position, setFromBridge, loadLocalPosition };
}
```

**Why:** consumers (reader chrome, progress bar, percentComplete display) keep
reading `position` unchanged. The `userId` parameter goes away — sync is
`positionStore`'s job. Smallest diff that satisfies R1.

**Implementation note for planner:** all current callers passing `userId`
must be updated. The `onPersist` callback wired to `pushPosition` in
`ReaderView.tsx:543` is removed — `positionStore.savePosition` handles
Firestore push internally.

### D-G5: Remote-wins navigation is silent

When `useSync.checkSync` resolves `'remote'` (other device has higher
`percentComplete`), the local position state updates and `ReaderView`
navigates via `goTo(remote.epubCfi)` without UI confirmation.

**Why:** matches SPEC pseudocode; toast UI is scope creep. A
`logger.info('positionStore: applied remote position', { bookId, percent })`
gives diagnostic visibility.

**Auto-decided** (no user discussion needed). Toast UX can be a follow-up
phase if it turns out users want the visibility.

### Claude's Discretion (planner can decide)

- File organization inside `positionStore.ts` (one file vs split into
  `positionStore.ts` + `positionStoreSync.ts`)
- Naming of the `usePositionPersistence` hook vs inlining in ReaderView
- Exact log line wording
- Test framework setup (Jest config) — out of scope per SPEC, planner can
  note as a follow-up
- Whether the in-memory cache (R4) is per-book Map or just a single most-recent
  bookId entry (premature to optimize)
</decisions>

<canonical_refs>
## Canonical References

**MUST read before planning:**

- `.planning/phases/03-position-restore-redesign/03-SPEC.md` — locked requirements (READ FIRST)
- `.planning/phases/01-position-sync-fix/01-REVIEW.md` — peer code review with CR-01 (bridge timing) and CR-02 (unconditional pendingCfi clear) — both addressed in this phase
- `.planning/forensics/report-20260430-073532.md` — root-cause analysis behind this phase's existence

**Code under change:**

- `src/components/book/ReaderView.tsx` — owns the bridge, `pendingCfi`, `livePositionRef`, AppState subscription (currently lines ~427–443 for the AppState writer; ~398–441 for `handlePositionChange`; ~529–534 for the locationsReady → goTo effect)
- `src/screens/book/BookSessionScreen.tsx` — `beforeRemove` writer (~line 137, 159–160), `handleSwitchMode` snap-flush (~line 225–226)
- `src/hooks/useEpubPosition.ts` — current debounced writer (~line 23–31)
- `src/services/sync/syncEngine.ts` — `pushPosition` (line 34, KEEP), `resolvePosition` (lines 12–27, REPLACE — change rule from time-based to max-percent)
- `src/hooks/useSync.ts` — its resolver call site at line 40 (no change to the hook itself; it picks up the new resolver)
- `src/components/reader/ReaderDrawer.tsx` — chapter drawer; D-G3 affects how it clears `pendingCfi` on user-driven nav
- `src/services/audio/prepareBookForPlayback.ts:96-97` — reads epub key (no change; still works with same key)

**Architecture context:**

- `CLAUDE.md` — three-layer position model (React state, AsyncStorage, Firestore), getCurrentPosition vs getLastKnownPosition, L0/L0.5/L1 alignment context
- `src/constants/config.ts:13` — `POSITIONS_CACHE_KEY = '@whisper/positions_cache'` (UNCHANGED — backward-compatible key)
- `src/constants/epubBridgeHtml.ts:84,172` — `_lastProgrammaticNavMs` and the 1000ms heuristic (NOT modified, but no longer trusted as a save-gate per R6)
</canonical_refs>

<specifics>
## Specific Scenarios for Verification

User's reproducible failure scenario (must regress to FIXED after this phase):
1. Saved CFI exists at chapter 5, page 3
2. Cold-open the book on Android (or iOS) on a slow build / large EPUB
3. Background the app within 1–2 seconds (before `locationsReady` fires)
4. Reopen the app
5. Reader lands on chapter 5, page 3 — **NOT chapter 0**

Cross-device scenario (R5):
1. Device A reads to 47%, position pushed to Firestore
2. Device B opens the same book; local has 12% from a prior session
3. Device B's `useSync.checkSync` runs on foreground → `resolvePosition` returns `'remote'`
4. Device B silently navigates to 47%

In-flight scenario (D-G2):
1. User is at chapter 3, has been reading 25 seconds
2. User taps a chapter drawer entry to jump to chapter 7
3. `goToChapterUser(7)` clears `pendingCfi` synchronously
4. WebView navigates → POSITION_CHANGE arrives with chapterIndex=7
5. `chapterIndex (7) !== lastSavedChapterIndex (3)` → save fires immediately
6. 30s timer reset

Force-quit scenario (D-G3):
1. Saved CFI at chapter 5
2. Cold-open → `pendingCfi` set
3. User force-quits before `locationsReady`
4. AppState sees inactive/background → `savePosition` called → no-op (restore in progress)
5. AsyncStorage retains the chapter-5 CFI
6. Next cold-open restores chapter 5 correctly
</specifics>

<deferred>
## Deferred Ideas

- **Audio position single-writer redesign** — same architecture, applied to
  the `:audio` AsyncStorage key. Probably worth a follow-up phase 04 once
  this lands and proves out.
- **Toast/banner on remote-wins** — if users find silent cross-device sync
  disorienting, add a "Synced from your iPhone — page 142" toast. Trivial UI
  work, deferred to keep this phase narrow.
- **Conflict-prompt UI cleanup** — `useSync.conflict` state remains in place
  even though it never receives `'prompt'` after R5. Audit and remove unused
  rendering in a cosmetic follow-up.
- **Jest runner wired into package.json** — tests are required by the SPEC
  but no `npm test` exists. Adding Jest config is its own phase.
- **AsyncStorage key migration / namespacing** — if a future phase wants to
  rename `@whisper/positions_cache:${bookId}:epub` → `epub:lastPosition:${bookId}`
  (per the user's original pseudocode), it needs a one-shot migration on app
  upgrade. Deliberately not done here to keep migration risk = 0.
- **Bridge-side rewrite of the `programmatic` heuristic** — R6 stops trusting
  the 1000ms wall-clock for save decisions, but the bridge's flag still exists
  and is still wrong on slow devices. A follow-up could replace the heuristic
  with an explicit "first locationChanged after loadBook is programmatic"
  one-shot boolean, useful for log accuracy.
</deferred>

---

*Phase: 03-position-restore-redesign*
*Context gathered: 2026-04-30*
*Discussion: G1, G3, G4 user-confirmed; G2, G5 auto-decided with rationale*
