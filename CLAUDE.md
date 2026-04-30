# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
expo start          # Start dev server (then press i for iOS, a for Android)
expo run:ios        # Build and run on iOS simulator
expo run:android    # Build and run on Android emulator
```

No lint or test scripts are configured. The `services/sync/__tests__/` directory has Jest tests but no runner is wired into package.json yet.

## Path Aliases

`@/` maps to `src/`. All internal imports use this — never use relative paths across feature boundaries.

## Architecture

**Whisper** is an audiobook+ebook reader that synchronizes audio playback with EPUB text. The two reading surfaces live in one screen and share a position system.

### Screen Structure

`BookSessionScreen` is the only reading screen. It renders `ReaderView` (EPUB) and `ListenView` (audio player) stacked via `Animated.View` opacity — both are **always mounted**, only visibility changes. Mode is toggled via `ModeToggle` → `handleSwitchMode`.

When switching read→listen: `getCurrentPosition()` on the WebView bridge → `readerToAudio()` converts to a timestamp → audio is seeked.  
When switching listen→read: `TrackPlayer.getProgress()` → `syncToAudio()` on the ReaderViewRef → `audioToReader()` converts to a CFI or chapter index → WebView navigates.

### EPUB Rendering

`EpubWebView` renders a local HTML file (`src/constants/epubBridgeHtml.ts`) inside `react-native-webview`. JavaScript is injected (`epubInjection.ts`) to bridge between React Native and epub.js running in the WebView. All WebView ↔ RN communication is via `postMessage` / `injectJavaScript`. Key bridge methods: `loadBookFromUri`, `goTo(cfi)`, `goToChapter(index)`, `getCurrentPosition()`, `getVisibleSnippet()`.

`getCurrentPosition()` is **async** (requires a round-trip to the live WebView). Use `getLastKnownPosition()` whenever you need the position synchronously (e.g., on navigation/unmount) — it reads a ref updated on every position change event, no bridge call.

### Position State

Three layers:
1. **React state** (`livePosition` via `useEpubPosition`) — updated immediately on every `POSITION_CHANGE` from WebView
2. **AsyncStorage** — debounced 2 s write; also written on `beforeRemove` (navigation away) via `getLastKnownPosition()`
3. **Firestore** — written after the debounce via `pushPosition`; reconciled across devices by `useSync`

Audio position mirrors this pattern inside `NowPlayingContext` + `useProgress`.

### Audio/EPUB Alignment

Alignment is the system that maps audio timestamps ↔ EPUB character positions. Three precision tiers, tried in order:

- **L1 (word anchors)** — Whisper/AssemblyAI transcription + DTW produces per-word timestamps paired with EPUB CFIs. Most precise.
- **L0.5 (paragraph weights)** — Paragraph character counts used to interpolate within a chapter. Returns a paragraph-level CFI.
- **L0 (proportional)** — Chapter boundaries only. `audioToReader` at L0 returns `cfi: ''` because a chapter-base CFI without an inner path crashes epub.js. Callers **must** check `target.cfi` before calling `goTo()` — fall back to `goToChapter(index)` only if the target chapter differs from the current one.

Alignment is built opportunistically: `useOpportunisticAlignment` calls `AlignerQueue.processNext()` while the app is active. Results are persisted in Firestore and cached via `alignmentStore.ts`. `getOrBuildLayer0` in `alignmentStore` is the entry point for all handoff conversions.

The conversion functions live in `src/services/sync/handoff.ts`: `readerToAudio`, `audioToReader`, `findAudioWordMatch`.

### State Management

No Zustand or Redux. State lives in:
- **React Context** — `NowPlayingContext` for audio playback state (book, chapters, playback controls)
- **Module-level singletons** — `pendingImportStore` (iOS "Open with" file handoff), `highlightStore`, alignment queue
- **AsyncStorage** — offline-first cache for books, positions, preferences, alignment data
- **Firestore** — source of truth for books and cross-device sync

### Firebase

Auto-initialized via `GoogleService-Info.plist` (iOS) / `google-services.json` (Android). Offline persistence is enabled. Book metadata and positions live at `users/{userId}/books/{bookId}`. Alignment job status is polled from a separate collection via `alignmentJobs.ts`.

### File Import (iOS)

Files arrive via `Linking` URL events. `App.tsx` classifies EPUB vs audio by extension → stores in `pendingImportStore` → `LibraryScreen` subscribes and processes (copies to cache dir, creates Firestore book entry).
