# Phase 01: Position Sync Fix — Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Source:** User bug report + codebase analysis

<domain>
## Phase Boundary

Fix position synchronization across mode switches in `BookSessionScreen`.
Three bugs cause position to be lost or reset:

1. Reader jumps back to "where it opened" after user navigates forward
2. Audio starts from beginning instead of reader's current page
3. (Partially working) Reader doesn't resume from audio on listen→read switch

In scope: `ReaderView.tsx` and `BookSessionScreen.tsx` only. No changes to
alignment logic, handoff functions, or AsyncStorage key schema.
</domain>

<decisions>
## Implementation Decisions

### D-01: Fix pendingCfi with a one-liner in handlePositionChange
Add `if (!programmatic) setPendingCfi(null)` at the top of `handlePositionChange`.
The `programmatic` flag is already threaded through — this is the minimal fix.

### D-02: Fall back to getLastKnownPosition() in handleSwitchMode
`getLastKnownPosition()` was added in the most recent diff but not wired into
the read→listen switch. Wire it as the fallback when `getCurrentPosition()`
returns empty.

### D-03: Snap-save reader position before switching to audio
Fire-and-forget `AsyncStorage.setItem` using `getLastKnownPosition()` at the
top of the listen branch, before the async `getCurrentPosition()` call. This
keeps the AsyncStorage fallback fresh for `prepareBookForPlayback`.

### D-04: No logic change to listen→read audioPos=0 guard
The `if (audioPos > 0)` guard is correct: don't navigate reader if user
didn't listen. Add a comment explaining why this is intentional.

### Claude's Discretion
- Comment wording
- Exact placement within the try/finally block
</decisions>

<canonical_refs>
## Canonical References

- `src/screens/book/BookSessionScreen.tsx` — mode switch orchestration
- `src/components/book/ReaderView.tsx` — epub bridge, pendingCfi, livePositionRef
- `src/hooks/useEpubPosition.ts` — debounced save mechanism
- `src/services/audio/prepareBookForPlayback.ts` — audio start position resolution
- `CLAUDE.md` — architecture overview (always-mounted views, position layers, L0/L1 alignment)
</canonical_refs>

<specifics>
## Specific Ideas

User scenario that triggered bugs:
1. Open reader (no prior position saved, or saved position exists)
2. Navigate forward 5 pages manually
3. Switch to audio (listen mode)
4. Switch back to reader
5. Reader is at "where it opened originally" — NOT at page 5

Root cause trace:
- epub.js fires locationsReady 2-30s after bridge init
- pendingCfi = savedCfi is set during ready effect
- User navigates 5 pages (before locationsReady)
- locationsReady fires → goTo(pendingCfi) → reader snaps back to saved position
- Fix: clear pendingCfi on any user-driven (non-programmatic) navigation

Audio start scenario:
- User is at page 5 (percentComplete ~0.08, CFI set)
- Switches to listen
- getCurrentPosition() returns percentComplete=0 (before locationsReady)
- CFI IS populated so condition `livePos.percentComplete > 0 || livePos.cfi` passes
- BUT: if CFI is empty for some reason, falls through to undefined
- Fix: getLastKnownPosition() ref as a guaranteed fallback
</specifics>

<deferred>
## Deferred Ideas

- L1 alignment precision (word-level CFI mapping) — separate alignment work
- Cross-device position sync improvements — separate Firestore work
- AudioPosition saved more frequently during playback — NowPlayingContext work
</deferred>

---

*Phase: 01-position-sync-fix*
*Context gathered: 2026-04-28*
