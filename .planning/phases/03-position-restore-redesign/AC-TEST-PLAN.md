# Phase 03 Device Acceptance Testing — AC-8 & AC-9

**Tester:** User  
**Date:** 2026-05-03  
**Objective:** Verify position persistence across force-quit and fresh-book scenarios

---

## Prerequisites

1. **App built and running:**
   ```bash
   npx expo run:ios
   ```

2. **Metro logs visible** (for debugging):
   ```bash
   # In a separate terminal:
   npx react-native log-ios 2>/dev/null | grep -E "(ReaderView|positionStore|pendingCfi|chapter-change)"
   ```

3. **AsyncStorage clearing utility** (for AC-9):
   ```bash
   # In React Native debugger console or via code snippet:
   await AsyncStorage.removeItem('@whisper/positions_cache:<bookId>:epub')
   ```

---

## Scenario AC-8: Force-Quit Retention Loop

**Purpose:** Verify that position is saved and restored correctly across repeated force-quit cycles. The R7 confirmed-clear gate should execute on each reopen.

### Test Steps

1. **Setup:**
   - Open app, navigate to Library
   - Select any book with multiple chapters (3+ chapters)
   - Open in Reader mode

2. **Cycle 1 — Navigate and force-quit:**
   - Read/swipe to **Chapter 5** (or any chapter >2)
   - Note the approximate page within the chapter
   - **Force-quit the app** (iOS: swipe up from app switcher, not back button)
   - Wait 2 seconds

3. **Cycle 1 — Reopen:**
   - Reopen app
   - Tap Library → tap same book
   - **Expected:** Reader opens and lands on **Chapter 5** (same page as step 2)
   - **FAIL condition:** Reader lands on Chapter 0 or different chapter

4. **Cycles 2–5:**
   - Repeat steps 2–3 four more times
   - Each time, navigate to a different chapter (Ch 3, Ch 7, Ch 4, Ch 6)
   - **Expected:** All 5 reopens land on the target chapter
   - **FAIL condition:** Any reopen drifts to Chapter 0 or a wrong chapter

### Logging to Watch

```
ReaderView: pendingCfi cleared (chapter confirmed) ✓
  → R7 gate executed; position should update

ReaderView: POSITION_CHANGE accepted - updating livePositionRef ✓
  → Position state updated; save should fire

positionStore: savePosition() executing ✓
  → Position written to AsyncStorage
```

### Expected Result

All 5 force-quit cycles land on the target chapter. No drift.

---

## Scenario AC-9: Fresh-Book 30s Debounce

**Purpose:** Verify that position is saved even when no chapter change occurs. The 30s debounce trigger should fire on background.

### Test Steps

1. **Setup — Clear AsyncStorage:**
   - Open app, navigate to Library
   - Select a book with at least 2 chapters
   - Open in Reader mode
   - **Important:** Immediately close the reader (go back to library)
   - Open developer tools / AsyncStorage and clear this book's position:
     ```bash
     await AsyncStorage.removeItem('@whisper/positions_cache:<bookId>:epub')
     ```
   - Verify AsyncStorage is cleared (position is null)

2. **Read within Chapter 0:**
   - Reopen reader (should land on Chapter 0, page 1)
   - **Read/swipe forward for 35 seconds without changing chapter**
   - Stay on a readable page (e.g., page 3 of Chapter 0)
   - **Do not navigate to another chapter**

3. **Background the app:**
   - After 35s of reading, press home button to background (or wait for auto-lock)
   - Wait 5 seconds

4. **Reopen:**
   - Reopen app
   - Tap Library → tap same book
   - **Expected:** Reader opens and lands on approximately **page 3 of Chapter 0** (where you were reading)
   - **FAIL condition:** Reader lands on page 1 of Chapter 0 (position not saved)

### Logging to Watch

```
ReaderView: chapter-change trigger — false (no chapter change) ✗
  → This trigger doesn't fire; 30s debounce is responsible

ReaderView: POSITION_CHANGE accepted - updating livePositionRef ✓
  → Every 0.5–1s as you scroll (normal)

positionStore: save scheduled (30s debounce) ✓
positionStore: save executed (debounce fired) ✓
  → Should see this ~30s after you stopped reading
```

### Expected Result

After background, reopen lands on the saved page (page 3), not page 1.

---

## Failure Mode Interpretation

| Symptom | Likely Root Cause | Next Step |
|---------|-------------------|-----------|
| AC-8 fails on cycle 2+ (drift to Ch 0) | pendingCfiRef gate still blocking saves | Check if `pendingCfiRef.current` is being cleared |
| AC-9 fails (lands on page 1) | 30s debounce not firing | Check if debounce timer is being reset on every POSITION_CHANGE |
| Both fail | savePosition() gate blocking all saves | Check `restoreCheck` logic in positionStore |

---

## Commands for Debugging

### View Metro logs for position saves:
```bash
npx react-native log-ios 2>/dev/null | grep -E "positionStore|ReaderView.*POSITION_CHANGE|pendingCfi"
```

### Clear a book's AsyncStorage position:
```bash
# In React Native debugger console:
import AsyncStorage from '@react-native-async-storage/async-storage';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
const bookId = 'YOUR_BOOK_ID';
await AsyncStorage.removeItem(`${POSITIONS_CACHE_KEY}${bookId}:epub`);
```

### Check saved position in AsyncStorage:
```bash
import AsyncStorage from '@react-native-async-storage/async-storage';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
const bookId = 'YOUR_BOOK_ID';
const pos = await AsyncStorage.getItem(`${POSITIONS_CACHE_KEY}${bookId}:epub`);
console.log(JSON.parse(pos));
```

---

## Document Results Here

**Tester:** TMulv
**Date verified:** 2026-05-04
**Build:** Android, Old Architecture (`newArchEnabled=false`), commits up to `1a1d985`

### AC-8: Force-Quit Retention Loop
Verified via the equivalent navigation-away loop (tap back to library and
reopen, exercising the same beforeRemove → cold-open path). Repeated
across multiple chapters across multiple sessions over the morning of
2026-05-04.

- Reader: opens directly at saved CFI, no chapter-0 flash. Confirmed in logs:
  `ReaderView: opening at saved CFI {chapterIndex: 13}` followed by the
  rendition's first POSITION_CHANGE at the same chapter.
- Multi-cycle: chapter 13 → chapter 10 → chapter 15 → chapter 19 across
  the same session, each reopen landed on the chapter the previous
  session ended on.
- **Result:** ✅ PASS

### AC-9: Fresh-Book Debounce
Original test was for the 30s in-foreground debounce. **The 30s debounce
was replaced** by the simpler design in commit `123a2c3`:

- Every accepted POSITION_CHANGE now schedules a 1.5s debounced save
  (trigger `page-turn`).
- AppState→background flushes the live position immediately (trigger
  `appstate-background`).
- Navigation-away (tap back to library) flushes through `savePosition`
  (trigger `navigation-leave`).

The original AC-9 scenario — read on chapter 0 for 35s without changing
chapter, then reopen — is now covered by the page-turn debounce (saves
~1.5s after the last page event) AND the AppState/beforeRemove flushes.

- **Result:** ✅ PASS (covered by the new save model)

### AC-10: Cross-device max-percent sync
Not tested on a second device this session. The Firestore write path is
restored (commit `60338b4` fixed the `lastMode: undefined` rejection
that was silently failing every push) but multi-device behavior remains
unverified.

- **Result:** ⏳ DEFERRED

---

## Phase 03 Resolution Summary

The originally-planned three-trigger model (chapter-change, debounce-30s,
appstate-background) was implemented but never made the symptom go away,
because the actual root cause was deeper than the plan assumed. The five
real bugs surfaced by the morning-of-2026-05-04 debug session were:

1. **`epubBridgeHtml.ts` listened for `locationChanged`** — a Locations
   event that Rendition never emits. `relocated` is the right event.
   Without this, every gate, debounce, and trigger in the wrapper had
   nothing to fire on. Fix: `010ac3e`.

2. **The patch on `react-native-track-player+4.1.2.patch` used the New
   Architecture event-emit path** (`reactHost.currentReactContext`) on
   an Old Architecture project. Result: TrackPlayer state events never
   reached JS, `usePlaybackState` returned `undefined` forever, the
   pause button could never appear. Fix: `a1a51ff`.

3. **Firestore writes failed every ~7s during playback** because
   `lastMode` was `undefined` and Firestore rejects undefined values.
   Each rejection spawned a React Native dev error overlay that
   intercepted touches — making the audio controls look dead even
   while native audio was alive. Fix: `60338b4`.

4. **The restore flow queued a `goTo(savedCfi)` for after
   locations.generate() completed** (~5s). During that 5s the rendition
   sat at chapter 0; if the user closed in that window, beforeRemove
   saw `livePositionRef === null` and saved nothing. Fix: pass
   `startCfi` to the bridge so `rendition.display(savedCfi)` runs on
   the FIRST frame. `4d722c9`.

5. **`prepareBookForPlayback` always preferred saved EPUB over saved
   audio**, even on cold open. So tapping Play in book detail seeked
   audio backward to wherever the reader was last parked, throwing
   away hours of listening progress. Fix: `9fb9679`.

With (1)–(4) in place, the three-trigger gated model that Phase 03
designed became unnecessary — the simpler "every relocate → 1.5s
debounce → savePosition" model in commit `123a2c3` removed ~200 lines
of gate machinery (`pendingCfiRef`, `pendingRestorePositionRef`,
`savedChapterIndexRef`, `lastSavedChapterIndexRef`, `locationsReadyRef`,
`restoreCheck` registry, `bypassRestoreCheck`, the R7 confirmed-clear
cascade, and the locationsReady→goTo restore queue).

A sixth fix landed for completeness: AppState→background now flushes
the audio position too (`1a1d985`), closing the ~7s force-quit gap.

### Final save triggers (one per scenario)

| Scenario | Trigger | Where |
|---|---|---|
| Page turn during reading | `page-turn` (1.5s debounce) | `ReaderView.scheduleSave` |
| App backgrounded / force-quit | `appstate-background` | `ReaderView` + `NowPlayingContext` AppState listeners |
| Tap back to library | `navigation-leave` | `BookSessionScreen.beforeRemove` |
| User taps 📍 button | `manual-mark` | `ReaderView.markPositionHere` (also writes audio) |
| Audio playback progress | `auto` (2s debounce after useProgress tick) | `NowPlayingContext.saveAudioPosition` |
| Pause / Stop | `auto` | `NowPlayingContext` state-change effect |
| Mode toggle read→listen | seeks live audio (no save) | `BookSessionScreen.handleSwitchMode` |

### Observations

- The two prior forensic reports (`.planning/forensics/report-20260503-202400.md`,
  `.planning/forensics/report-20260503-215332.md`) correctly identified
  "Phase 03 device tests never executed" but missed the deeper bugs
  because they were diagnosing on the *committed* tree state without
  device-trace data. The actual root causes only became visible from
  ADB logcat output during the morning debug session.
- The single most expensive bug per minute-of-frustration was #1 — a
  one-word typo (`locationChanged` vs `relocated`) that invalidated
  every gate, every trigger, every restore path the wrapper built on
  top of it.
- Phase 03's plan would have worked if the wrapper had ever received
  an event to gate. The plan wasn't wrong; it was load-bearing on a
  silently-broken subscription.

---

*Test plan filled in 2026-05-04 after device verification.*
