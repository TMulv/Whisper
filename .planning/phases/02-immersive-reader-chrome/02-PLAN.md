---
wave: 1
depends_on: []
files_modified:
  - src/screens/book/BookSessionScreen.tsx
  - src/components/book/ReaderView.tsx
files_created:
  - src/components/book/ReaderChrome.tsx
autonomous: true
requirements:
  - chrome-hidden-by-default
  - chrome-shows-on-entry-three-seconds
  - chrome-reveals-on-top-edge-tap
  - chrome-reveals-on-top-right-corner-tap
  - chrome-auto-hides-after-four-seconds
  - chrome-uses-page-color
  - notch-no-longer-blocks-controls
  - paragraph-tap-to-seek-still-works
  - mode-toggle-still-one-tap-to-reveal
---

# Plan 02 — Immersive reader chrome (auto-hiding overlay, page-colored)

## Objective

Replace the persistent navy `topBar` in `BookSessionScreen` with a
self-managing overlay component (`ReaderChrome`) that:

1. Hides itself by default during reading.
2. Shows for 3 s on screen entry, then fades out.
3. Reveals on tap of either a full-width top-edge strip OR a 60×60 invisible
   top-right corner target (notch-safe).
4. Auto-hides 4 s after the last interaction.
5. Uses the current page color as its background instead of dark navy.

This solves two problems documented in ADR-001:
- iPhone notch / Dynamic Island blocks taps in the centered top region.
- Permanent navy bar breaks reading immersion.

No changes to position sync, alignment, audio playback, paragraph-tap-to-seek,
or the existing `TopDrawerModal` / `ReaderDrawer`.

## must_haves

```yaml
truths:
  - chrome is invisible by default once the 3 s on-entry display ends
  - tap on top-edge strip or top-right corner brings chrome back
  - chrome auto-hides 4 s after the last user interaction with it
  - chrome background matches the reader page color (white/sepia/dark)
  - container background of BookSessionScreen no longer paints navy through
  - mode toggle reveal flow is still one tap (top tap → toggle visible)
  - paragraph tap on the page still seeks audio (no collision)
  - drawer (chapters/fonts/highlights) still opens via the menu icon
  - iPhone notch never overlaps a tap target
  - the existing topTapStrip in ReaderView is removed (single source of truth)
```

---

## Task 1 — Create `ReaderChrome` component

**Why:** A dedicated component owns the visibility state, auto-hide timer,
fade animation, and tap targets. Keeps `BookSessionScreen` readable.

<read_first>
- `src/screens/book/BookSessionScreen.tsx` — current `topBar` markup
  (lines 260–282) and styles (lines 312–353). The new component replaces
  this block.
- `src/components/book/ModeToggle.tsx` — component contract (props it takes).
- `src/components/book/ReaderView.tsx` — `bgColor` formula at line 577.
</read_first>

<action>
Create `src/components/book/ReaderChrome.tsx` with this exact structure:

```typescript
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ModeToggle from './ModeToggle';
import type { BookSessionMode } from '@/navigation/types';

const ENTRY_SHOW_MS = 3000;
const AUTO_HIDE_MS = 4000;
const FADE_MS = 180;

export interface ReaderChromeProps {
  mode: BookSessionMode;
  showToggle: boolean;
  bgColor: string;
  textColor: string;
  onSwitchMode: (next: BookSessionMode) => void;
  onClose: () => void;
  onOpenMenu: () => void;
}

export interface ReaderChromeRef {
  reveal: () => void;
}

const ReaderChrome = forwardRef<ReaderChromeRef, ReaderChromeProps>(function ReaderChrome(
  { mode, showToggle, bgColor, textColor, onSwitchMode, onClose, onOpenMenu },
  ref,
) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const visibleRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const hide = () => {
    clearHideTimer();
    visibleRef.current = false;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
  };

  const scheduleAutoHide = (delayMs: number) => {
    clearHideTimer();
    hideTimer.current = setTimeout(hide, delayMs);
  };

  const reveal = () => {
    visibleRef.current = true;
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
    scheduleAutoHide(AUTO_HIDE_MS);
  };

  useImperativeHandle(ref, () => ({ reveal }), []);

  // Show on mount for ENTRY_SHOW_MS, then fade out.
  useEffect(() => {
    visibleRef.current = true;
    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
    scheduleAutoHide(ENTRY_SHOW_MS);
    return clearHideTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any interaction with the chrome resets the timer.
  const bumpTimer = () => {
    if (visibleRef.current) scheduleAutoHide(AUTO_HIDE_MS);
  };

  return (
    <>
      {/* Invisible reveal targets — always mounted, sit above page */}
      <Pressable
        style={[styles.topEdgeStrip, { top: insets.top }]}
        onPress={reveal}
        accessibilityLabel="Reveal reader controls"
      />
      <Pressable
        style={[styles.cornerTarget, { top: insets.top }]}
        onPress={reveal}
        accessibilityLabel="Reveal reader menu"
      />

      <Animated.View
        pointerEvents={visibleRef.current ? 'auto' : 'none'}
        style={[
          styles.chrome,
          {
            paddingTop: insets.top + 6,
            backgroundColor: bgColor,
            opacity,
          },
        ]}
        onTouchStart={bumpTimer}
      >
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close book"
          accessibilityRole="button"
        >
          <Text style={[styles.icon, { color: textColor }]}>✕</Text>
        </TouchableOpacity>

        <View style={styles.toggleSlot}>
          {showToggle && (
            <ModeToggle mode={mode} onChange={onSwitchMode} outOfSync={false} />
          )}
        </View>

        {mode === 'read' ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onOpenMenu}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Open reader menu"
            accessibilityRole="button"
          >
            <Text style={[styles.icon, { color: textColor }]}>⋯</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </Animated.View>
    </>
  );
});

export default ReaderChrome;

const styles = StyleSheet.create({
  // Full-width 72px tap strip — matches the previous ReaderView topTapStrip.
  topEdgeStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 72,
    zIndex: 20,
  },
  // 60x60 corner target sits below the Dynamic Island, right-aligned.
  cornerTarget: {
    position: 'absolute',
    right: 0,
    width: 60,
    height: 60,
    zIndex: 21,
  },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    opacity: 0.95,
    zIndex: 100,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '500',
  },
  toggleSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

Key implementation notes:
- `Pressable` (not `TouchableOpacity`) for reveal targets — no visual feedback,
  more reliable for invisible hit areas.
- `visibleRef` mirrors visibility synchronously so `pointerEvents` reflects
  the right state without re-renders.
- Auto-hide timer is cleared on unmount via the `useEffect` return.
- `mode === 'read'` gates the `⋯` menu icon — listen mode shows an empty
  spacer of equal width so the toggle stays centered.
</action>

<acceptance_criteria>
- New file `src/components/book/ReaderChrome.tsx` exists.
- Exports default `ReaderChrome` component (forwardRef) and the
  `ReaderChromeProps` and `ReaderChromeRef` types.
- Component mounts with chrome visible and `setTimeout` of 3000ms scheduled
  to fade it out.
- `reveal()` imperative method shows chrome and resets a 4000ms auto-hide.
- `topEdgeStrip` style spans full width, height 72, positioned at insets.top.
- `cornerTarget` style is 60×60, right-edge anchored, positioned at
  insets.top.
- Chrome `backgroundColor` is set from the `bgColor` prop (no hardcoded
  navy).
- The `⋯` menu button only renders when `mode === 'read'`.
- `useNativeDriver: true` on all `Animated.timing` calls.
- No changes to any other file in this task.
</acceptance_criteria>

---

## Task 2 — Wire `ReaderChrome` into `BookSessionScreen` and remove `topBar`

**Why:** The new component replaces the persistent toolbar. The container
also needs to stop painting navy, and we need to expose theme color and a
"open menu" handler that reaches into `ReaderView`.

<read_first>
- `src/screens/book/BookSessionScreen.tsx` — entire file (354 lines).
  Particularly lines 258–353 (JSX + styles) and the existing imports/refs.
- `src/components/book/ReaderView.tsx` — lines 622–627 (current
  `topTapStrip` — being removed in Task 3) and lines 629–656
  (`TopDrawerModal` usage). The `controlsVisible` state and the drawer
  modal stay; only the trigger moves.
</read_first>

<action>
Make these changes to `src/screens/book/BookSessionScreen.tsx`:

**(a)** Add imports near the top, alongside the existing component imports:

```typescript
import ReaderChrome, { ReaderChromeRef } from '@/components/book/ReaderChrome';
```

**(b)** Add a ref and theme state in the component body, near the existing
`readerRef` declaration (around line 50):

```typescript
const readerRef = useRef<ReaderViewRef>(null);
const chromeRef = useRef<ReaderChromeRef>(null);
const [theme, setTheme] = useState<'light' | 'dark' | 'sepia' | 'eink'>('light');
```

Add a `useEffect` to load the saved theme on mount (mirrors the read in
`ReaderView`):

```typescript
useEffect(() => {
  AsyncStorage.getItem('@whisper/theme').then((v) => {
    if (v === 'light' || v === 'dark' || v === 'sepia' || v === 'eink') {
      setTheme(v);
    }
  }).catch(() => {});
}, []);
```

Derive bg/text colors:

```typescript
const bgColor =
  theme === 'dark' ? '#121212'
  : theme === 'sepia' ? '#f5efe0'
  : '#ffffff';
const textColor = theme === 'dark' ? '#E8DFC8' : '#2A2520';
```

**(c)** Add a method on `ReaderViewRef` to open the drawer from outside.
This requires a small change in `ReaderView.tsx` — covered in Task 3.
For now, declare the handler:

```typescript
const handleOpenMenu = useCallback(() => {
  readerRef.current?.openMenu();
}, []);
```

**(d)** Replace the entire `topBar` JSX block (lines 260–282) with:

```typescript
<ReaderChrome
  ref={chromeRef}
  mode={mode}
  showToggle={showToggle}
  bgColor={bgColor}
  textColor={textColor}
  onSwitchMode={handleSwitchMode}
  onClose={() => navigation.goBack()}
  onOpenMenu={handleOpenMenu}
/>
```

The `ReaderChrome` JSX must be **after** the `body` View in source order
(or have higher zIndex) so its absolute-positioned chrome and tap targets
sit above the reader. Place it after the `</View>` that closes `body`,
inside the outer container `View`:

```typescript
return (
  <View style={[styles.container, { backgroundColor: bgColor }]}>
    <View style={styles.body}>
      {/* ReaderView and ListenView Animated.Views unchanged */}
    </View>

    <ReaderChrome
      ref={chromeRef}
      mode={mode}
      showToggle={showToggle}
      bgColor={bgColor}
      textColor={textColor}
      onSwitchMode={handleSwitchMode}
      onClose={() => navigation.goBack()}
      onOpenMenu={handleOpenMenu}
    />
  </View>
);
```

**(e)** Update `styles.container` — remove the hardcoded navy. The
`backgroundColor` is now set inline from `bgColor`:

```typescript
container: {
  flex: 1,
  // backgroundColor removed — set inline from theme
},
```

Remove the now-unused styles: `topBar`, `backBtn`, `backIcon`, `toggleSlot`,
`rightSlot`. Keep `body` and `viewLayer`.

</action>

<acceptance_criteria>
- `src/screens/book/BookSessionScreen.tsx` imports `ReaderChrome` from
  `@/components/book/ReaderChrome`.
- The file declares `chromeRef` of type `ReaderChromeRef`.
- The file declares `theme` state and reads `@whisper/theme` from
  AsyncStorage on mount.
- The file derives `bgColor` matching the formula in `ReaderView.tsx:577`.
- The original `<View style={[styles.topBar, ...]}>` block (former
  lines 260–282) is gone.
- A `<ReaderChrome>` element is rendered with all eight required props.
- `styles.container` no longer contains `backgroundColor: '#0D0D1A'` — the
  background is set inline from `bgColor`.
- The unused styles `topBar`, `backBtn`, `backIcon`, `toggleSlot`,
  `rightSlot` are removed.
- `handleOpenMenu` is defined and calls `readerRef.current?.openMenu()`.
</acceptance_criteria>

---

## Task 3 — Expose `openMenu()` on `ReaderViewRef` and remove the in-component tap strip

**Why:** The drawer (`controlsVisible` state and `TopDrawerModal`) lives
inside `ReaderView`. The new `ReaderChrome` button needs a way to open it.
The cleanest seam is one new imperative method. Also, the
`topTapStrip` inside `ReaderView` is now dead — `ReaderChrome` owns the
top-edge strip — and must be removed to avoid a duplicate hit area
(double-trigger).

<read_first>
- `src/components/book/ReaderView.tsx` — lines 106–111 (current
  `ReaderViewRef` interface), lines 157–201 (`useImperativeHandle`),
  lines 622–627 (`topTapStrip` being removed),
  lines 722–728 (`topTapStrip` style being removed).
</read_first>

<action>
**(a)** Extend the `ReaderViewRef` interface (lines 106–111):

BEFORE:
```typescript
export interface ReaderViewRef {
  getCurrentPosition: () => Promise<EpubPosition | null>;
  getLastKnownPosition: () => EpubPosition | null;
  getVisibleSnippet: (n?: number, timeoutMs?: number) => Promise<string[] | null>;
  syncToAudio: (timestampSeconds: number, audioChapterIdx: number) => Promise<void>;
}
```

AFTER:
```typescript
export interface ReaderViewRef {
  getCurrentPosition: () => Promise<EpubPosition | null>;
  getLastKnownPosition: () => EpubPosition | null;
  getVisibleSnippet: (n?: number, timeoutMs?: number) => Promise<string[] | null>;
  syncToAudio: (timestampSeconds: number, audioChapterIdx: number) => Promise<void>;
  openMenu: () => void;
}
```

**(b)** Add `openMenu` to `useImperativeHandle` (lines 157–201). Append to
the returned object, after `syncToAudio`:

```typescript
openMenu: () => setControlsVisible(true),
```

**(c)** Delete the `topTapStrip` JSX (lines 622–627):

REMOVE:
```typescript
<TouchableOpacity
  style={[styles.topTapStrip, { top: insets.top }]}
  onPress={() => setControlsVisible(true)}
  activeOpacity={1}
  accessibilityLabel="Open reader options"
/>
```

**(d)** Delete the `topTapStrip` style entry from the `StyleSheet.create`
block (lines 722–728):

REMOVE:
```typescript
topTapStrip: {
  position: 'absolute',
  left: 0,
  right: 0,
  height: 72,
  zIndex: 20,
},
```

**(e)** Leave `controlsVisible`, `TopDrawerModal`, and `ReaderDrawer`
**completely unchanged**. They are reached via the new `openMenu()` ref
method.
</action>

<acceptance_criteria>
- `ReaderViewRef` interface in `src/components/book/ReaderView.tsx`
  contains `openMenu: () => void;`.
- `useImperativeHandle` returns an object with an `openMenu` method that
  calls `setControlsVisible(true)`.
- The `topTapStrip` JSX block is gone (no `styles.topTapStrip` reference
  in render output).
- The `topTapStrip` style entry is gone from `StyleSheet.create`.
- `<TopDrawerModal visible={controlsVisible} ...>` and the inner
  `ReaderDrawer` are unchanged.
- `accessibilityLabel="Open reader options"` no longer appears in the file.
</acceptance_criteria>

---

## Task 4 — Sanity check: theme stays in sync between Reader and Chrome

**Why:** `ReaderChrome` reads `@whisper/theme` once on mount. If the user
opens the drawer and changes the theme, the chrome's `bgColor` will drift
out of sync until the screen remounts. Acceptable for v1 (auto-hide hides
the chrome quickly anyway), but we want the next theme reveal to look
right.

<read_first>
- `src/components/book/ReaderView.tsx` — `handleThemeChange` callback
  (lines 475–479).
</read_first>

<action>
Two reasonable options — pick the simpler one (option A):

**Option A (chosen):** Re-read `@whisper/theme` in `BookSessionScreen` each
time the chrome is revealed. Cheap and avoids a callback chain.

In `BookSessionScreen.tsx`, change the `handleOpenMenu` and add a tiny
`onChromeReveal`-style refresh. Simplest is to refresh the theme inside the
existing entry effect AND inside `handleSwitchMode` (called every time the
user toggles modes — covers the case where they change theme then switch
mode).

Add this helper near the theme effect:

```typescript
const refreshTheme = useCallback(() => {
  AsyncStorage.getItem('@whisper/theme').then((v) => {
    if (v === 'light' || v === 'dark' || v === 'sepia' || v === 'eink') {
      setTheme(v);
    }
  }).catch(() => {});
}, []);
```

Call `refreshTheme()` at the top of `handleSwitchMode` (before the early
returns). This costs one AsyncStorage read per mode switch — negligible.

</action>

<acceptance_criteria>
- `refreshTheme` callback is defined in `BookSessionScreen.tsx`.
- `refreshTheme()` is called at the top of `handleSwitchMode`.
- No new dependencies added to package.json.
</acceptance_criteria>

---

## Verification

```bash
# Confirm the new component file exists
ls src/components/book/ReaderChrome.tsx

# Confirm the chrome is wired in
grep -n "ReaderChrome" src/screens/book/BookSessionScreen.tsx

# Confirm topBar is gone from BookSessionScreen styles
grep -n "topBar\|#0D0D1A" src/screens/book/BookSessionScreen.tsx
# (expect: zero matches)

# Confirm topTapStrip is gone from ReaderView
grep -n "topTapStrip\|Open reader options" src/components/book/ReaderView.tsx
# (expect: zero matches)

# Confirm openMenu is exposed on ReaderViewRef
grep -n "openMenu" src/components/book/ReaderView.tsx
# (expect: 2 matches — interface and useImperativeHandle)

# TypeScript still compiles
npx tsc --noEmit 2>&1 | head -30
```

## UAT — Manual checklist (run on physical iPhone with notch)

1. Open a book — chrome appears for ~3 s with page-colored background, then fades.
2. While chrome is hidden, tap a paragraph — audio seeks (paragraph-tap-to-seek
   still works; chrome does not appear).
3. Tap top-edge anywhere along the strip — chrome appears.
4. Tap top-right corner (below notch) — chrome appears.
5. Wait ~4 s without interacting — chrome fades.
6. Reveal chrome → tap mode toggle → mode switches; chrome stays visible until
   the next 4 s timeout.
7. Reveal chrome → tap `⋯` → drawer opens with chapters/fonts/highlights as
   before.
8. Reveal chrome → tap ✕ → returns to library.
9. Switch to listen mode — chrome reveals on tap; `⋯` is hidden; toggle and
   ✕ work.
10. Change theme via the drawer to dark → close drawer → reveal chrome again
    → background matches dark page color (`#121212`).
11. Verify the Dynamic Island region: tapping directly on the island does
    nothing weird (system gesture only); tapping just to the right of it
    reveals chrome.
