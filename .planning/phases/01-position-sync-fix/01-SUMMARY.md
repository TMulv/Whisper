# Phase 01 Summary — Fix reader/audio position sync across mode switches

**Status:** Complete
**Commits:** 660a538, 95a7efe
**Files changed:** `src/components/book/ReaderView.tsx`, `src/screens/book/BookSessionScreen.tsx`, `src/hooks/useEpubPosition.ts`

---

## What was built

Three linked bugs caused epub position restore to silently fail and read→listen
mode-switch to start audio from the beginning instead of the reader's current
page.

### Root cause (discovered via forensics + log tracing)

The fundamental invariant that was broken: **a saved CFI must survive the period
between bridge-ready and locationsReady → goTo(pendingCfi).** During that window
(3-30 s on real hardware while epub.js runs `locations.generate()`), the WebView
emits POSITION_CHANGE events for its initial render at chapter-0 and for the
LOCATIONS_READY synthetic position. Three save paths were writing those transient
values over the prior session's saved CFI before the restore could run.

Additionally, `handleSwitchMode('listen')` relied on an async `getCurrentPosition()`
bridge call that returns empty/null before `locations.generate()` completes —
causing audio to fall back to a stale or zero-start position.

### Fix 1 — Gate all saves during the pre-restore window (95a7efe)

`handlePositionChange` now gates on `pendingCfi`:
- `programmatic:true` while pendingCfi is set → discard entirely (initial
  render and LOCATIONS_READY synthetic cannot clobber `livePositionRef` or
  trigger the debounced AsyncStorage write)
- `programmatic:false` while pendingCfi is set → user navigated manually;
  clear pendingCfi and fall through so the user's position wins and
  `locationsReady` no longer snaps them back

The AppState background-save handler also reads `pendingCfiRef` and skips when
a restore is pending.

`beforeRemove` in `BookSessionScreen` already guarded on `epubPos?.cfi` — with
`livePositionRef` staying null during pre-restore, that guard now correctly skips
the save without any change to BookSessionScreen's beforeRemove logic.

### Fix 2 — read→listen handoff uses synchronous position (95a7efe)

`handleSwitchMode('listen')` now:
1. Flushes `getLastKnownPosition()` to AsyncStorage synchronously before any
   async work, so `prepareBookForPlayback`'s AsyncStorage fallback is always fresh
2. Falls back to `getLastKnownPosition()` when `getCurrentPosition()` returns
   empty — ensures audio starts from the reader's current page even when the
   bridge hasn't finished generating locations

### Fix 3 — Save guard changed from percentComplete to CFI (660a538)

The debounced save in `useEpubPosition` previously guarded on
`percentComplete === 0`, which silently discarded every position until
`locations.generate()` completed. Changed to `!cfi` so positions persist on
the first page render. This was landed separately and then hardened by Fix 1
which prevented the initial-render CFI from clobbering the saved value.

---

## What was NOT changed

- Alignment / handoff logic (`handoff.ts`, `alignmentStore.ts`)
- AsyncStorage key schema
- `useSync` / Firestore push path
- Any new files created

---

## Forensic artefact

Full root-cause trace in `.planning/forensics/report-20260428-132126.md`.
