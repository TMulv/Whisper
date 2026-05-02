# Phase 03 Fixes Summary

**Phase:** Position Restore Redesign  
**Status:** Testing in progress  
**Generated:** 2026-05-01

---

## Overview

This document tracks all fixes attempted during Phase 03 device testing, including their rationale, status, and learnings.

---

## Fix 1: Create transcriptionProgress.ts stub

**Commit:** Early in session  
**Category:** Bundling blocker

### Problem
- `BookDetailScreen.tsx` imports `watchTranscriptionProgress` from `src/services/sync/transcriptionProgress.ts`
- File didn't exist (part of stashed AAI refactor)
- Metro bundler fails to resolve the import

### Fix
Created minimal stub file:
```typescript
import { logger } from '@/utils/logger';
import type { TranscriptionStatus } from '@/types/sync';

export function watchTranscriptionProgress(
  bookId: string,
  callback: (status: TranscriptionStatus) => void,
): () => void {
  logger.debug('transcriptionProgress: stub watcher started', { bookId });
  return () => {
    logger.debug('transcriptionProgress: stub watcher stopped', { bookId });
  };
}
```

### Status
✅ **Resolved** — Unblocked bundling, comment notes this should be replaced when AAI refactor is restored from stash

### Learning
Stubs are acceptable for Phase 03 since the AAI integration is deferred. Allows bundling to proceed without derailing the position-restore focus.

---

## Fix 2: Add TranscriptionStatus type definition

**Commit:** Early in session  
**Category:** Type resolution

### Problem
- `src/types/sync.ts` was missing `TranscriptionStatus` type export
- `BookDetailScreen.tsx` and `transcriptionProgress.ts` both import it
- TypeScript compilation fails with "Cannot find name TranscriptionStatus"

### Fix
Added type definition to end of `src/types/sync.ts`:
```typescript
export type TranscriptionStatus = {
  progress?: number;
  status?: string;
};
```

### Status
✅ **Resolved** — Type imports now resolve correctly

### Learning
The placeholder type is intentionally minimal (matching the stub). Real implementation will come with AAI refactor restoration.

---

## Fix 3: Clear pendingRestorePositionRef before early return (CRITICAL)

**Commit:** `06a6c7e` — "fix(position): clear pendingRestorePositionRef before early return to unblock subsequent events"  
**Category:** Position restoration logic (core Phase 03 feature)

### Problem
**Symptom:** User navigates to new chapter → exits reader → reopens → positioned at original chapter (fix not saved)

**Root Cause:** In `handlePositionChange` (ReaderView.tsx lines 563-569), when the restore-goTo response arrives:
1. The response has `programmatic=true` (it's from our goTo call, not user interaction)
2. There's a gate that checks: `if (programmatic && pendingRestorePositionRef.current !== null)`
3. The gate returns early to prevent the restore response from overwriting `livePositionRef` (correct behavior)
4. **BUG:** The function returns early WITHOUT clearing `pendingRestorePositionRef`
5. This flag is never cleared, so ALL subsequent programmatic events are also blocked
6. When user navigates to chapter 5, the gate still applies → early return → no save

### Fix
Added one line before the early return (line 569):
```typescript
if (programmatic && pendingRestorePositionRef.current !== null) {
  logger.debug('ReaderView: POSITION_CHANGE accepted (restore-goTo echo, livePositionRef held)', {
    cfi: position.cfi,
  });
  setCurrentChapterIndex(position.chapterIndex);
  setFromBridge(position);
  pendingRestorePositionRef.current = null;  // ← Added this line
  return;
}
```

### Status
🧪 **Testing** — Fix is committed and ready for user testing

### Expected Outcome
1. App restores to chapter 0 (save from previous session) ✓
2. User navigates to chapter 5
3. Chapter-change trigger fires → `persistNow('chapter-change')` called
4. Position saves to AsyncStorage
5. User exits reader
6. User reopens → restores to chapter 5 ✓

### Verification Steps
- Open app (restores to previous position)
- Navigate to different chapter
- Exit reader completely
- Reopen reader → should restore to new chapter

### Learning
**Critical insight:** The early-return gate was designed only for the restore-goTo response (first programmatic event), but without clearing the flag, it was blocking all subsequent events. The fix is surgical: clear the flag before returning so the gate doesn't apply to later events.

The design intent was preserved:
- Restore-goTo response still doesn't update `livePositionRef` (returns early) ✓
- Subsequent events are no longer blocked (flag is cleared) ✓
- User navigation triggers chapter-change save ✓

---

## Fix 4: Add debug logging for trace visibility

**Commit:** `06a6c7e` (same as Fix 3)  
**Category:** Observability

### Changes Made

**In ReaderView.tsx (handlePositionChange):**
- Log `pendingCfiRef` state when POSITION_CHANGE is accepted (line 572-577)
- Log chapter-change trigger conditions (line 618-624)
- Log when chapter-change trigger actually fires (line 626-628)

**In positionStore.ts (savePosition):**
- Change restore gate skip from debug to warn level (more visible)
- Include `chapterIndex` in log so we can see what was blocked

### Status
✅ **Implemented** — Logs help trace execution during testing

### How to View Logs
```bash
npx react-native log-ios 2>/dev/null | grep -E "(pendingCfi|persistNow|chapter-change|positionStore)"
```

Or in Xcode: **Window** → **Devices and Simulators** → select simulator → **Open Console**

---

## Summary Table

| Fix | Category | Status | Impact |
|-----|----------|--------|--------|
| transcriptionProgress stub | Bundling | ✅ Done | Unblocks Metro |
| TranscriptionStatus type | Types | ✅ Done | Unblocks imports |
| pendingRestorePositionRef clear | Core logic | 🧪 Testing | **Fixes position save bug** |
| Debug logging | Observability | ✅ Done | Enables tracing |

---

## What We Know Works

✅ App launches without crashes  
✅ Bundler resolves all imports  
✅ App opens to library screen  
✅ Reader loads and renders EPUB  
✅ Position restores from previous session (test: open → navigate → close → reopen)  

## What We're Testing

🧪 **Does position save on chapter navigation?**
- Navigate to new chapter
- Exit reader
- Reopen — should restore to new chapter (not original)
- **Expected:** Chapter 5 appears  
- **Bug symptom:** Chapter 0 appears instead

## Next Steps

1. User tests Fix 3 by reproducing the scenario
2. Watch debug logs for execution flow
3. If test passes: run AC acceptance criteria (AC-5, AC-8, AC-9, AC-10)
4. If test fails: investigate why chapter-change trigger isn't firing or save is being gated
5. Once device testing passes: run `/review` for cross-AI peer review
6. Write `03-SUMMARY.md` and close Phase 03
