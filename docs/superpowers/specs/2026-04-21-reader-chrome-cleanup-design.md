# Reader Chrome Cleanup — Design

**Date:** 2026-04-21
**Status:** Approved (pending implementation)

## Goal

Make the reader view look clean and uncluttered. All controls collapse into a single top-drawer panel revealed by a Kindle-style tap at the top of the screen. No visible chrome while reading.

## Current state

Reader currently shows:
- Top-left: back chevron bubble
- Top-right: 🎧 immersion toggle or ▶ "start audio" button
- Invisible centre tap zone (30%–70% width, 60pt tall) that opens a bottom-sheet settings modal
- Bottom ImmersionBar when audio immersion is active
- App tab bar (Library / Files / + / Settings), inherited from the parent tab navigator because `ReaderScreen` doesn't suppress it

Settings live in a bottom-sheet (`ReaderControls`) with two tabs: `Display` and `Chapters`.

## Target state

### What disappears from the reader

- Top-left back chevron
- Top-right audio / immersion button
- Bottom ImmersionBar (folded into the drawer)
- Invisible centre tap zone (replaced by a top tap strip)
- App tab bar — hidden specifically on the Reader screen

### What appears on tap

A single **top drawer** slides down from the top with a dimmed backdrop. Contents:

- **Header row:** `← Home` (left) · book title (centre, subtle — truncated to one line) · `✕` (right)
- **Tabs:** `[Audio] [Display] [Chapters]` — Audio tab hidden entirely when this book has no audio
- **Audio tab:** audio transport (play/pause, scrubber, position/duration, rate cycler, prev/next chapter) + immersion toggle; or a `▶ Start audiobook` button when audio is downloaded but not loaded in the player
- **Display tab:** text size, font family, margins, theme (unchanged from today)
- **Chapters tab:** chapter list (unchanged from today)

### Reveal gesture

- **Tap strip** — full-width, ~72pt tall, starts just below the status bar (not at the very top edge, so it does not conflict with the iOS Control Center pull or the Android notification shade). Invisible.
- **No swipe-down gesture.** Tap is the only reveal. This is the explicit design choice — Kindle-style — so OS-level pull-downs remain reliable.

### Dismiss

- Tap backdrop
- Tap `✕` in drawer header
- Back gesture / hardware back (Android): dismisses drawer before exiting reader

### Behaviour preserved from today

- Loading overlay, error overlay, `SyncBanner`, `WordLookupModal`, tap-seek toast
- Paragraph-tap seeks audio when immersion is live
- Status bar stays hidden
- Position persistence and sync push on chapter change
- Chapter-text background cache for on-device aligner

### Audio-state visibility while drawer is closed

**None.** The reader is 100% chrome-free. The auto-scrolling text during immersion is itself the signal that audio is playing. Users access transport controls by tapping the top strip.

## Architecture

Small, isolated changes. Each unit has a single responsibility.

### 1. `src/screens/reader/ReaderScreen.tsx`

- Remove: top-left back button, top-right action stack, bottom `ImmersionBar` mount, centre tap zone.
- Add: top tap strip (`TouchableOpacity`, full width, `top: insets.top`, `height: 72`, `activeOpacity: 1`).
- Replace the bottom-sheet modal invocation with `TopDrawerModal`.
- Pass drawer all state it needs: chapters, current chapter index, font settings, theme, margin, audio props (hasAudio, bookHasAudio, immersionActive, immersion state, transport handlers), and `onHome` / `onClose` callbacks.
- Add screen-focus effect that hides the parent tab bar while this screen is focused, restoring it on blur (via `navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } })`).

### 2. `src/components/reader/TopDrawerModal.tsx` *(new)*

- Thin wrapper around `Modal` with `transparent`, `statusBarTranslucent`, and a custom top-slide animation using `Animated.View` (translateY from `-height` to `0`).
- Backdrop dims below the panel and dismisses on tap.
- Renders `ReaderDrawer` as its content.

### 3. `src/components/reader/ReaderDrawer.tsx` *(renamed from `ReaderControls.tsx`)*

- Adds the header row (Home, title, close).
- Adds an `Audio` tab to the existing `Display` / `Chapters` tab bar. Tab row conditionally renders `Audio` only when `hasAudio || bookHasAudio`.
- Audio tab body is a new `<AudioTransport>` component (see §4) when audio is loaded; otherwise a `Start audiobook` button calling the existing `handleStartAudio` flow.
- Display and Chapters tabs keep their current UI.
- Panel anchors to the *top* of the modal content area (not the bottom). Rounded bottom corners; top flush with safe area.

### 4. `src/components/reader/AudioTransport.tsx` *(new, promoted out of `ImmersionBar.tsx`)*

- Consolidates the play/pause, scrubber, position/duration, rate cycler, prev/next-chapter controls that today live in `ImmersionBar`.
- Adds an `Immersion` toggle (so the user can enable/disable the sync-scroll feature from within the drawer).
- Styled to sit inside the drawer (not the dark-navy floating bar look of today's `ImmersionBar`). The drawer itself uses the app's default light panel styling regardless of the reader theme — the drawer is chrome, not reading surface.
- Calls the existing `trackPlayerService` functions (`play`, `pause`, `seekToTimestamp`, `skipForward`, `skipBackward`, `setRate`) directly, same as `ImmersionBar` does today.

### 5. `src/components/reader/ImmersionBar.tsx`

- **Deleted.** No other callers. Its logic migrates into `AudioTransport`.

### 6. `src/navigation/MainTabNavigator.tsx`

- No change — tab-bar hiding is driven from `ReaderScreen` via `navigation.getParent()?.setOptions(...)` so the hiding logic lives with the screen that needs it.

## Data flow

No new state or storage.

- Drawer open/closed: local `ReaderScreen` state (`drawerVisible: boolean`), replaces `controlsVisible`.
- Active tab: local `ReaderDrawer` state (default `display`).
- Audio state: flows from `NowPlayingContext` + `useImmersionReading` into `ReaderScreen`, then down into `ReaderDrawer` → `AudioTransport`.
- Persisted settings (font size / family / margin / theme): existing `AsyncStorage` keys unchanged.

## Testing strategy

- **Manual:** verify that reader view shows no chrome; tapping the top strip opens the drawer; backdrop dismiss works; Home returns to Library; each tab renders and functions; Audio tab is hidden for audio-less books; tab bar is hidden on reader and restored on Library/Files/Settings.
- **Regression:** immersion sync-scrolling still works when toggled on from the Audio tab; tap-to-seek on paragraphs still works; word lookup still works; loading/error overlays still behave.
- **Gesture safety:** iOS Control Center pull from top-right edge still works; Android notification shade pull still works.

## Out of scope

- Redesigning the display/theme controls themselves
- Adding new audio features (variable-speed scrubbing, chapter bookmarks, etc.)
- Changing the tab-bar design for the rest of the app
- Any changes to `BookDetailScreen`, `PlayerScreen`, or `MiniPlayer`
