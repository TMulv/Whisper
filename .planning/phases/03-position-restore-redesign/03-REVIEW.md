---
phase: "03"
phase_name: "position-restore-redesign"
depth: standard
status: issues
files_reviewed: 7
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
generated: 2026-04-30
---

## Summary

Static structural goals are met: single AsyncStorage write site, single
`pushPosition` import, three named triggers, no EPUB writes left in
BookSessionScreen, pre-existing `programmatic`-flag save-gate logic deleted.
The unit tests cover SPEC AC-6 verbatim.

**However, the central runtime invariant — "the saved CFI is restored on
cold-open" — is broken by the current ordering of guards in
`handlePositionChange`.** R7's confirmed-clear branch (lines 561–573) is
unreachable as long as `pendingCfiRef.current` is non-null, because the
`pendingCfiRef` gate at line 523 returns earlier. The result is that the
goTo-response POSITION_CHANGE is gated and discarded, `pendingCfi` never
clears, `livePositionRef` is never written, and saves no-op for the rest of
the session. AsyncStorage retains the prior session's CFI (so the next
cold-open coincidentally restores the same page), but in-session forward
progress is silently never persisted. This is the same class of bug Phase 01
shipped — a race the gates were supposed to close, that the new design
actually re-introduces in a different shape. **This must be fixed before
device verification or the phase will fail every AC-8 reopen and AC-9
fresh-book scenarios.**

Two warnings: `setCachedPosition` is exported but never called from
`useSync`, so the in-memory cache is stale after a remote-wins resolution
(D-G3 explicitly flagged this in CONTEXT.md but it isn't wired up); and
`lastSavedChapterIndexRef` / `savedChapterIndexRef` are component-instance
refs that don't reset when `bookId` changes. Two info-level: the 30s
"debounce" uses trailing-edge semantics so it never fires during continuous
active reading (intent appears to be a 30s throttle), and silent
fire-and-forget I/O has no observability beyond `logger.warn`.

## Critical findings

### CR-01 R7 confirmed-clear branch is unreachable — restore cannot complete

`src/components/book/ReaderView.tsx:520-573`

The two guards in `handlePositionChange` interact incorrectly. After
locationsReady is true, the second guard returns early when `pendingCfiRef`
is set:

```typescript
// Line 523-530
if (pendingCfiRef.current) {
  logger.debug('ReaderView: POSITION_CHANGE gated (pendingCfi active)', { ... });
  return;
}
```

The R7 confirmed-clear branch lives further down at lines 561–573 inside
the same callback, so it cannot run while the gate is closed. The flow:

1. Cold-open → `loadPosition` returns the saved value → `pendingCfiRef`,
   `savedChapterIndexRef`, and `pendingCfi` (state) are all set.
2. `locationsReady` fires → `useEffect [locationsReady, pendingCfi]` calls
   `webViewRef.current?.goTo(pendingCfi)`. **This effect no longer clears
   `pendingCfi` (intentional, per R7 / CR-02).**
3. The WebView responds with a `POSITION_CHANGE` carrying the restored
   chapter (e.g., chapter 5).
4. `handlePositionChange` runs: `locationsReadyRef.current` is true → pass.
   `pendingCfiRef.current` is non-null → **return at line 530**.
5. `pendingCfi` is never cleared. `livePositionRef.current` is never
   written. The R7 confirmed-clear at 561 never executes.

Subsequent events:
- Every later POSITION_CHANGE hits the same gate and returns.
- `livePositionRef` stays at whatever it was (null on cold-open) — so
  `buildPayload()` returns null and `persistNow` no-ops.
- `savePosition` is also gated by `restoreCheck` (which reads
  `pendingCfiRef.current !== null`), so even a non-null payload would
  be dropped.
- The visual state is correct (the WebView shows the restored page), but
  the React state and storage are frozen at the cold-open snapshot.

**Net effect:** AsyncStorage retains the *prior* session's saved CFI for the
entire current session. If the user reads forward, the next cold-open
restores the *previous* save, not where they actually left off. This will
fail SPEC AC-8 ("Repeat 5 reopens — every reopen lands on the same page")
on the *second* iteration, and will fail AC-9 ("save fires within 30s of
reading").

The bug is exactly the kind of structural flaw the phase was meant to
eliminate. It mirrors CR-02 from Phase 01's review (a clear written without
verifying the goTo landed) but in inverted form: the verifier is now
present, but unreachable.

**Fix:** restructure the second guard so the restore-confirm path can pass
through. Concretely:

```typescript
// Line 520-530, REPLACE WITH:
if (pendingCfiRef.current) {
  // R7 confirmed-clear lives here, inside the gate, so the restore-goTo's
  // POSITION_CHANGE response is the only event that can clear it.
  if (
    savedChapterIndexRef.current !== null &&
    position.chapterIndex >= savedChapterIndexRef.current
  ) {
    logger.debug('ReaderView: pendingCfi cleared (chapter confirmed)', {
      chapterIndex: position.chapterIndex,
      savedChapter: savedChapterIndexRef.current,
    });
    pendingCfiRef.current = null;
    savedChapterIndexRef.current = null;
    setPendingCfi(null);
    // Fall through to the post-gate body so livePositionRef is written
    // and the chapter-change trigger fires.
  } else {
    logger.debug('ReaderView: POSITION_CHANGE gated (pendingCfi active)', {
      incoming: position.cfi,
      pendingCfi: pendingCfiRef.current,
      programmatic,
    });
    return;
  }
}
```

Also delete the now-redundant duplicate clear block at lines 561–573 (it
becomes dead code once the gate above handles the clear).

**Also verify** that the existing `pendingRestorePositionRef` echo branch at
lines 536–543 still does the right thing once the gate falls through.
Reading it: when `programmatic && pendingRestorePositionRef.current !== null`,
it updates `currentChapterIndex` and `setFromBridge(position)` then returns
*before* writing `livePositionRef`. After the fix above, the goTo's response
is `programmatic=true` and `pendingRestorePositionRef` is still set
(line 552 only clears it after the echo branch is bypassed). So the echo
branch fires, mirrors state, and returns — `livePositionRef` is still null,
and the *next* user-driven POSITION_CHANGE writes it. This is the original
Phase 01 design, and it works, but it means the *first* save after restore
won't fire from the goTo response itself but from the next event. That's
fine for the phase's contract.

---

## Warnings

### WR-01 `setCachedPosition` is exported but never called — in-memory cache stale after remote-wins resolution

`src/services/storage/positionStore.ts:100-102`, `src/hooks/useSync.ts:42-46`

CONTEXT.md D-G3 flagged this question explicitly:

> "Should `loadPosition`'s in-memory cache invalidate on remote sync? When
> `useSync` resolves `remote` wins, the in-memory cache must be updated so
> the next `loadPosition` returns the remote value."

`positionStore` exports `setCachedPosition` for exactly this reason, but
nothing calls it. When `useSync.checkSync` resolves `'remote'`, the React
state is updated via `setConflict(result)`, but `memoryCache` in
`positionStore` is not.

**Concrete scenario:**
1. Device B's local AsyncStorage has saved position at 12% (cached in
   memoryCache after `loadPosition`).
2. Device B foregrounds → `useSync.checkSync` → `resolvePosition` returns
   `'remote'` (47%).
3. ReaderView (or its consumer) navigates to remote.epubCfi.
4. The new triggers fire — `savePosition` updates memoryCache via line 52.
5. **OK in steady state.** But between step 3 and step 4 (i.e., before any
   trigger fires post-navigation), if a *separate* code path calls
   `loadPosition`, it returns the stale 12%.

In practice the only post-foreground caller of `loadPosition` is
ReaderView's cold-open path, which is one-shot. So this is unlikely to bite
during a single session. **But** `prepareBookForPlayback.ts:96` reads the
*AsyncStorage* key directly — not memoryCache — so the audio handoff sees
the freshly-written remote value. The inconsistency is only inside
`positionStore`.

**Fix:** wire `useSync.checkSync` to call `setCachedPosition` when
resolution is `'remote'`. Exact site (`src/hooks/useSync.ts:42-46`):

```typescript
if (result.resolution === 'remote') {
  setCachedPosition(bookId, {
    cfi: remote.epubCfi,
    chapterIndex: remote.chapterIndex,
    charOffset: remote.charOffset,
    percentComplete: remote.percentComplete,
    updatedAt: remote.updatedAt,
  });
  setConflict(result);
}
```

Add the import. This honors D-G3's explicit decision and prevents the rare
race above.

### WR-02 `lastSavedChapterIndexRef` and `savedChapterIndexRef` are not reset on `bookId` change

`src/components/book/ReaderView.tsx:440-443`

Both refs are component-instance refs (not keyed on bookId). When the user
opens book A, then book B, the refs carry book A's last value into book B's
session. Concrete impact:

- `lastSavedChapterIndexRef` — controls the chapter-change trigger. If
  book A's last saved chapter was 5 and book B starts at chapter 5, the
  chapter-change trigger is suppressed for book B's first POSITION_CHANGE.
  The 30s debounce or AppState→background trigger still saves eventually,
  so this is recoverable, but the chapter-change semantics are wrong.
- `savedChapterIndexRef` — controls the R7 confirmed-clear gate (after
  CR-01 is fixed). Stale value across books could either mistakenly clear
  pendingCfi on the wrong book or fail to clear it.

**Fix:** reset both on `bookId` change:

```typescript
useEffect(() => {
  lastSavedChapterIndexRef.current = null;
  savedChapterIndexRef.current = null;
}, [bookId]);
```

Place it near the existing `[bookId]` effects in ReaderView.

### WR-03 Cold-open path projects `EpubLastPosition` → `EpubPosition` with `chapterFraction: -1`, but consumers reading `getLastKnownPosition` may not handle `-1` correctly

`src/components/book/ReaderView.tsx:401`

```typescript
pendingRestorePositionRef.current = { ...saved, chapterFraction: -1 };
```

`pendingRestorePositionRef` is read by `useImperativeHandle.getLastKnownPosition`
(line 189), which is called by:
- `BookSessionScreen.tsx:152` (beforeRemove diagnostic) — reads `cfi`,
  `chapterIndex` only. Safe.
- `BookSessionScreen.tsx:235-237` (`handleSwitchMode` listen-branch
  fallback) — passes the position into the audio handoff. Reads `cfi`,
  `chapterIndex`, `percentComplete`. Does not read `chapterFraction`. Safe.
- `prepareBookForPlayback` — let's check.

I did not exhaustively audit every consumer. The `-1` sentinel is documented
in `src/types/position.ts:6-7` as the "no data available" value, so any
consumer respecting the contract handles it. **No bug surface yet, but
worth a one-pass grep** before closing the phase:

```bash
git grep -n "chapterFraction" src/
```

Confirm every reader handles `-1` or guards on it. If anything assumes
`chapterFraction >= 0`, this is a latent bug.

---

## Info

### IN-01 30s "debounce" uses trailing-edge semantics — never fires during continuous active reading

`src/components/book/ReaderView.tsx:471-476`

`scheduleDebouncedSave` is called from every accepted POSITION_CHANGE
(line 612). Each call cancels the previous timer and starts a fresh 30s
countdown. If the user is actively page-turning every <30s, the timer is
constantly reset and the save *never* fires from this trigger.

The intent in CONTEXT.md D-G2 reads:
> "30-second debounce while actively reading"

Which is ambiguous — could mean "fire at most once per 30s of activity"
(throttle) or "fire after 30s of stillness" (debounce). The current code
implements the latter, which means active readers depend entirely on the
chapter-change and AppState→background triggers for persistence.

In practice this is probably fine: chapter crossings happen often enough
during active reading, and AppState→background fires on screen lock /
app-switcher. **But** a user who reads through a long chapter (>30 min) on
a device that doesn't sleep, then crashes, would lose that read time.

**Fix (optional):** if throttle is the intent, structure as:

```typescript
const lastDebounceFireRef = useRef<number>(0);
const scheduleDebouncedSave = useCallback(() => {
  const now = Date.now();
  if (now - lastDebounceFireRef.current < 30_000) return;
  lastDebounceFireRef.current = now;
  persistNow('debounce-30s');
}, [persistNow]);
```

This guarantees one save per 30s during continuous reading. Pair with a
single timer that fires `persistNow('debounce-30s')` every 30s while
foregrounded if even simpler.

This is INFO not WARNING because the chapter-change + AppState→background
triggers cover most realistic loss scenarios. But the SPEC's intent should
be clarified before sign-off.

### IN-02 Silent fire-and-forget I/O — only observable in dev logs

`src/services/storage/positionStore.ts:54-56, 70-72`

```typescript
AsyncStorage.setItem(...).catch((err) => logger.warn(...));
pushPosition(...).catch((err) => logger.warn(...));
```

`logger` is a no-op in production (`isDev` gate in
`src/utils/logger.ts:1`), so a chronic AsyncStorage failure (e.g., disk
full) is genuinely silent. The user reads forward and reopens to find their
position lost. This isn't a regression — the old code had the same fire-
and-forget pattern — but it's worth flagging because the new design moved
ALL writes here, so a single point of silent failure now has wider blast
radius.

**Fix (optional):** add a single sentinel — e.g., increment a
`writeFailureCount` ref in positionStore on `.catch`, and surface it via
a debug-only logging aggregator (or a Sentry breadcrumb if/when error
reporting is wired). Not required for this phase.

---

## Files reviewed

- `/Users/tmulvey/Documents/GitHub/Whisper/src/services/storage/positionStore.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/services/storage/__tests__/positionStore.test.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/services/sync/syncEngine.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/hooks/useEpubPosition.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/hooks/useSync.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/components/book/ReaderView.tsx`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/screens/book/BookSessionScreen.tsx`
