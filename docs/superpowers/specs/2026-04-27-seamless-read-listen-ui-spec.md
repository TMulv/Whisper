# UI Spec — Seamless Read ↔ Listen Transition

**Date:** 2026-04-27
**Status:** Draft (design contract, pre-implementation)
**Related:** [2026-04-27-reader-audio-sync-fix-plan.md](./2026-04-27-reader-audio-sync-fix-plan.md), [2026-04-27-reader-audio-sync-simplification-design.md](./2026-04-27-reader-audio-sync-simplification-design.md)

## Problem

User feedback: *"too many cards are popping up from the bottom and it feels crowded navigating back."*

Today, opening a book and using its audio means juggling four overlapping surfaces: the Reader screen (inside `LibraryStack`), the **TopDrawerModal** (custom slide-from-top), the **MiniPlayer** bar (above the tab bar), and the **Player** screen (root-level `presentation: 'modal'` slide-from-bottom). Going Reader → Listen requires: open drawer → tap Start audiobook → drawer auto-closes → tap MiniPlayer → Player slides up over tabs. Going back is asymmetric — the Player uses a drag handle, the Reader uses system back. Reader and Player are siblings in the navigator but conceptually one experience: they are two **modes** of consuming the same book.

## Goals

1. Make Read ↔ Listen feel like flipping the same object over, not pushing a new screen.
2. Eliminate stacked modal chrome during the active book session.
3. Single, predictable back affordance from either mode.
4. Audio controls live in exactly one place per mode — no duplication between drawer and player.

## Non-goals

- Re-skinning Library / Settings / BookDetail.
- Changing the underlying sync engine (`alignmentBuilder`, `handoff.ts`).
- Replacing the navigation library.

## Information architecture

### Before
```
RootStack
├── Auth (when signed-out)
└── Authenticated
    ├── MainTabs
    │   ├── Library → LibraryStack(Library → BookDetail → Reader)   ← Reader lives here
    │   ├── Add (intercepted)
    │   └── Settings
    │   + MiniPlayer bar (above tab bar, always visible when audio is loaded)
    └── Player  ← root-level modal (slide from bottom)
```

### After
```
RootStack
├── Auth
└── Authenticated
    ├── MainTabs
    │   ├── Library → LibraryStack(Library → BookDetail)
    │   ├── Add
    │   └── Settings
    │   + MiniPlayer bar  ← only on tabs, NOT inside BookSession
    └── BookSession  ← root-level full-screen, replaces both Reader-as-stack-screen and Player-as-modal
        ├── mode: 'read'    → renders <ReaderView/>
        └── mode: 'listen'  → renders <ListenView/>
```

**Key change:** `Reader` is removed from `LibraryStack`. `Player` is removed from `RootStack`. Both are absorbed into a single root route `BookSession` that owns `{ bookId, mode }` and swaps its body in place.

## Surfaces — what changes

| Surface | Today | After |
|---|---|---|
| `Reader` screen | Stack screen in `LibraryStack` | **Removed**. Becomes `<ReaderView/>` body inside `BookSession`. |
| `Player` screen | Root modal, slide from bottom | **Removed**. Becomes `<ListenView/>` body inside `BookSession`. |
| `BookSession` | — | **New** root route. Full-screen, no modal chrome. Owns mode state. |
| `ReaderDrawer` Audio tab | Has "Start audiobook" + audio progress | **Removed**. All audio lives in Listen mode. |
| `ReaderDrawer` Display + Chapters tabs | Top-down modal | Stay, simplified. Drawer becomes `display + chapters` only. |
| `MiniPlayer` | Always above tab bar when audio loaded | Visible only when current route is **not** `BookSession`. |
| `SyncBanner` (Reader) | Inline banner with "Jump there" | **Removed**. Switching modes auto-syncs; out-of-sync state surfaces as a small dot on the mode toggle. |
| `Player`'s "Reader" button | Dismisses modal, navigates Reader | **Removed**. Replaced by the mode toggle. |
| Reader's "Start audiobook" | Inside drawer | **Removed**. Replaced by the mode toggle. |

## The mode toggle (the central new component)

A two-segment pill in the top bar of `BookSession`, present in both modes:

```
┌─────────────────────────────────────────────┐
│  ⌄         [📖 Read │ 🎧 Listen]      ⋯   │   ← top bar (60pt)
├─────────────────────────────────────────────┤
│                                             │
│           body: ReaderView or ListenView    │
│                                             │
└─────────────────────────────────────────────┘
```

- **Left chevron-down (⌄):** single back affordance — pops `BookSession`, returns to whatever was behind (`BookDetail` or `Library`). Same gesture from both modes. Replaces both the Player drag-handle and the Reader system-back ambiguity. Android system-back must do the same.
- **Center segmented pill:** active segment filled, inactive outlined. Tapping the inactive segment swaps the body. The currently inactive segment shows a tiny dot when the other mode would land >2s / >1 page out of sync, signaling "switching here will jump."
- **Right kebab (⋯):** opens the drawer for the current mode (Display+Chapters in Read, Speed+Sleep+Chapters in Listen). One drawer per mode, never both.

## Transition: Read → Listen (and reverse)

- **Visual:** body cross-fades over 180ms; the toggle pill's active segment slides to the new side over the same 180ms (shared element).
- **Position handoff:** on tap, before the cross-fade starts, the new mode's view is pre-seeded with the synced position (use existing `handoff.ts` resolver). If alignment data is missing, swap anyway and let the new view show its native loading state — never block the transition.
- **No modal animation, no slide-from-bottom, no slide-from-top.** The user stays on the same surface; only the body swaps.
- **Audio behavior:** audio playback is independent of the visible mode. Switching to Read does not pause audio; switching to Listen does not auto-play. (Current behavior preserved.)

## MiniPlayer behavior

- Visible **only** when the current route is outside `BookSession` (i.e., on Library, BookDetail, Settings).
- Tapping the body of the MiniPlayer opens `BookSession` with `mode: 'listen'`.
- When inside `BookSession`, the MiniPlayer is hidden — its function is replaced by the mode toggle and the in-mode controls.
- **Close affordance:** a small `×` button on the right edge of the MiniPlayer (after the play/pause button). Tapping it stops playback (`TrackPlayer.stop()`), clears now-playing state (`clearNowPlaying()`), and dismisses the bar. Hit slop ≥ 14pt; pressing × must not also trigger the body's tap-to-open.

## Back-navigation matrix

| From | Action | Lands at |
|---|---|---|
| `BookSession` (any mode) | tap ⌄ | the screen that opened it (`BookDetail` or `Library`) |
| `BookSession` (any mode) | Android system back | same as ⌄ |
| `BookSession` (any mode) | iOS edge-swipe | same as ⌄ |
| `BookSession` listen mode | tap 📖 Read segment | stays in `BookSession`, body swaps |
| `BookSession` read mode | tap 🎧 Listen segment | stays in `BookSession`, body swaps |
| `BookDetail` | tap Play / Open Reader | opens `BookSession` with the chosen mode |
| `Library` | tap MiniPlayer | opens `BookSession` with `mode: 'listen'` |

No path inside the active book session pushes a new screen on top. The session is one route, max depth 1.

## Components — concrete file changes

**New:**
- `src/screens/book/BookSessionScreen.tsx` — root-level screen, owns `{ bookId, mode }`, renders top bar + body.
- `src/components/book/ModeToggle.tsx` — the segmented pill, accepts `{ mode, onChange, outOfSync }`.

**Refactored (kept, but moved/renamed):**
- `src/screens/reader/ReaderScreen.tsx` → `src/components/book/ReaderView.tsx`. Strip nav header logic, remove `SyncBanner`, remove "Start audiobook" entry point. Keep webview, word lookup, chapter handling.
- `src/screens/player/PlayerScreen.tsx` → `src/components/book/ListenView.tsx`. Strip drag-handle close, remove "Reader" button. Keep transport controls, scrubber, chapter list.

**Modified:**
- `src/navigation/MainTabNavigator.tsx` — `LibraryStack` no longer contains `Reader`. `MiniPlayer` rendering gated on route name.
- `src/navigation/RootNavigator.tsx` (or `App.tsx`) — replace the modal `Player` route with `BookSession` (default `presentation: 'card'`, full-screen, no modal animation). Remove `Reader` from `LibraryStack`.
- `src/navigation/types.ts` — drop `Player` and `Reader` route params; add `BookSession: { bookId: string; mode: 'read' | 'listen'; resumeFromAudio?: boolean }`.
- `src/components/reader/ReaderDrawer.tsx` — remove Audio tab. Drawer is now Display + Chapters.
- `src/screens/library/BookDetailScreen.tsx` — `Open Reader` and `Play` both call `navigateRoot('BookSession', { bookId, mode })`.
- `src/components/player/MiniPlayer.tsx` — tap body navigates to `BookSession` with `mode: 'listen'`. Add a `×` close button that stops playback and clears now-playing. Hide entire bar when current route is `BookSession`.

**Removed:**
- `SyncBanner` component (Reader inline banner).
- Player drag-handle close affordance.
- "Start audiobook" button + audio tab in `ReaderDrawer`.
- `presentation: 'modal'` on the Player route.

## Visual language

- `BookSession` background matches the underlying mode (Reader paper tone in read, dark/album-art-tinted in listen).
- Top bar background is translucent over the mode body; it does **not** look like a modal sheet (no rounded top corners, no drag handle, no shadow line beneath).
- Mode toggle: 32pt height, 8pt corner radius, brand accent for active segment, secondary text on inactive.
- Cross-fade duration: 180ms `easeInOut`. No spring.

## Edge cases

1. **Reader-only books (no audiobook):** open in read mode and **hide the toggle entirely**. No "Add audio" affordance in the top bar — that path stays in `BookDetail`.
2. **Audio-only books (no epub):** symmetric — open in listen mode, hide the toggle.
3. **Both present:** toggle is shown in both modes.
4. **Exiting Listen mode via ⌄:** **audio keeps playing**. The user lands on the underlying screen and the MiniPlayer reappears there. Same behavior whether they exit from Listen or Read mode.
5. **Word lookup modal:** keep as-is (center fade modal in Read mode). Content-level, not navigation-level — doesn't conflict with the "no stacked modals" goal.
6. **AI Insights:** stays a center modal in Listen mode (and BookDetail). **Not** moving into the drawer.
7. **Lock screen / external transport controls:** unchanged; audio playback layer is untouched.
8. **Deep link back-compat:** external deep links to `Player` or `Reader` resolve to `BookSession` with the right `mode`. Add a navigation linking config map.

## Out of scope

- Cross-fading the actual content (paragraph in Read aligning with playhead in Listen) — that's a separate sync-UX project.
- Redesigning chapter list, transport buttons, or word-lookup styling.
- Tablet / landscape layouts.

## Acceptance criteria

- From any tab, opening a book lands on `BookSession`. Tapping ⌄ returns to the prior screen with no intermediate animation.
- Switching Read ↔ Listen never pushes or pops a navigator screen (verify with a `useNavigationState` log).
- The MiniPlayer is invisible inside `BookSession` and visible on Library / Settings / BookDetail.
- The `ReaderDrawer` no longer contains audio controls.
- The Player no longer slides up from the bottom; it appears as the body of `BookSession`.
- Android back, iOS edge-swipe, and the ⌄ button all behave identically from both modes.
