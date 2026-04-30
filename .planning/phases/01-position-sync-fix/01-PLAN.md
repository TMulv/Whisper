---
wave: 1
depends_on: []
files_modified:
  - src/components/book/ReaderView.tsx
  - src/screens/book/BookSessionScreen.tsx
autonomous: true
requirements:
  - reader-saves-position
  - audio-starts-from-reader
  - reader-resumes-from-audio
---

# Plan 01 — Fix reader/audio position sync across mode switches

## Objective

Three linked bugs cause position to be lost or reset when switching between
read and listen modes in `BookSessionScreen`:

1. **pendingCfi race** — epub.js fires `locationsReady` seconds after the
   bridge loads. `pendingCfi` is set to the saved CFI during initial load.
   If the user navigates before `locationsReady` fires, `locationsReady`
   triggers `goTo(pendingCfi)` and snaps the reader back to the old saved
   position. Symptom: "went forward five pages, came back, and was at the
   start".

2. **read→listen: getCurrentPosition returns zero percent** — Before
   `locationsReady`, epub.js hasn't generated location indices so it reports
   `percentComplete=0`. `handleSwitchMode('listen')` uses this to decide
   whether `epubPos` is valid. The existing `getLastKnownPosition()` ref is
   not yet used as a fallback here.

3. **listen→read: sync skipped when audioPos=0** — If the user switches to
   audio then immediately back without listening, `audioPos` is 0, the
   `if (audioPos > 0)` guard skips `syncToAudio`, and the reader drifts. Once
   Bug 1 is fixed the reader stays at the correct position in this case, but
   the guard comment is misleading without a fallback.

## must_haves

```yaml
truths:
  - reader position is NOT reset by locationsReady once user has navigated
  - switching read→listen seeks audio to current reader page, not beginning
  - switching listen→read navigates reader to current audio position when audio played
  - switching listen→read keeps reader position when user didn't listen (audioPos=0)
  - all three fixes land in one atomic commit on existing files only
  - no new files created
  - no changes to alignment or handoff logic
```

---

## Task 1 — Clear pendingCfi on user-driven navigation

**Root cause:** `pendingCfi` is set to `savedCfi` during the epub ready effect.
`locationsReady` fires ~2-30 s later and calls `goTo(pendingCfi)`, overriding
any navigation the user made in the meantime. The position change callback
already receives a `programmatic: boolean` flag — when `!programmatic`, the
user navigated manually and `pendingCfi` must be cleared.

<read_first>
- `src/components/book/ReaderView.tsx` — read lines 388–441 (`handlePositionChange`)
  and lines 507–513 (`locationsReady` effect)
</read_first>

<action>
In `handlePositionChange` (around line 389), add one line as the first thing
inside the callback body, before the `setCurrentChapterIndex` call:

```typescript
const handlePositionChange = useCallback(
  (position: EpubPosition, programmatic: boolean) => {
    livePositionRef.current = position;
    if (!programmatic) setPendingCfi(null);   // ← ADD THIS LINE
    setCurrentChapterIndex(position.chapterIndex);
    // ... rest unchanged
  }
)
```

No other changes to this function. `setPendingCfi` is already in scope
(declared via `useState` at line ~154).
</action>

<acceptance_criteria>
- `src/components/book/ReaderView.tsx` contains the line `if (!programmatic) setPendingCfi(null);` inside `handlePositionChange`
- The line appears before `setCurrentChapterIndex(position.chapterIndex);`
- The `locationsReady` effect at lines 507–513 is unchanged
- No other modifications to `handlePositionChange`
</acceptance_criteria>

---

## Task 2 — Fall back to lastKnownPosition when getCurrentPosition returns empty

**Root cause:** `handleSwitchMode('listen')` awaits the async
`getCurrentPosition()` WebView bridge. Before `locationsReady`, epub.js
returns `percentComplete=0` with a valid CFI only if the WebView round-trip
succeeds quickly. If CFI is also missing, `epubPos` is set to `undefined` and
audio starts from the saved AsyncStorage position instead of the live page.
The `getLastKnownPosition()` ref (added in the already-landed diff) is the
reliable synchronous fallback — it's updated on every position change event.

<read_first>
- `src/screens/book/BookSessionScreen.tsx` — read lines 173–273 (`handleSwitchMode`)
- `src/components/book/ReaderView.tsx` — read lines 157–169 (`useImperativeHandle` returning `getLastKnownPosition`)
</read_first>

<action>
In `handleSwitchMode`, inside the `if (next === 'listen')` branch, replace
the `epubPos` derivation block (currently ~lines 184–188):

BEFORE:
```typescript
const livePos = await readerRef.current?.getCurrentPosition();
const epubPos = livePos && (livePos.percentComplete > 0 || livePos.cfi)
  ? livePos
  : undefined;
```

AFTER:
```typescript
const livePos = await readerRef.current?.getCurrentPosition();
// Fall back to the synchronous ref when the async bridge returns empty
// (common before epub.js locations.generate() finishes).
const epubPos =
  (livePos && (livePos.percentComplete > 0 || livePos.cfi))
    ? livePos
    : (readerRef.current?.getLastKnownPosition() ?? undefined);
```

No other changes to `handleSwitchMode`.
</action>

<acceptance_criteria>
- `src/screens/book/BookSessionScreen.tsx` contains `readerRef.current?.getLastKnownPosition() ?? undefined` in `handleSwitchMode`
- The fallback is inside the `if (next === 'listen')` branch
- `epubPos` derivation still guards against null/empty positions
- No changes to the `if (next === 'read')` branch
</acceptance_criteria>

---

## Task 3 — Save reader position synchronously before switching to audio

**Root cause:** When the user switches read→listen, the debounced 2 s
AsyncStorage write in `useEpubPosition` may not have fired yet for the
latest page. If `getCurrentPosition()` fails (Bug 2 race), `prepareBookForPlayback`
falls back to the AsyncStorage value — which could be stale by a page or two.
Writing the last known position synchronously right before the switch ensures
the fallback chain has fresh data.

<read_first>
- `src/screens/book/BookSessionScreen.tsx` — read lines 173–253 (`handleSwitchMode`, `if (next === 'listen')` branch)
- `src/constants/config.ts` — confirm `POSITIONS_CACHE_KEY` export name
</read_first>

<action>
At the very start of the `if (next === 'listen')` block, after the `hasAudio`
guard, add a synchronous save of the last known reader position:

BEFORE (around line 183):
```typescript
setSwitching(true);
try {
  const livePos = await readerRef.current?.getCurrentPosition();
```

AFTER:
```typescript
setSwitching(true);
try {
  // Flush reader position before async work so AsyncStorage fallback is fresh.
  const snapPos = readerRef.current?.getLastKnownPosition();
  if (snapPos && snapPos.percentComplete > 0) {
    AsyncStorage.setItem(
      `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`,
      JSON.stringify({ ...snapPos, savedAt: Date.now() }),
    ).catch(() => {});
  }

  const livePos = await readerRef.current?.getCurrentPosition();
```

`AsyncStorage` and `POSITIONS_CACHE_KEY` are already imported in
`BookSessionScreen.tsx`.
</action>

<acceptance_criteria>
- `src/screens/book/BookSessionScreen.tsx` contains `AsyncStorage.setItem(\`${POSITIONS_CACHE_KEY}:${params.bookId}:epub\`` inside the `if (next === 'listen')` branch
- The save uses `getLastKnownPosition()` (not `getCurrentPosition()`)
- The save is fire-and-forget (`.catch(() => {})`)
- No duplicate `AsyncStorage` import added (already present)
</acceptance_criteria>

---

## Task 4 — Keep reader position when audio hasn't played (audioPos=0)

**Root cause:** When switching listen→read, `if (audioPos > 0)` skips
`syncToAudio` if audio never advanced. Once Bug 1 is fixed, the reader
correctly stays at its last manual position in this case. But if audio was
seeked to the reader's position and then paused at that point, `audioPos` may
still be `> 0` and `syncToAudio` navigates correctly. The only change needed
here is a clarifying comment — no logic change required.

Verify that the guard is intentional and correct given the other fixes:
- If `audioPos === 0`: reader stays at current position (correct — user didn't listen)
- If `audioPos > 0`: reader syncs to audio position (correct — user listened)

<read_first>
- `src/screens/book/BookSessionScreen.tsx` — read the `if (next === 'read')` block in `handleSwitchMode` (around lines 254–270)
</read_first>

<action>
Add a clarifying comment above the `if (audioPos > 0)` guard:

BEFORE:
```typescript
if (audioPos > 0) {
  const audioChIdx = audioChapters.reduce(
```

AFTER:
```typescript
// Only sync reader if audio has actually played. If the user switched to
// audio but didn't listen (audioPos=0), the reader stays at its current
// page — which is correct because Bug 1 fix ensures pendingCfi is cleared.
if (audioPos > 0) {
  const audioChIdx = audioChapters.reduce(
```
</action>

<acceptance_criteria>
- `src/screens/book/BookSessionScreen.tsx` contains the comment `// Only sync reader if audio has actually played` above the `if (audioPos > 0)` guard
- No logic changes to the listen→read branch
- The `syncToAudio` call is unchanged
</acceptance_criteria>

---

## Verification

```bash
# Confirm pendingCfi fix is present
grep -n "setPendingCfi(null)" src/components/book/ReaderView.tsx

# Confirm getLastKnownPosition fallback is in handleSwitchMode
grep -n "getLastKnownPosition" src/screens/book/BookSessionScreen.tsx

# Confirm snap-save before mode switch
grep -n "snapPos" src/screens/book/BookSessionScreen.tsx

# Confirm no syntax errors (TypeScript)
npx tsc --noEmit 2>&1 | head -30
```
