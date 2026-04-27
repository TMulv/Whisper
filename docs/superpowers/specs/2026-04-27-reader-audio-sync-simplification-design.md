# Reader ↔ Audio Sync Simplification

**Date:** 2026-04-27
**Status:** Approved

## Problem

The current reader→audio position sync relies on:
- Continuous polling of `currentLocation()` every 2.5 s
- React `livePosition` state updated via POSITION_CHANGE events
- A deferred `locationsReady` effect that fires audio start
- A `pendingAudioStartRef` to coordinate the deferral
- `useImmersionReading` driving a 500 ms page-follow loop

This chain has proven brittle: `livePercent: undefined` in closure captures, `locationChanged` firing with empty CFIs on Android, and the immersion loop adding complexity with no current test coverage. The result is audio starting at the wrong position and hard-to-diagnose timing bugs.

## Decision

1. **Remove immersion mode** (page-follows-audio auto-scroll) entirely.
2. **Replace polling + livePosition chain** with two automatic fire-and-forget `getCurrentPosition()` saves: on reader close and on app background.
3. **`handleStartAudio` reads directly from AsyncStorage** — no deferral, no livePosition, no locationsReady check.
4. **Add an optional "Pin position" button** as a manual trigger of the same save path, for precision.

## Architecture

### New bridge command — `getCurrentPosition(requestId)`

Same request-response pattern as `getChapterText`. RN injects a call with a `requestId`; the bridge calls `currentLocation()` synchronously and posts `POSITION_RESULT` back; EpubWebView resolves the pending Promise.

```
RN                           Bridge (WebView)
 │                               │
 │─ inject getCurrentPosition ──▶│
 │                               │ currentLocation() → cfi, percentComplete
 │◀─ POSITION_RESULT ────────────│
 │ resolve Promise               │
```

Returns `EpubPosition` or rejects on timeout (3 000 ms default).

### Storage — one key, one save path

**Key:** `${POSITIONS_CACHE_KEY}:${bookId}:epub` (existing auto-save key)

**Writers (in priority order of freshness):**
| Trigger | Mechanism | Notes |
|---------|-----------|-------|
| User taps "Pin position" | `getCurrentPosition()` → `setItem` | Most precise — exact current page |
| Reader close | `beforeRemove` listener → `getCurrentPosition()` → `setItem` (fire-and-forget) | Captures where they actually were |
| App background | `AppState` change listener → `getCurrentPosition()` → `setItem` (fire-and-forget) | Catches "switch directly to audio player" |
| LOCATIONS_READY | `useEpubPosition` debounce write (existing, no change) | Safety net if bridge doesn't respond |

**Reader:** `handleStartAudio` reads the key once, falls back to `startTimestamp = 0`.

### `handleStartAudio` — simplified

```
1. setStartingAudio(true)
2. savedPos = AsyncStorage.getItem(epub key)
3. epubPos = savedPos if percentComplete > 0 or cfi non-empty, else null
4. prepareBookForPlayback(userId, bookId, epubPos ?? undefined)
   └─ readerToAudio(epubPos, alignment) → startTimestamp (or 0)
5. startPlayback(book, chapters, startTimestamp)
6. setStartingAudio(false)
```

No `locationsReady` check. No `pendingAudioStartRef`. No deferred effect. No `livePosition`.

### "Pin position" button

- Lives in ReaderDrawer Audio tab, below AudioTransport / "Start audiobook" button
- Disabled + caption "Still loading pages…" until `locationsReady`
- Enabled label: "📍 Pin position for audio"
- On tap: `getCurrentPosition()` → writes same epub key → shows "Position saved" toast
- Caption when valid save exists: "Auto-saved ~2 min ago" (derived from a `lastSavedAt` timestamp stored alongside the position, or just "Position saved" if set this session)

## What Gets Removed

### `useImmersionReading.ts`
Delete entirely. Drove the 500 ms page-follow loop, chapter-switch scroll, and paragraph highlight. Nothing else references it after this change.

### From `ReaderScreen.tsx`
- `immersionActive`, `immersionRate` state + all setters
- `useImmersionReading(...)` call and all `immersion.*` references
- `pendingAudioStartRef`
- Deferred `locationsReady` useEffect (the "fire audio start when ready" effect)
- `setImmersionActive(true)` after starting audio
- `livePosition` only used for passing into `prepareBookForPlayback` — replaced by AsyncStorage read in `handleStartAudio`

### From `ReaderDrawer.tsx`
- `immersionActive`, `onImmersionToggle` props
- `playbackRate`, `onRateChange` props
- Immersion toggle switch in Audio tab UI
- Rate picker UI

### From `EpubWebView.tsx` + bridge
- `scrollToBookPercent`, `highlightProgress`, `clearHighlight`, `seekToPercent` from `EpubWebViewRef`
- Corresponding `JS_SCROLL_TO_BOOK_PERCENT`, `JS_HIGHLIGHT_PROGRESS`, `JS_CLEAR_HIGHLIGHT`, `JS_SEEK_TO_PERCENT` from `epubInjection.ts`
- Corresponding implementations in `epubBridgeHtml.ts`
- The 2.5 s polling `setInterval` added in the previous fix (replaced by event-driven saves)

## What Stays

- `locationsReady` state in ReaderScreen — still used to gate the "Pin position" button and show "Finding your position…" hint in the drawer
- `useEpubPosition` hook — its debounced LOCATIONS_READY write remains the last-resort safety net
- `useNowPlaying` usage in ReaderScreen — audio controls (play/pause, chapter display) still come from here, passed to ReaderDrawer as before
- `AudioTransport` component in ReaderDrawer — play/pause, scrubber, chapter name

## File Inventory

| File | Change |
|------|--------|
| `src/hooks/useImmersionReading.ts` | **Delete** |
| `src/constants/epubBridgeHtml.ts` | Remove poll interval; add `getCurrentPosition` command; remove `scrollToBookPercent`, `highlightProgress`, `clearHighlight`, `seekToPercent` implementations |
| `src/constants/epubInjection.ts` | Remove `JS_SCROLL_TO_BOOK_PERCENT`, `JS_HIGHLIGHT_PROGRESS`, `JS_CLEAR_HIGHLIGHT`, `JS_SEEK_TO_PERCENT` |
| `src/components/reader/EpubWebView.tsx` | Add `getCurrentPosition()` to ref + `POSITION_RESULT` handler + `pendingPositionRequestsRef`; remove 4 imperative methods |
| `src/screens/reader/ReaderScreen.tsx` | Remove immersion state/effects/refs; simplify `handleStartAudio`; add `beforeRemove` + `AppState` listeners; add `handlePinPosition` + `bookmarkSaved` toast |
| `src/components/reader/ReaderDrawer.tsx` | Remove immersion props; add "Pin position" button + toast |

## Edge Cases

| Case | Outcome |
|------|---------|
| First ever session, no saved position | `startTimestamp = 0` — correct, start from beginning |
| User closes reader before `locationsReady` | LOCATIONS_READY write fires when locations complete; `beforeRemove` may have no position yet — graceful fallback to 0 |
| Bridge doesn't respond before WebView unmounts | Fire-and-forget rejects silently; LOCATIONS_READY write is safety net |
| User taps "Pin position" before `locationsReady` | Button disabled, not reachable |
| User taps Start Audio with no saved position | Starts from beginning — acceptable first-time behavior |
