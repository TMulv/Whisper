# Audio Start Position Fix

**Date:** 2026-04-24
**Status:** Approved

## Problem

When a user is reading in chapter 2 and taps "Start Audio," audio always starts at position 0 instead of the current reading position.

## Root Cause

`useEpubPosition.onPositionChange` writes every position to AsyncStorage via a debounce timer. When the reader opens and navigates programmatically to the saved position, epub.js fires `locationChanged` immediately — but `percentComplete` is `0` because `locations.generate()` hasn't completed yet. After the debounce fires (~500 ms), this zero-percent position is written to AsyncStorage, **overwriting the good saved position from the previous session**.

Later, when the user taps "Start Audio":
1. `handleStartAudio` defers until `locationsReady`.
2. `LOCATIONS_READY` fires. If epub.js's `currentLocation()` returned null (a known race), it sends an empty CFI — `EpubWebView` skips calling `onPositionChange`, so `livePosition.percentComplete` stays 0.
3. `prepareBookForPlayback` tries its `savedPos` fallback: loads from AsyncStorage, finds `percentComplete: 0` (overwritten in step above), fallback does nothing.
4. `readerToAudio` receives `percentComplete: 0` → returns `timestampSeconds: 0`.

All other sync infrastructure (pre-L0 `chapterFraction` tier, `LOCATIONS_READY` deferred start, `savedPos` fallback in `prepareBookForPlayback`) is correct — it had no good data to work with.

## Fix

**One guard in `src/hooks/useEpubPosition.ts`**, inside the debounce callback, before the `AsyncStorage.setItem` call:

```ts
if (newPosition.percentComplete === 0) return;
```

This skips persisting transient zero-percent positions to disk. `setPosition(newPosition)` above it is unchanged — React state (`livePosition`) still updates live. Only the disk write is suppressed when `percentComplete` is 0.

### Why this is sufficient

- `savedPos` in AsyncStorage now always holds the last position with a real book-wide percent — either from this session (after locations generated) or the previous session.
- `prepareBookForPlayback`'s existing savedPos fallback (checks same chapter + `percentComplete > 0`) finds a valid position and applies it.
- Once `LOCATIONS_READY` fires with a valid CFI, `livePosition` gets accurate `percentComplete` and the next debounce write stores it correctly. If LOCATIONS_READY fires with an empty CFI, savedPos carries the previous session's position — still correct.

### Edge cases

| Case | Outcome |
|------|---------|
| Brand-new book, no prior session | `savedPos` is null, `percentComplete` stays 0, `prepareBookForPlayback` returns `startTimestamp = 0` — audio starts at beginning ✓ |
| User taps Start Audio before locations ready, then locations arrive with valid CFI | Deferred effect uses `livePosition.percentComplete` (accurate) ✓ |
| User taps Start Audio before locations ready, LOCATIONS_READY has empty CFI | Deferred effect falls back to `savedPos` (preserved) ✓ |
| User manually scrolls before locations ready | Positions with `percentComplete = 0` not persisted; savedPos holds last-good position. Worst case: audio starts at previous session position, off by a few pages. Acceptable. |
| User at genuine 0% (very start of book) | `percentComplete = 0` → not written. Correct: `startTimestamp = 0` is right for the very start. |

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useEpubPosition.ts` | Skip `AsyncStorage.setItem` when `newPosition.percentComplete === 0` |

## What Does NOT Change

- `src/constants/epubBridgeHtml.ts` — bridge already sends `chapterFraction` correctly
- `src/services/sync/handoff.ts` — pre-L0 tier is correct
- `src/screens/reader/ReaderScreen.tsx` — deferred audio start logic is correct
- `src/services/audio/prepareBookForPlayback.ts` — savedPos fallback is correct
