---
wave: 1
depends_on: []
files_modified:
  - src/services/storage/positionStore.ts
  - src/services/storage/__tests__/positionStore.test.ts
  - src/services/sync/syncEngine.ts
  - src/hooks/useEpubPosition.ts
  - src/components/book/ReaderView.tsx
  - src/screens/book/BookSessionScreen.tsx
  - src/components/reader/EpubWebView.tsx
autonomous: true
requirements:
  - R1-single-writer
  - R2-three-triggers
  - R3-beforeRemove-reads-only
  - R4-sync-cold-open-read
  - R5-max-percent-conflict
  - R6-drop-programmatic-flag-as-save-gate
  - R7-pendingCfi-confirmed-clear
---

# Plan 03 — Position-restore redesign (single-writer model)

## Objective

Implement the SPEC.md design: replace the four-writer / three-gate EPUB
position-restore architecture with a single `positionStore` module driven by
exactly three triggers. Eliminate the race classes that produced the
post-Phase-01 stuck-loop of `fix(position):` commits. Preserve the existing
AsyncStorage key (`@whisper/positions_cache:${bookId}:epub`) and Firestore
schema — zero migration risk.

**Locked decisions are in `03-SPEC.md` (R1–R7) and `03-CONTEXT.md` (D-G1
through D-G5). Read both before touching code.** This plan tells the executor
*how* to land those decisions; it does not relitigate them.

## must_haves

```yaml
truths:
  - exactly one AsyncStorage write site for the EPUB position key
  - exactly one pushPosition call site (inside positionStore)
  - savePosition is called from exactly three triggers, each with a comment naming the trigger
  - savePosition no-ops while pendingCfiRef.current is non-null
  - resolvePosition returns 'local' or 'remote' only — no 'prompt' branch
  - useEpubPosition exposes only state-holder functions (no AsyncStorage, no pushPosition, no debounce timer)
  - chapter-drawer goToChapter calls clear pendingCfi synchronously before WebView dispatch
  - existing on-disk @whisper/positions_cache:${bookId}:epub values continue to load
  - audio position code paths (`:audio` key, NowPlayingContext, prepareBookForPlayback) are unchanged
  - epubBridgeHtml.ts is not modified
```

---

## Task 1 — Create `positionStore.ts`

**Goal:** A single module that owns all EPUB position writes (local + remote)
and reads (with in-memory cache). Exposes a small, testable API.

<read_first>
- `.planning/phases/03-position-restore-redesign/03-SPEC.md` — locked requirements (R1, R2, R3, R5)
- `.planning/phases/03-position-restore-redesign/03-CONTEXT.md` — D-G1, D-G3, D-G5
- `src/types/position.ts` — `EpubPosition`, `SyncedPosition`, `PositionConflict` shapes
- `src/types/firebase.ts` — `FirestorePosition`
- `src/constants/config.ts` — confirm `POSITIONS_CACHE_KEY` value (`@whisper/positions_cache`)
- `src/services/sync/syncEngine.ts` — current `pushPosition` signature (do NOT modify yet, called from positionStore)
- `src/utils/logger.ts` — log API used elsewhere
</read_first>

<action>
Create `src/services/storage/positionStore.ts` with this exact public API:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { POSITIONS_CACHE_KEY } from '@/constants/config';
import { pushPosition } from '@/services/sync/syncEngine';
import type { EpubPosition, SyncedPosition } from '@/types/position';
import { logger } from '@/utils/logger';

export type EpubLastPosition = {
  cfi: string;
  chapterIndex: number;
  charOffset: number;
  percentComplete: number;
  updatedAt: number;
};

type RestoreCheck = () => boolean;

const memoryCache = new Map<string, EpubLastPosition>();
const restoreChecks = new Map<string, RestoreCheck>();

const epubKey = (bookId: string) => `${POSITIONS_CACHE_KEY}:${bookId}:epub`;

/**
 * Register a function that returns true while a CFI restore is in progress
 * for the given book. While that returns true, savePosition no-ops to prevent
 * clobbering the saved CFI with the bridge's transient initial-render position.
 *
 * Pass a function that reads `pendingCfiRef.current !== null` from ReaderView.
 * Call `registerRestoreCheck(bookId, null)` on unmount to clear.
 */
export function registerRestoreCheck(
  bookId: string,
  check: RestoreCheck | null,
): void {
  if (check) restoreChecks.set(bookId, check);
  else restoreChecks.delete(bookId);
}

/**
 * Save the EPUB position for a book. Local AsyncStorage write is fire-and-
 * forget; Firestore push is fire-and-forget. Never blocks the caller, never
 * throws.
 *
 * Called by ReaderView from exactly three triggers (see 03-CONTEXT.md D-G2):
 *   - AppState change → 'background' | 'inactive'
 *   - chapter change (chapterIndex !== last saved)
 *   - 30s in-foreground debounce while reading
 *
 * No-ops while a CFI restore is in progress (D-G3) — checked via
 * registerRestoreCheck.
 */
export function savePosition(
  bookId: string,
  pos: EpubLastPosition,
  opts: { userId?: string | null; deviceId?: string | null; trigger: string },
): void {
  const check = restoreChecks.get(bookId);
  if (check && check()) {
    logger.debug('positionStore: save skipped (restore in progress)', {
      bookId,
      trigger: opts.trigger,
    });
    return;
  }
  if (!pos.cfi) {
    logger.debug('positionStore: save skipped (no cfi)', { bookId, trigger: opts.trigger });
    return;
  }

  // Update in-memory cache synchronously so subsequent loads in this session
  // see the freshest value without an AsyncStorage round-trip.
  memoryCache.set(bookId, pos);

  // Local write: fire-and-forget.
  AsyncStorage.setItem(epubKey(bookId), JSON.stringify(pos)).catch((err) => {
    logger.warn('positionStore: local write failed', { bookId, err });
  });

  // Remote push: fire-and-forget. Skip if userId/deviceId not yet available
  // (e.g., signed-out preview).
  if (opts.userId && opts.deviceId) {
    const synced: SyncedPosition = {
      bookId,
      deviceId: opts.deviceId,
      chapterIndex: pos.chapterIndex,
      epubCfi: pos.cfi,
      charOffset: pos.charOffset,
      audioTimestamp: 0,
      percentComplete: pos.percentComplete,
      source: 'epub',
      updatedAt: pos.updatedAt,
    };
    pushPosition(opts.userId, bookId, opts.deviceId, synced).catch((err) => {
      logger.warn('positionStore: remote push failed', { bookId, err });
    });
  }

  logger.debug('positionStore: saved', {
    bookId,
    trigger: opts.trigger,
    chapterIndex: pos.chapterIndex,
    percent: pos.percentComplete,
  });
}

/**
 * Load the EPUB position for a book. Returns null if no value exists.
 * Hits in-memory cache first; falls back to AsyncStorage on cold-open.
 */
export async function loadPosition(bookId: string): Promise<EpubLastPosition | null> {
  const cached = memoryCache.get(bookId);
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(epubKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EpubLastPosition;
    memoryCache.set(bookId, parsed);
    return parsed;
  } catch (err) {
    logger.warn('positionStore: load failed', { bookId, err });
    return null;
  }
}

/**
 * Update the in-memory cache directly (used by useSync when remote wins —
 * keeps cache consistent with the navigation that's about to happen).
 */
export function setCachedPosition(bookId: string, pos: EpubLastPosition): void {
  memoryCache.set(bookId, pos);
}

/**
 * Conflict resolver — max(percentComplete) wins, tiebreaker is local.
 * If either side has zero/missing percent (typical pre-locationsReady stub),
 * local wins by default.
 */
export function resolveByMaxPercent(
  local: EpubLastPosition,
  remote: EpubLastPosition,
): 'local' | 'remote' {
  if (!Number.isFinite(remote.percentComplete) || remote.percentComplete <= 0) {
    return 'local';
  }
  if (!Number.isFinite(local.percentComplete) || local.percentComplete <= 0) {
    return 'remote';
  }
  return remote.percentComplete > local.percentComplete ? 'remote' : 'local';
}

/** Test helper — clears in-memory cache between unit tests. */
export function _resetForTests(): void {
  memoryCache.clear();
  restoreChecks.clear();
}
```

Notes:
- `EpubLastPosition` is intentionally a flatter shape than `EpubPosition` (no
  bridge-specific extras like `cfiBase`). The store works with whatever the
  bridge produces, but we narrow to these 5 fields when persisting.
- `savePosition` accepts `EpubLastPosition` directly — call sites must build
  the object (cheap, type-checked).
- Logging is intentionally `logger.debug` so production logs aren't spammy.
</action>

<acceptance_criteria>
- File exists at `src/services/storage/positionStore.ts`.
- Exports: `savePosition`, `loadPosition`, `setCachedPosition`,
  `resolveByMaxPercent`, `registerRestoreCheck`, `_resetForTests`,
  `EpubLastPosition`.
- `git grep -nE "AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub" src/`
  returns exactly two matches: (a) inside positionStore.ts, (b) inside
  positionStore.test.ts (Task 2). No third match outside this phase's tests.
- `git grep -nE "import .*pushPosition" src/` shows imports only in
  `src/services/storage/positionStore.ts` (positionStore is the only
  non-test importer).
- `npx tsc --noEmit` reports no new errors related to this file.
</acceptance_criteria>

---

## Task 2 — Write `positionStore.test.ts`

**Goal:** Lock the conflict-resolution rule (R5) and the restore-gate behavior
(R7's structural guard from D-G3) in unit tests, satisfying SPEC AC-6.

<read_first>
- `src/services/storage/positionStore.ts` (created in Task 1)
- `.planning/phases/03-position-restore-redesign/03-SPEC.md` AC-6 — exact test cases required
</read_first>

<action>
Create `src/services/storage/__tests__/positionStore.test.ts`:

```typescript
import {
  savePosition,
  loadPosition,
  resolveByMaxPercent,
  registerRestoreCheck,
  setCachedPosition,
  _resetForTests,
  type EpubLastPosition,
} from '../positionStore';

// Mock AsyncStorage with an in-memory shim so tests don't need a runtime.
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
      _reset: () => { store = {}; },
    },
  };
});

jest.mock('@/services/sync/syncEngine', () => ({
  pushPosition: jest.fn(async () => {}),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage').default;

const mkPos = (overrides: Partial<EpubLastPosition> = {}): EpubLastPosition => ({
  cfi: 'epubcfi(/6/4!/4/1:0)',
  chapterIndex: 1,
  charOffset: 0,
  percentComplete: 0.1,
  updatedAt: Date.now(),
  ...overrides,
});

beforeEach(() => {
  _resetForTests();
  AsyncStorage._reset();
});

describe('resolveByMaxPercent', () => {
  // SPEC AC-6 test 1
  it('local 12% vs remote 47% → remote wins', () => {
    const local = mkPos({ percentComplete: 0.12 });
    const remote = mkPos({ percentComplete: 0.47 });
    expect(resolveByMaxPercent(local, remote)).toBe('remote');
  });

  // SPEC AC-6 test 2
  it('local 50% vs remote 5% (stub) → local wins', () => {
    const local = mkPos({ percentComplete: 0.50 });
    const remote = mkPos({ percentComplete: 0.05 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('tiebreaker on equal percent → local wins', () => {
    const local = mkPos({ percentComplete: 0.30 });
    const remote = mkPos({ percentComplete: 0.30 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('remote percent zero/missing → local wins', () => {
    const local = mkPos({ percentComplete: 0.10 });
    const remote = mkPos({ percentComplete: 0 });
    expect(resolveByMaxPercent(local, remote)).toBe('local');
  });

  it('local percent zero, remote populated → remote wins', () => {
    const local = mkPos({ percentComplete: 0 });
    const remote = mkPos({ percentComplete: 0.40 });
    expect(resolveByMaxPercent(local, remote)).toBe('remote');
  });
});

describe('savePosition / loadPosition', () => {
  it('saved position survives a load round-trip', async () => {
    const pos = mkPos({ chapterIndex: 5, percentComplete: 0.3 });
    savePosition('book-A', pos, { userId: null, deviceId: null, trigger: 'test' });
    // Drain the fire-and-forget microtask queue.
    await new Promise((r) => setTimeout(r, 0));
    const loaded = await loadPosition('book-A');
    expect(loaded).toEqual(pos);
  });

  it('save no-ops while restore is in progress', async () => {
    let inRestore = true;
    registerRestoreCheck('book-A', () => inRestore);
    const pos = mkPos({ chapterIndex: 0, cfi: 'epubcfi(/6/2!/4/1:0)' });
    savePosition('book-A', pos, { userId: null, deviceId: null, trigger: 'background' });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    // After restore clears, save fires normally.
    inRestore = false;
    const real = mkPos({ chapterIndex: 5, cfi: 'epubcfi(/6/12!/4/1:0)' });
    savePosition('book-A', real, { userId: null, deviceId: null, trigger: 'chapter-change' });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('save skips when cfi is empty', async () => {
    const pos = mkPos({ cfi: '' });
    savePosition('book-A', pos, { userId: null, deviceId: null, trigger: 'test' });
    await new Promise((r) => setTimeout(r, 0));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('loadPosition returns null when no value stored', async () => {
    expect(await loadPosition('book-empty')).toBeNull();
  });

  it('in-memory cache shortcuts AsyncStorage on second load', async () => {
    const pos = mkPos();
    setCachedPosition('book-A', pos);
    AsyncStorage.getItem.mockClear();
    const loaded = await loadPosition('book-A');
    expect(loaded).toEqual(pos);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});
```

Notes:
- The Jest config is not currently wired into `package.json` — these tests
  won't run via `npm test` until that's set up. SPEC says that's a separate
  follow-up phase. The file is required to exist and to be syntactically
  valid TypeScript.
- The `@/services/sync/syncEngine` mock prevents Firestore client init in
  tests.
</action>

<acceptance_criteria>
- File exists at `src/services/storage/__tests__/positionStore.test.ts`.
- Contains the two SPEC AC-6 test cases verbatim (12% vs 47% → remote;
  50% vs 5% → local).
- `npx tsc --noEmit` reports no errors in this file.
- The file imports only from the public surface of `positionStore.ts`
  (no internal implementation imports).
</acceptance_criteria>

---

## Task 3 — Replace `resolvePosition` with max-percent rule

**Goal:** Implement R5 — `useSync` already calls `resolvePosition`; we change
the resolver's rule and remove the `'prompt'` branch.

<read_first>
- `src/services/sync/syncEngine.ts` (lines 1–55, current implementation)
- `src/types/position.ts` — `SyncedPosition`, `PositionConflict` shapes (the
  `resolution` field's allowed values)
- `src/hooks/useSync.ts` — the only caller (line 40)
- `src/services/storage/positionStore.ts` — `resolveByMaxPercent` function from Task 1
</read_first>

<action>
In `src/services/sync/syncEngine.ts`, replace the body of `resolvePosition`
(lines ~12–27) with a max-percent rule. Keep the same exported function
signature so `useSync.ts:40` keeps working without changes.

BEFORE:
```typescript
export function resolvePosition(
  local: SyncedPosition,
  remote: SyncedPosition,
): PositionConflict {
  const ageDiff = remote.updatedAt - local.updatedAt;

  if (ageDiff > AUTO_SYNC_THRESHOLD_MS) {
    return { local, remote, resolution: 'remote' };
  }

  if (local.chapterIndex === remote.chapterIndex) {
    return { local, remote, resolution: 'local' };
  }

  return { local, remote, resolution: 'prompt' };
}
```

AFTER:
```typescript
/**
 * Resolve conflict between local and remote synced positions.
 *
 * Rule (Phase 03 R5): keep whichever position has higher percentComplete.
 * Tiebreaker on equal/missing percent → local (the active session's value
 * is more reliable than a remote stub).
 *
 * The 'prompt' resolution path was removed — there is no UI surface for it.
 */
export function resolvePosition(
  local: SyncedPosition,
  remote: SyncedPosition,
): PositionConflict {
  const remotePercent = Number.isFinite(remote.percentComplete) ? remote.percentComplete : 0;
  const localPercent = Number.isFinite(local.percentComplete) ? local.percentComplete : 0;

  if (remotePercent > 0 && localPercent <= 0) {
    return { local, remote, resolution: 'remote' };
  }
  if (remotePercent > localPercent) {
    return { local, remote, resolution: 'remote' };
  }
  return { local, remote, resolution: 'local' };
}
```

Also remove the now-unused `AUTO_SYNC_THRESHOLD_MS` import if no other usage
remains in this file. (Run `grep -n AUTO_SYNC_THRESHOLD_MS
src/services/sync/syncEngine.ts` after the edit to confirm.)

Do NOT change `pushPosition`. Do NOT change `useSync.ts`.

Update the `PositionConflict.resolution` type if it currently includes
`'prompt'` and that variant is no longer reachable: keep `'prompt'` in the
type union (callers may still match on it as a no-op) but never produce it
from this function. If the union is exported and grepping shows no other
producers, remove `'prompt'` from the union and update `useSync.ts` to drop
its `else if (result.resolution === 'prompt')` branch (it currently sets
`setConflict(result)` for prompt — same as the remote branch, so the
behavioral change is zero).
</action>

<acceptance_criteria>
- `git grep -nE "resolution: 'prompt'" src/services/sync/syncEngine.ts`
  returns zero results.
- `git grep -n "AUTO_SYNC_THRESHOLD_MS" src/services/sync/syncEngine.ts`
  returns zero results (import removed if unused).
- `resolvePosition` signature is unchanged: takes
  `(local: SyncedPosition, remote: SyncedPosition)` and returns
  `PositionConflict`.
- `npx tsc --noEmit` reports no new type errors.
- The corresponding cases (local 12% vs remote 47% → 'remote'; local 50% vs
  remote 5% → 'local') match the rule when traced by hand.
</acceptance_criteria>

---

## Task 4 — Reduce `useEpubPosition` to a thin wrapper

**Goal:** Implement D-G4 — keep `useEpubPosition` as a state-holder hook with
no AsyncStorage, no debounce timer, no `pushPosition`, no `userId` parameter.

<read_first>
- `src/hooks/useEpubPosition.ts` (current implementation, 50 lines)
- All call sites: `git grep -n "useEpubPosition" src/` (confirm what consumers
  read from the hook today; chrome consumers expect `position`)
- `src/services/storage/positionStore.ts` (Task 1)
</read_first>

<action>
Rewrite `src/hooks/useEpubPosition.ts` to:

```typescript
import { useState, useCallback } from 'react';
import { loadPosition, type EpubLastPosition } from '@/services/storage/positionStore';
import { logger } from '@/utils/logger';

/**
 * Read-only React state holder for the current EPUB position. Writes are
 * routed through positionStore from ReaderView's three save triggers
 * (see 03-CONTEXT.md D-G1, D-G2). This hook does not write.
 */
export function useEpubPosition(bookId: string) {
  const [position, setPosition] = useState<EpubLastPosition | null>(null);

  // Called by ReaderView from POSITION_CHANGE (post-gate) to keep React state
  // in sync with the bridge — does NOT persist.
  const setFromBridge = useCallback((p: EpubLastPosition) => {
    setPosition(p);
  }, []);

  // Cold-open read; populates state and returns the loaded value.
  const loadLocalPosition = useCallback(async () => {
    const loaded = await loadPosition(bookId);
    if (loaded) setPosition(loaded);
    logger.debug('useEpubPosition: loadLocalPosition', { bookId, hasValue: !!loaded });
    return loaded;
  }, [bookId]);

  return { position, setFromBridge, loadLocalPosition };
}
```

Update every call site that previously passed `userId` — drop the second
argument:
- `src/components/book/ReaderView.tsx` — search for `useEpubPosition(`
  invocation (typically `useEpubPosition(bookId, user?.uid ?? null)` or
  similar) and change to `useEpubPosition(bookId)`.
- Any other consumer found via `git grep -n "useEpubPosition(" src/` —
  same change.

Update consumers that called `onPositionChange(position, onPersist)` (the
old API) to call `setFromBridge(position)` instead. The persistence callback
(the second `onPersist` arg that used to call `pushPosition`) is deleted
entirely — that work moved to `positionStore.savePosition` which is called
from Task 5's new save triggers, not from POSITION_CHANGE.
</action>

<acceptance_criteria>
- `src/hooks/useEpubPosition.ts` is at most ~30 lines and contains no
  references to: `AsyncStorage`, `POSITIONS_CACHE_KEY`, `setTimeout`,
  `clearTimeout`, `debounce`, `pushPosition`, `onPersist`.
- `useEpubPosition` is called with one argument (just `bookId`) at every call
  site: `git grep -nE "useEpubPosition\(" src/` shows no two-argument calls.
- The returned object has exactly: `position`, `setFromBridge`,
  `loadLocalPosition`.
- `npx tsc --noEmit` reports no new errors related to this hook or its
  consumers.
</acceptance_criteria>

---

## Task 5 — Rewire `ReaderView.tsx` to use `positionStore` + new triggers

**Goal:** Implement R1, R2, R6, R7 and D-G1, D-G3, D-G5 in `ReaderView.tsx`.
This is the biggest change in the phase.

<read_first>
- `src/components/book/ReaderView.tsx` — entire file, but pay particular attention to:
  - Lines ~36–48: imports
  - Lines ~157–170: `useImperativeHandle` exposing `getCurrentPosition`, `getLastKnownPosition`, etc.
  - Lines ~178: `pendingCfi` state
  - Lines ~340–410: bridge ready effect, saved-position load, `pendingCfi` set
  - Lines ~416–417: `pendingCfiRef` mirror
  - Lines ~432–449: existing AppState writer (DELETE — will be replaced by usePositionPersistence pattern below)
  - Lines ~451–550: `handlePositionChange` (REWORK — drop persistence callback; add chapter-change trigger; clear pendingCfi via R7 rule)
  - Lines ~587–598: `handleChapterSelect` (already clears `pendingCfiRef` synchronously — confirm pattern works, no change needed)
  - Lines ~620–631: `useEffect [locationsReady, pendingCfi]` for restore-goTo (REMOVE the unconditional `setPendingCfi(null)` — R7)
- `src/services/storage/positionStore.ts` — Task 1 API
- `src/hooks/useEpubPosition.ts` — Task 4 API
- `.planning/phases/03-position-restore-redesign/03-CONTEXT.md` — D-G1, D-G2, D-G3, D-G5
</read_first>

<action>
Make the following edits to `src/components/book/ReaderView.tsx`:

**5a. Remove the existing AppState writer block.** Delete lines ~432–449 (the
`useEffect` that calls `webViewRef.current?.getCurrentPosition()` and writes
directly to `AsyncStorage`). It will be replaced by 5b.

**5b. Add a single position-persistence effect that owns all three triggers.**
Insert this after the `pendingCfiRef` mirror and `locationsReadyRef` mirror
(around the deleted block's location):

```typescript
import {
  savePosition,
  registerRestoreCheck,
  setCachedPosition,
  type EpubLastPosition,
} from '@/services/storage/positionStore';

// ... inside ReaderView component, after pendingCfiRef + locationsReadyRef ...

// Track the last chapter index we persisted so chapter-change triggers fire
// exactly once per crossing.
const lastSavedChapterIndexRef = useRef<number | null>(null);
// 30s in-foreground debounce timer.
const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Build the persist payload from the freshest position we have. Returns null
// if we have nothing safe to save.
const buildPayload = useCallback((): EpubLastPosition | null => {
  const live = livePositionRef.current;
  if (!live?.cfi) return null;
  return {
    cfi: live.cfi,
    chapterIndex: live.chapterIndex,
    charOffset: (live as any).charOffset ?? 0,
    percentComplete: live.percentComplete ?? 0,
    updatedAt: Date.now(),
  };
}, []);

const persistNow = useCallback((trigger: string) => {
  const payload = buildPayload();
  if (!payload) return;
  savePosition(bookId, payload, {
    userId: user?.uid ?? null,
    deviceId: deviceId ?? null,
    trigger,
  });
}, [bookId, user?.uid, deviceId, buildPayload]);

const scheduleDebouncedSave = useCallback(() => {
  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  debounceTimerRef.current = setTimeout(() => {
    persistNow('debounce-30s');
  }, 30_000);
}, [persistNow]);

// Register the restore-in-progress check so positionStore knows when to no-op.
useEffect(() => {
  registerRestoreCheck(bookId, () => pendingCfiRef.current !== null);
  return () => registerRestoreCheck(bookId, null);
}, [bookId]);

// Trigger 1: AppState → 'background' | 'inactive' (R2).
useEffect(() => {
  const onAppState = (s: AppStateStatus) => {
    if (s === 'background' || s === 'inactive') {
      persistNow('appstate-background');
    }
  };
  const sub = AppState.addEventListener('change', onAppState);
  return () => sub.remove();
}, [persistNow]);

// Cleanup debounce on unmount.
useEffect(() => {
  return () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  };
}, []);
```

**5c. Cold-open: load saved position via `positionStore.loadPosition`.** In
the existing bridge-ready / saved-position-load effect (around lines 340–410),
replace the existing AsyncStorage-direct load with a call to
`loadPosition(bookId)`. The existing logic that sets `pendingCfi` from the
saved value stays — only the read path changes.

```typescript
// BEFORE (somewhere in the bridge-ready effect):
//   const raw = await AsyncStorage.getItem(`${POSITIONS_CACHE_KEY}:${bookId}:epub`);
//   const saved = raw ? JSON.parse(raw) : null;
//
// AFTER:
const saved = await loadPosition(bookId);
if (saved?.cfi) {
  logger.info('ReaderView: setting pendingCfi for restore', { cfi: saved.cfi });
  setPendingCfi(saved.cfi);
  pendingCfiRef.current = saved.cfi;
}
```

**5d. Rewire `handlePositionChange`.** Inside the post-gate section (after
`livePositionRef.current = position;` around line 499), do the following:

1. Detect chapter-change and trigger an immediate save (D-G2):
   ```typescript
   if (position.chapterIndex !== lastSavedChapterIndexRef.current) {
     lastSavedChapterIndexRef.current = position.chapterIndex;
     persistNow('chapter-change');
   }
   scheduleDebouncedSave();
   ```
2. Clear `pendingCfi` per R7 — only when the new position confirms the
   restore landed at or past the saved chapter:
   ```typescript
   // R7: confirm restore-goTo took effect before clearing pendingCfi.
   if (pendingCfiRef.current && position.chapterIndex >= /* savedChapterIndexRef.current */) {
     pendingCfiRef.current = null;
     setPendingCfi(null);
   }
   ```
   To make this work, also save the saved chapter index alongside `pendingCfi`
   when 5c sets it:
   ```typescript
   const savedChapterIndexRef = useRef<number | null>(null);
   // ...inside 5c, after setPendingCfi:
   savedChapterIndexRef.current = saved.chapterIndex;
   ```

3. **Remove** the old persistence callback chain — the second
   `onPositionChange(position, async (pos) => { ... pushPosition(...) ... })`
   call (around lines 529–547) is deleted entirely. `persistNow` and
   `scheduleDebouncedSave` are the new write surface.

**5e. Remove the unconditional `setPendingCfi(null)` in the locationsReady
restore-goTo effect (R7).** In the effect around lines 620–631:

BEFORE:
```typescript
useEffect(() => {
  if (!locationsReady || !pendingCfi) return;
  logger.info('ReaderView: navigating to saved CFI on locationsReady', { cfi: pendingCfi });
  webViewRef.current?.goTo(pendingCfi);
  pendingCfiRef.current = null;
  // pendingRestorePositionRef.current = ...
  setPendingCfi(null);
}, [locationsReady, pendingCfi]);
```

AFTER:
```typescript
useEffect(() => {
  if (!locationsReady || !pendingCfi) return;
  logger.info('ReaderView: navigating to saved CFI on locationsReady', { cfi: pendingCfi });
  webViewRef.current?.goTo(pendingCfi);
  // pendingCfi is NOT cleared here. Per R7, it clears only when the resulting
  // POSITION_CHANGE confirms chapterIndex >= savedChapterIndex (handled in
  // handlePositionChange). If goTo fails, pendingCfi stays set and the next
  // locationsReady cycle (e.g., orientation change) will retry.
}, [locationsReady, pendingCfi]);
```

**5f. Drop `programmatic` from save-gate logic (R6).** Search the file for
all references to `programmatic` inside conditional blocks that affect saves
or `pendingCfi`:
- Save-side: there are no longer any save calls inside `handlePositionChange`,
  so the existing `if (programmatic) return` paths in the gate are
  diagnostic-only after this task. Add a comment noting that.
- The line `if (!programmatic) setPendingCfi(null);` (Phase 01's fix in
  `handlePositionChange`) — DELETE it. R7's chapter-confirmation rule
  supersedes this. Phase 01's fix was the workaround for CR-01; R7 makes it
  unnecessary.

**5g. Confirm `handleChapterSelect` already clears `pendingCfiRef` (D-G3).**
Around lines 587–598, the existing block:

```typescript
const handleChapterSelect = useCallback((index: number) => {
  pendingCfiRef.current = null;
  setPendingCfi(null);
  webViewRef.current?.goToChapter(index);
  // ...
}, [...]);
```

is already correct — it clears synchronously before `goToChapter`. **No
change required.** Verify by re-reading the function and confirming both refs
are cleared before the WebView call.

**5h. Replace useEpubPosition consumer.** Find where `useEpubPosition` is
called (typically near other hooks at the top of the function). Update to
match Task 4's new signature:

```typescript
// BEFORE:
//   const { position, onPositionChange, loadLocalPosition } = useEpubPosition(bookId, user?.uid ?? null);
// AFTER:
const { position, setFromBridge, loadLocalPosition } = useEpubPosition(bookId);
```

Then in `handlePositionChange` (post-gate), call `setFromBridge(payload)`
instead of `onPositionChange(position, ...)`. Build the payload via
`buildPayload` to keep one source of truth for the shape.
</action>

<acceptance_criteria>
- `git grep -nE "AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub" src/components/book/ReaderView.tsx`
  returns zero results.
- `git grep -nE "import .*pushPosition" src/components/book/ReaderView.tsx`
  returns zero results.
- `git grep -nE "savePosition\b" src/components/book/ReaderView.tsx` shows
  exactly three call sites (one per trigger), each with an adjacent comment
  containing one of: `appstate-background`, `chapter-change`, `debounce-30s`.
  (The comment is in the `trigger:` argument value or a `//` comment above the call.)
- `git grep -nE "if \(!programmatic\) setPendingCfi" src/components/book/ReaderView.tsx`
  returns zero results.
- The `useEffect [locationsReady, pendingCfi]` no longer calls
  `setPendingCfi(null)` (verify by reading the function body).
- `useEpubPosition` is called with exactly one argument.
- `npx tsc --noEmit` reports no new errors.
</acceptance_criteria>

---

## Task 6 — Strip position writes from `BookSessionScreen.tsx`

**Goal:** Implement R3 — `beforeRemove` and `handleSwitchMode` no longer
write the EPUB position. Audio writes stay (out of scope).

<read_first>
- `src/screens/book/BookSessionScreen.tsx` lines 149–192 (`beforeRemove` block)
  and 208–253 (`handleSwitchMode` listen-branch block).
- The audio code at lines ~165–188 — DO NOT TOUCH.
</read_first>

<action>
**6a. `beforeRemove` (around lines 149–191):** Delete the EPUB save block.

BEFORE (lines ~152–163):
```typescript
const epubPos = readerRef.current?.getLastKnownPosition();
logger.info('BookSession: beforeRemove', {
  hasCfi: !!epubPos?.cfi,
  cfi: epubPos?.cfi ?? '(null)',
  chapterIndex: epubPos?.chapterIndex ?? -1,
});
if (epubPos?.cfi) {
  AsyncStorage.setItem(
    `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`,
    JSON.stringify({ ...epubPos, savedAt: Date.now() }),
  ).catch(() => {});
}
```

AFTER:
```typescript
// EPUB position is persisted by ReaderView's three save triggers (R2/R3).
// beforeRemove is a no-op for EPUB now — the AppState→background trigger that
// fires within milliseconds of unmount covers this case structurally.
const epubPos = readerRef.current?.getLastKnownPosition();
logger.info('BookSession: beforeRemove (epub no-op)', {
  hasCfi: !!epubPos?.cfi,
});
```

**6b. `handleSwitchMode` listen branch (around lines 218–229):** Delete the
snap-flush save block (the `snapPos` AsyncStorage write before the
`getCurrentPosition` await). Keep the rest of the listen-branch logic (the
`getCurrentPosition` await, the `epubPos` derivation with
`getLastKnownPosition` fallback, the audio handoff).

BEFORE (around lines 218–229):
```typescript
setSwitching(true);
try {
  // Flush the last known reader position synchronously before any async
  // work so the AsyncStorage fallback inside prepareBookForPlayback is
  // fresh even if the 2 s debounce hasn't fired yet.
  const snapPos = readerRef.current?.getLastKnownPosition();
  if (snapPos?.cfi) {
    AsyncStorage.setItem(
      `${POSITIONS_CACHE_KEY}:${params.bookId}:epub`,
      JSON.stringify({ ...snapPos, savedAt: Date.now() }),
    ).catch(() => {});
  }

  const livePos = await readerRef.current?.getCurrentPosition();
```

AFTER:
```typescript
setSwitching(true);
try {
  const livePos = await readerRef.current?.getCurrentPosition();
```

The Phase 01 snap-flush is now redundant: ReaderView's chapter-change and
30s-debounce triggers ensure the AsyncStorage value is at most 30s stale.
For mode-switch hand-off, the audio path uses `livePos`/`getLastKnownPosition`
in-memory (already in place below the deleted block), not AsyncStorage.

**6c. Remove the now-unused imports** if no other references remain in the
file:
- `import AsyncStorage from '@react-native-async-storage/async-storage';`
  → check `git grep -n "AsyncStorage\." src/screens/book/BookSessionScreen.tsx`
  after the edits. If the only remaining hits are the audio block, keep the
  import. If zero remain (audio block removed elsewhere — but it's not
  removed in this phase), keep the import.
- `import { POSITIONS_CACHE_KEY } from '@/constants/config';` → similar
  check; the audio block still uses this key, so the import stays.
</action>

<acceptance_criteria>
- `git grep -nE "AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub" src/screens/book/BookSessionScreen.tsx`
  returns zero results.
- `git grep -n "snapPos" src/screens/book/BookSessionScreen.tsx` returns
  zero results.
- The audio save block at the original lines 169–188 is unchanged (verify by
  reading — `:audio` key writes still present).
- `handleSwitchMode` listen branch still calls
  `await readerRef.current?.getCurrentPosition()` and falls back to
  `getLastKnownPosition()` for `epubPos` (Phase 01's structure preserved).
- `npx tsc --noEmit` reports no new errors.
</acceptance_criteria>

---

## Task 7 — Sanity scan for stragglers

**Goal:** Catch any stray write site, stale import, or call-site that the
prior tasks missed. This is the cheap insurance that closes AC-1, AC-2, AC-7.

<read_first>
- All files modified by tasks 1–6.
</read_first>

<action>
Run the SPEC's structural acceptance commands and confirm each output:

```bash
# AC-1: exactly one EPUB write site (in positionStore.ts)
git grep -nE "AsyncStorage\.setItem.*POSITIONS_CACHE_KEY.*:epub" src/ | grep -v __tests__
# Expected: exactly one line — src/services/storage/positionStore.ts

# AC-2: pushPosition imported in exactly one non-test file
git grep -nE "^import .*pushPosition\b" src/ | grep -v __tests__
# Expected: exactly one line — src/services/storage/positionStore.ts

# AC-3: savePosition call sites match the three triggers
git grep -nE "savePosition\b" src/ | grep -v __tests__ | grep -v positionStore.ts
# Expected: at least three lines, each in src/components/book/ReaderView.tsx,
# each with adjacent trigger context (appstate-background, chapter-change, debounce-30s)

# AC-4: no EPUB writes remain in BookSessionScreen
git grep -nE "AsyncStorage\.setItem" src/screens/book/BookSessionScreen.tsx | grep -i ":epub\b"
# Expected: zero lines

# AC-7: programmatic flag is not used in save-gate decisions in ReaderView
git grep -n "programmatic" src/components/book/ReaderView.tsx | grep -vE "logger\.|//|^\s*\*"
# Expected: only argument-declaration / function-signature lines remain — no
# conditional save logic. Manually inspect the remaining hits.

# Type check
npx tsc --noEmit 2>&1 | tee /tmp/tsc-phase-03.log
echo "exit=$?"
```

Resolve any unexpected output by going back to the originating task. Do not
add a final "wrap-up" commit — each task's edits should be committed
atomically per GSD discipline.

If `npx tsc --noEmit` flags errors that are NOT new (i.e., they exist on
`HEAD~7`), note them in the commit body but don't fix them in this phase —
they're out of scope.
</action>

<acceptance_criteria>
- The five `git grep` commands above produce the expected outputs (or
  document deviations explicitly).
- `npx tsc --noEmit` exits with no new errors attributable to this phase
  (compare against `git stash apply stash@{0}` baseline if helpful — though
  the AAI/aligner stash is unrelated).
- All 7 tasks have landed as separate atomic commits with messages following
  the existing repo convention (`feat(positionStore): …`,
  `refactor(reader): …`, `fix(sync): …`).
</acceptance_criteria>

---

## Verification

After Task 7, run the SPEC.md AC-1 through AC-10 checks. AC-5, AC-8, AC-9,
AC-10 are manual cold-open scenarios that need a device build:

```bash
# Bundle a build and install on Android (or iOS) device:
expo run:android
# or: expo run:ios

# Manual scenarios:
# AC-5: cold-open with saved CFI on slow large-EPUB build → verify no
#       chapter-0 flash, page restores cleanly
# AC-8: force-quit at chapter 5 page 3, repeat 5 reopens → all land at same page
# AC-9: brand-new book → chapter 0, save fires within 30s
# AC-10: cross-device sync → device-2's higher percent silently applied to device-1
```

Document results in `03-VERIFICATION.md` per the GSD workflow before closing
the phase. Then run `/code-review 03` and `/review` (cross-AI peer review)
**before** writing `03-SUMMARY.md`. Phase 01 was closed before peer review
returned its CRITICAL findings — do not repeat that mistake.
