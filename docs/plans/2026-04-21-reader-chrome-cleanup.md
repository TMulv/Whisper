# Reader Chrome Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip all visible chrome from the reader view; surface all controls (audio, display, chapters) in a single top drawer revealed by a Kindle-style tap at the top.

**Architecture:** Move audio transport out of `ImmersionBar` into a new reusable `AudioTransport` component. Rename `ReaderControls` → `ReaderDrawer` and add an `Audio` tab plus a header row (Home / title / close). Wrap it in a new `TopDrawerModal` that slides from the top. `ReaderScreen` loses its top-left back button, top-right audio button, centre tap zone, and bottom ImmersionBar mount — replaced by a single top-strip `TouchableOpacity`. Hide the parent tab bar on focus via `navigation.getParent()?.setOptions`.

**Tech Stack:** React Native 0.81, Expo 54, React Navigation v7 (native-stack + bottom-tabs), TypeScript strict, AsyncStorage. No Jest config present for UI — manual verification + `tsc --noEmit`.

**Reference spec:** `docs/superpowers/specs/2026-04-21-reader-chrome-cleanup-design.md`

---

## Testing approach

This project has no UI test harness. Validation per task is:

1. **Type check:** `npx tsc --noEmit` must pass.
2. **Manual smoke test:** the task's acceptance criteria (below each task).

Unit tests only exist for pure services under `src/services/sync/` and are not relevant here.

Each task ends with a commit.

---

## Task 1: Promote audio transport out of ImmersionBar into a reusable AudioTransport

**Files:**
- Create: `src/components/reader/AudioTransport.tsx`
- Reference only (do not modify yet): `src/components/reader/ImmersionBar.tsx`

**Step 1: Read `ImmersionBar.tsx` in full**

Read the existing component to see its exact transport UI (play/pause, scrubber, position/duration, rate cycler, prev/next chapter). Copy the transport UI verbatim into the new file — do not redesign here.

**Step 2: Create `AudioTransport.tsx`**

Props interface:

```tsx
interface Props {
  isPlaying: boolean;
  position: number;
  duration: number;
  currentChapter: M4BChapter | null;
  chapters: M4BChapter[];
  playbackRate: number;
  onRateChange: (rate: number) => void;
  immersionActive: boolean;
  onImmersionToggle: (active: boolean) => void;
}
```

Content:
- `Immersion` toggle row at the top — `Switch` from `react-native` labelled "Follow along with audio". Calls `onImmersionToggle`.
- Below the toggle: the transport UI copied from `ImmersionBar` (chapter title row, scrubber, position/duration, prev/play/next, rate chip).
- Uses the `trackPlayerService` functions (`play`, `pause`, `seekToTimestamp`, `skipForward`, `skipBackward`, `setRate`) the same way `ImmersionBar` does.
- Styling: light panel (white bg, dark-grey text). No dark-navy floating bar. Padding `16px`.

Do **not** include an `onClose` button — close is owned by the drawer header.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: passes with no new errors.

**Step 4: Commit**

```bash
git add src/components/reader/AudioTransport.tsx
git commit -m "feat(reader): extract AudioTransport from ImmersionBar"
```

**Acceptance:** New component exists, compiles. Not yet wired anywhere.

---

## Task 2: Rename ReaderControls → ReaderDrawer, add header row

**Files:**
- Rename + modify: `src/components/reader/ReaderControls.tsx` → `src/components/reader/ReaderDrawer.tsx`
- Modify: `src/screens/reader/ReaderScreen.tsx` (import path + usage only; drawer wiring comes later)

**Step 1: Move file**

```bash
git mv src/components/reader/ReaderControls.tsx src/components/reader/ReaderDrawer.tsx
```

**Step 2: Update the file's default export name**

In `ReaderDrawer.tsx` change `export default function ReaderControls(...)` to `export default function ReaderDrawer(...)`. Update internal references if any (none expected).

**Step 3: Add header row above the tab bar**

New props on the `Props` interface:

```tsx
bookTitle?: string;
onHome: () => void;
```

Above the existing `<View style={styles.tabBar}>`, add a header row:

```tsx
<View style={styles.header}>
  <TouchableOpacity onPress={onHome} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.headerBtn}>
    <Text style={styles.headerHome}>‹ Home</Text>
  </TouchableOpacity>
  {bookTitle ? (
    <Text style={styles.headerTitle} numberOfLines={1}>{bookTitle}</Text>
  ) : <View style={{ flex: 1 }} />}
  <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.headerBtn}>
    <Text style={styles.headerClose}>✕</Text>
  </TouchableOpacity>
</View>
```

Remove the existing `closeBtn` from the tab bar row (it moves into the new header).

Styles:

```ts
header: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingTop: 14,
  paddingBottom: 10,
  gap: 8,
},
headerBtn: { paddingVertical: 4, paddingHorizontal: 4 },
headerHome: { fontSize: 15, color: '#1A1A2E', fontWeight: '600' },
headerTitle: { flex: 1, textAlign: 'center', fontSize: 14, color: '#555', fontWeight: '500' },
headerClose: { fontSize: 16, color: '#888' },
```

Also: the existing `handle` (grey pill) at the very top made sense for a bottom sheet. For a top drawer it should move to the *bottom* of the panel. Move the `<View style={styles.handle} />` element to appear after all tab content, and update its margins:

```ts
handle: {
  width: 36, height: 4, backgroundColor: '#DDD', borderRadius: 2,
  alignSelf: 'center', marginTop: 6, marginBottom: 10,
},
```

**Step 4: Update `ReaderScreen.tsx` import and usage**

Replace:
```tsx
import ReaderControls, { ... } from '@/components/reader/ReaderControls';
```
with:
```tsx
import ReaderDrawer, { ... } from '@/components/reader/ReaderDrawer';
```

Where `<ReaderControls ... />` is rendered, change the component name to `<ReaderDrawer ... />` and pass the two new props:

```tsx
<ReaderDrawer
  {...existingProps}
  bookTitle={undefined /* wired in Task 5 */}
  onHome={() => { setControlsVisible(false); navigation.goBack(); }}
/>
```

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(reader): rename ReaderControls to ReaderDrawer, add header row"
```

**Acceptance:** Reader drawer opens as before (still from bottom); header row shows Home/✕; app builds.

---

## Task 3: Add Audio tab to ReaderDrawer

**Files:**
- Modify: `src/components/reader/ReaderDrawer.tsx`
- Reference: `src/components/reader/AudioTransport.tsx`

**Step 1: Extend props**

Add to the `Props` interface:

```tsx
// Audio
hasAudio: boolean;          // audio is loaded in the player for this book
bookHasAudio: boolean;      // audio file exists on disk but is not loaded
isPlaying: boolean;
position: number;
duration: number;
currentChapter: M4BChapter | null;
audioChapters: M4BChapter[];
playbackRate: number;
onRateChange: (rate: number) => void;
immersionActive: boolean;
onImmersionToggle: (active: boolean) => void;
startingAudio: boolean;
onStartAudio: () => void;
```

Import `M4BChapter` from `@/types/sync` and `AudioTransport` from `./AudioTransport`.

**Step 2: Widen the tab type**

```tsx
const [tab, setTab] = useState<'audio' | 'display' | 'chapters'>('display');
```

**Step 3: Conditionally render the Audio tab button**

Render the Audio tab button first (left-most) only when `hasAudio || bookHasAudio`:

```tsx
{(hasAudio || bookHasAudio) && (
  <TouchableOpacity
    style={[styles.tab, tab === 'audio' && styles.tabActive]}
    onPress={() => setTab('audio')}
  >
    <Text style={[styles.tabText, tab === 'audio' && styles.tabTextActive]}>Audio</Text>
  </TouchableOpacity>
)}
```

**Step 4: Render the Audio tab body**

Above the `tab === 'display' ? ... : ...` ternary, convert to explicit branches:

```tsx
{tab === 'audio' ? (
  hasAudio ? (
    <AudioTransport
      isPlaying={isPlaying}
      position={position}
      duration={duration}
      currentChapter={currentChapter}
      chapters={audioChapters}
      playbackRate={playbackRate}
      onRateChange={onRateChange}
      immersionActive={immersionActive}
      onImmersionToggle={onImmersionToggle}
    />
  ) : (
    <View style={styles.startAudioPane}>
      <TouchableOpacity
        style={styles.startAudioBtn}
        onPress={onStartAudio}
        disabled={startingAudio}
      >
        {startingAudio
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.startAudioBtnText}>▶  Start audiobook</Text>}
      </TouchableOpacity>
    </View>
  )
) : tab === 'display' ? (
  /* existing display scroll view */
) : (
  /* existing chapter list */
)}
```

Add styles:

```ts
startAudioPane: { padding: 24, alignItems: 'center' },
startAudioBtn: {
  backgroundColor: '#1A1A2E',
  paddingHorizontal: 28, paddingVertical: 14, borderRadius: 24,
  minWidth: 180, alignItems: 'center',
},
startAudioBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
```

Import `ActivityIndicator` from `react-native`.

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: passes (consumer will fail to pass the new props — that's Task 5).

If the consumer fails typecheck, temporarily default the new props to keep this task isolated:

```tsx
hasAudio = false, bookHasAudio = false, isPlaying = false, position = 0,
duration = 0, currentChapter = null, audioChapters = [], playbackRate = 1,
onRateChange = () => {}, immersionActive = false,
onImmersionToggle = () => {}, startingAudio = false, onStartAudio = () => {},
```

Remove these defaults in Task 5 once the consumer provides them.

**Step 6: Commit**

```bash
git add src/components/reader/ReaderDrawer.tsx
git commit -m "feat(reader): add Audio tab to drawer"
```

**Acceptance:** Type check passes. Drawer still opens from bottom (for now); Audio tab button appears when audio is available.

---

## Task 4: Build TopDrawerModal (slides from top)

**Files:**
- Create: `src/components/reader/TopDrawerModal.tsx`

**Step 1: Create the component**

```tsx
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}

export default function TopDrawerModal({ visible, onDismiss, children }: Props) {
  const insets = useSafeAreaInsets();
  const translate = useRef(new Animated.Value(-1)).current; // -1 = offscreen
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translate, {
        toValue: visible ? 0 : -1,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, translate, opacity]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <TouchableWithoutFeedback onPress={onDismiss}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>
      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[
          styles.panel,
          {
            paddingTop: insets.top,
            transform: [
              {
                translateY: translate.interpolate({
                  inputRange: [-1, 0],
                  outputRange: [-700, 0],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  panel: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 12,
    maxHeight: '85%',
  },
});
```

Note the `-700` — a constant that exceeds any realistic drawer height. It's fine to over-translate; the panel is hidden above the viewport when closed.

**Step 2: Adjust ReaderDrawer for top-anchored layout**

In `ReaderDrawer.tsx`, remove the `borderTopLeftRadius` / `borderTopRightRadius` / `shadowOffset { height: -3 }` on the `panel` style — those come from the outer `TopDrawerModal` now. Keep internal layout (`maxHeight: '78%'` → `maxHeight: '100%'` since the wrapper caps it).

Actually simpler: delete the outer `<View style={styles.panel}>` wrapper from `ReaderDrawer` entirely — the modal provides the panel chrome. Return a `<>` fragment wrapping `[header, tabBar, content, handle]`.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

**Step 4: Commit**

```bash
git add src/components/reader/TopDrawerModal.tsx src/components/reader/ReaderDrawer.tsx
git commit -m "feat(reader): add TopDrawerModal, remove panel chrome from ReaderDrawer"
```

**Acceptance:** Type check passes. Component exists but not yet used by screen.

---

## Task 5: Wire ReaderScreen to the new drawer; strip old chrome

**Files:**
- Modify: `src/screens/reader/ReaderScreen.tsx`

**Step 1: Replace the modal**

Replace the existing `<Modal ... transparent animationType="slide">...</Modal>` block with:

```tsx
<TopDrawerModal visible={controlsVisible} onDismiss={() => setControlsVisible(false)}>
  <ReaderDrawer
    chapters={chapters}
    currentChapterIndex={currentChapterIndex}
    fontSize={fontSize}
    theme={theme}
    fontFamily={fontFamily}
    margin={margin}
    onFontSizeChange={handleFontSizeChange}
    onThemeChange={handleThemeChange}
    onFontFamilyChange={handleFontFamilyChange}
    onMarginChange={handleMarginChange}
    onChapterSelect={(idx) => { handleChapterSelect(idx); setControlsVisible(false); }}
    onClose={() => setControlsVisible(false)}
    bookTitle={/* see Step 2 */ undefined}
    onHome={() => { setControlsVisible(false); navigation.goBack(); }}
    hasAudio={hasAudio}
    bookHasAudio={bookHasAudio}
    isPlaying={immersion.isPlaying}
    position={immersion.position}
    duration={immersion.duration}
    currentChapter={immersion.currentAudioChapter}
    audioChapters={audioChapters}
    playbackRate={immersionRate}
    onRateChange={setImmersionRate}
    immersionActive={immersionActive}
    onImmersionToggle={setImmersionActive}
    startingAudio={startingAudio}
    onStartAudio={handleStartAudio}
  />
</TopDrawerModal>
```

Import `TopDrawerModal` from `@/components/reader/TopDrawerModal`. Remove the now-unused `Modal` import from `react-native`.

**Step 2: Fetch book title for the drawer header**

The book title is available via `nowPlayingBook?.title` when this book is loaded in the player. For the general case, load it once on mount:

Add state:
```tsx
const [bookTitle, setBookTitle] = useState<string | undefined>(undefined);
```

In the existing `useEffect` that reads `localListBooks` (around line 198), also set the title:
```tsx
if (meta?.title) setBookTitle(meta.title);
```

Pass `bookTitle={bookTitle}` into the drawer.

**Step 3: Replace centre tap zone with top tap strip**

Delete:
```tsx
<TouchableOpacity style={[styles.tapZoneCenter, { top: insets.top }]} ... />
```
and its `tapZoneCenter` style entry.

Add a top-strip `TouchableOpacity` (full width, below status bar):
```tsx
<TouchableOpacity
  style={[styles.topTapStrip, { top: insets.top, height: 72 }]}
  onPress={() => setControlsVisible(true)}
  activeOpacity={1}
  accessibilityLabel="Open reader options"
/>
```
Style:
```ts
topTapStrip: {
  position: 'absolute',
  left: 0, right: 0,
  zIndex: 20,
},
```

**Step 4: Remove top-left back button**

Delete the `<TouchableOpacity style={[styles.backIcon, ...`  block and its `backIcon`, `backIconBubble`, `backIconText` style entries.

**Step 5: Remove top-right audio button stack**

Delete the `{(hasAudio || bookHasAudio) && <View style={[styles.topRightStack, ...`  block and its `topRightStack`, `topRightBtn`, `immersionIconActive` style entries.

**Step 6: Remove bottom ImmersionBar mount**

Delete the `{immersionActive && <View style={[styles.immersionBarContainer, ...`  block and its `immersionBarContainer` style entry. Remove the `ImmersionBar` import.

**Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

**Step 8: Commit**

```bash
git add src/screens/reader/ReaderScreen.tsx
git commit -m "feat(reader): strip chrome, wire top drawer modal"
```

**Acceptance (manual):**
- Open a book. Reader shows only the page — no back button, no audio button, no bottom bar (app tab bar still visible at this step — Task 6 handles it).
- Tap the top strip → drawer slides down from the top with Home / close / tab bar.
- Display and Chapters tabs still work.
- Audio tab appears for books with audio and allows starting audio + toggling immersion.
- Dismiss via backdrop tap, ✕, or Home (Home navigates back).

---

## Task 6: Hide the parent tab bar while the reader is focused

**Files:**
- Modify: `src/screens/reader/ReaderScreen.tsx`

**Step 1: Add a focus effect**

After the existing effects, add:

```tsx
useEffect(() => {
  const parent = navigation.getParent();
  parent?.setOptions({ tabBarStyle: { display: 'none' } });
  return () => {
    parent?.setOptions({
      tabBarStyle: {
        borderTopWidth: 0,
        backgroundColor: '#FAF7F1',
        height: 64 + (Platform.OS === 'ios' ? 18 : 0),
        paddingTop: 6,
      },
    });
  };
}, [navigation]);
```

The restore values mirror `MainTabNavigator`'s `tabBarStyle`. If those change in the future, both must update — acceptable given the tight scope.

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

**Step 3: Commit**

```bash
git add src/screens/reader/ReaderScreen.tsx
git commit -m "feat(reader): hide tab bar while reader is focused"
```

**Acceptance (manual):**
- Open a book → tab bar disappears.
- Go back to Library → tab bar is restored with its original styling.
- Navigate back and forth multiple times → tab bar hides/shows correctly each time.

---

## Task 7: Delete ImmersionBar

**Files:**
- Delete: `src/components/reader/ImmersionBar.tsx`

**Step 1: Confirm no remaining imports**

```bash
npx grep -r "ImmersionBar" src/
```
Expected: no results.

If any remain, fix them first (they should have been removed in Task 5).

**Step 2: Delete the file**

```bash
git rm src/components/reader/ImmersionBar.tsx
```

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

**Step 4: Commit**

```bash
git commit -m "chore(reader): remove unused ImmersionBar"
```

**Acceptance:** File gone; build + typecheck pass.

---

## Task 8: End-to-end manual smoke test

No file changes. Manual verification only.

**Scenarios to exercise:**

1. **Book with no audio**
   - Open from Library. Reader shows only the page.
   - Tap top → drawer opens. Tab bar shows only `[Display] [Chapters]` (no Audio tab).
   - Change font size / theme / margin → changes reflect on close.
   - Select a chapter → drawer dismisses, reader jumps.
   - Home → returns to Library; tab bar restored.

2. **Book with audio, not yet started**
   - Open from Library.
   - Tap top → drawer shows `[Audio] [Display] [Chapters]`. Audio tab has `▶ Start audiobook` button.
   - Press Start audiobook → audio begins, Audio tab now shows transport + immersion toggle.

3. **Book with audio, immersion on**
   - Immersion toggle on → reader auto-scrolls with audio.
   - Close drawer → reader is chrome-free; text still auto-scrolls.
   - Tap top → drawer shows live scrubber position and play state.
   - Tap a paragraph → audio seeks to that paragraph (existing behaviour preserved).

4. **Gesture safety**
   - From top edge of screen pull down for iOS Control Center (top-right) and Android notification shade → opens OS UI, does *not* open the drawer.

5. **SyncBanner**
   - If a cross-device audio sync is pending, the `SyncBanner` still renders at the top above content when the reader opens.

**If any scenario fails, file a follow-up task. Do not proceed to merge until all pass.**

---

## Rollback plan

Each task is a self-contained commit. If a later task breaks something, `git revert <sha>` of that one commit should back it out cleanly. The deletion of `ImmersionBar` (Task 7) is the most destructive — verify Task 5–6 work before landing Task 7.
