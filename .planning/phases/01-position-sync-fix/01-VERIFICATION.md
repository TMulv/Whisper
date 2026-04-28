# Phase 01 Verification

**Status:** Passed (log-verified on Android, 2026-04-28)

---

## Acceptance criteria checks

```bash
# Task 1 — clear pendingCfi on user-driven nav inside handlePositionChange
grep -n "setPendingCfi(null)" src/components/book/ReaderView.tsx
# Expected: line inside handlePositionChange (not just resumeFromAudio path or locationsReady effect)
# Result: line 408 — inside `if (pendingCfi) { if (programmatic) return; setPendingCfi(null); }`  ✅

# Task 2 — getLastKnownPosition fallback in handleSwitchMode
grep -n "getLastKnownPosition" src/screens/book/BookSessionScreen.tsx
# Expected: appears inside if (next === 'listen') branch
# Result: lines 187 (snapPos), 201 (epubPos fallback)  ✅

# Task 3 — synchronous snapPos flush before async work
grep -n "snapPos" src/screens/book/BookSessionScreen.tsx
# Expected: AsyncStorage.setItem using getLastKnownPosition() before getCurrentPosition() await
# Result: lines 187-192  ✅

# Task 4 — clarifying comment on audioPos > 0 guard
grep -n "Only sync reader" src/screens/book/BookSessionScreen.tsx
# Result: line 272  ✅

# No console.log debris
grep -rn "console\.log" src/components/book/ReaderView.tsx src/hooks/useEpubPosition.ts src/screens/book/BookSessionScreen.tsx
# Result: (no output)  ✅
```

---

## Log-based verification (Android device, 2026-04-28)

**Test:** cold-open a book with a mid-book saved CFI, switch to listen, back out,
reopen multiple times.

**Key observations:**

1. Zero `saved epub pos` lines appeared between `loaded saved epub pos` and
   `goTo pendingCfi` across all sessions — gate blocked the debounced save. ✅

2. `beforeRemove epubPos (null) undefined` appeared every time the user backed
   out during the pre-restore window — livePositionRef stayed null, AsyncStorage
   untouched. ✅

3. After audio-resume (`resumeFromAudio=true`) navigated the reader to the
   audio-derived position, a genuine save fired and persisted the correct CFI.
   Subsequent cold-opens loaded that same CFI. ✅

4. Multiple consecutive open→back-out cycles preserved the same saved CFI
   without drift. ✅

---

## Known limitations / follow-ups

- **AppState write** during pre-restore is gated on `pendingCfiRef`. The async
  `getCurrentPosition()` round-trip inside that handler could theoretically race
  if the user very quickly backgrounds and foregrounds. Low-probability; tracked
  as a future hardening item.

- **read→listen `livePercent: undefined`** in `prepareBookForPlayback` logs when
  called from `handleSwitchMode` (the snap-save + fallback path is used, not the
  live `getCurrentPosition()` result). This is expected and correct — `livePercent`
  is populated only when called directly from the reader's live position.

- **pendingCfi-not-cleared on user nav** was exercised by log inspection but not
  directly by a "page forward then trigger locationsReady" test. The path is
  correctly implemented; a dedicated test case would close the gap.
