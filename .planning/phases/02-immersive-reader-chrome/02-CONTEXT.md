# Phase 02: Immersive Reader Chrome — Context

**Gathered:** 2026-04-28
**Status:** Ready for planning
**Source:** ADR-001 (Immersive Reader — Menu & Chrome Access)

<domain>
## Phase Boundary

Replace the persistent dark `topBar` in `BookSessionScreen` with an
auto-hiding overlay that uses the page color, fixes the iPhone notch
collision, and gives back the immersive feel of a real reading app.

This phase touches **chrome only** — no changes to position sync, alignment,
audio playback, or paragraph-tap-to-seek logic.

</domain>

<decisions>
## Implementation Decisions

### Chrome behavior (locked)
- Chrome is **hidden by default** during reading.
- Chrome **shows for 3 seconds on screen entry**, then auto-hides.
- Chrome **shows on tap** of either:
  - The full-width 72px top-edge tap strip (already exists in `ReaderView`,
    must be hoisted/duplicated to work in both modes)
  - A 60×60 invisible top-right corner target (placed below the notch arc)
- Chrome **auto-hides after 4 seconds** of no interaction.
- Chrome **stays visible** while the user interacts with it (tap on toggle
  resets the timer).
- Chrome dismisses on tap outside its bounds (no explicit close button).

### Visual (locked)
- Chrome background uses the **current page color** (white / sepia / dark).
  No more navy `#0D0D1A`.
- Container background of `BookSessionScreen` becomes transparent so the
  ReaderView page color extends edge-to-edge.
- Chrome opacity: 95% (subtle separation from page without breaking
  immersion).
- Chrome animates in/out with 180ms fade (matches existing `FADE_MS`).

### Chrome contents (locked)
- Left: ✕ close button (replaces current `⌄` back arrow — clearer "exit book"
  affordance now that toolbar isn't permanent).
- Center: `ModeToggle` (only when both formats available, same as today).
- Right: `⋯` menu icon that opens the existing `TopDrawerModal` →
  `ReaderDrawer`. In listen mode the menu icon is hidden (no drawer needed
  for audio-only sessions in this phase).

### What stays the same (locked)
- `TopDrawerModal` and `ReaderDrawer` are **unchanged**. The drawer keeps
  its current contents (chapters, font/theme, highlights, Home button).
- Paragraph-tap-to-seek (`onParagraphTap` in `EpubWebView`) is **untouched**
  — the chrome reveal must not collide with paragraph taps.
- The drawer Home button continues to work as the second back path.
- Hardware back on Android is unchanged.
- StatusBar stays hidden (`<StatusBar hidden />`).
- `ReaderView`'s existing internal `topTapStrip` is removed; the equivalent
  reveal target is hoisted into `BookSessionScreen` so it works in both
  modes.

### Claude's Discretion
- Exact corner tap target placement (right edge inset) within reasonable
  bounds.
- Animation curve (linear vs ease-out) — pick whichever feels right.
- Whether to add a small "settings shown" haptic on chrome reveal.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing chrome and reveal mechanism
- `src/screens/book/BookSessionScreen.tsx` — current `topBar` rendering
  (lines 260–282), styles (lines 312–353), beforeRemove/handleSwitchMode
  context.
- `src/components/book/ReaderView.tsx` — existing `topTapStrip`
  (lines 622–627), `controlsVisible` state (line 131),
  `TopDrawerModal` invocation (lines 629–656), `bgColor` derivation
  (line 577).
- `src/components/reader/TopDrawerModal.tsx` — drawer modal (do not modify).
- `src/components/reader/ReaderDrawer.tsx` — drawer contents (do not modify).
- `src/components/book/ModeToggle.tsx` — pill toggle component (do not
  modify).

### Theming
- The `bgColor` formula in `ReaderView.tsx:577`:
  `theme === 'dark' ? '#121212' : theme === 'sepia' ? '#f5efe0' : '#ffffff'`
  — must be lifted/shared so chrome can match.

### iOS specifics
- Dynamic Island / notch sits roughly between x ∈ [center−60, center+60] of
  the safe area top inset on iPhone 14 Pro and later. The corner tap target
  must sit to the right of x = center + 80 to never overlap.

</canonical_refs>

<specifics>
## Specific Ideas

- A `<ReaderChrome>` component owns visibility state and timer.
- Visibility state lives in `BookSessionScreen` (not `ReaderView`) because
  the chrome must work in `listen` mode too.
- Use `Animated.Value` for opacity (matches existing fade pattern at
  `BookSessionScreen.tsx:51-52`).
- Theme color is lifted: `BookSessionScreen` reads the user's saved theme
  from AsyncStorage (`@whisper/theme`) on mount and passes `bgColor` down
  to `ReaderChrome`. ReaderView already does this read; expose it via
  `ReaderViewRef` or duplicate the read.

</specifics>

<deferred>
## Deferred Ideas

- Long-press top-right "lock" mode that suppresses even the on-entry show
  (Option A overlay from the ADR). Revisit if users still find chrome
  intrusive after C ships.
- Tap-center reveal pattern (Option B from ADR). Deferred — collides with
  paragraph-tap-to-seek.
- Showing a one-time first-run hint shimmer over the corner target.
- Per-mode chrome variations (e.g., different right-side icon in listen
  mode). For now the menu icon hides in listen mode.

</deferred>

---

*Phase: 02-immersive-reader-chrome*
*Context gathered: 2026-04-28 from ADR-001 in conversation*
