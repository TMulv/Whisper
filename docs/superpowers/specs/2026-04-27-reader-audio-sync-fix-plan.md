# Reader ↔ Audio Sync — Fix Plan (revised)

**Date:** 2026-04-27
**Status:** Approved
**Supersedes:** earlier draft of this file (which misdiagnosed the bridge as the source of the bug — see "Misdiagnosis" below)

## Real root cause

Every book-import path in `src/screens/library/LibraryScreen.tsx` (lines 625, 700, 772, 844) writes the book record with `totalDurationSeconds: 0`. Nothing ever fills it in.

Downstream consequence:

1. `prepareBookForPlayback.ts:35` calls `createFallbackChapter(book.totalDurationSeconds)` → `[{ startSeconds: 0, endSeconds: 0 }]`.
2. `alignmentBuilder.buildLayer0` produces a single chapter with `audioStartSeconds=0, audioEndSeconds=0`.
3. `handoff.ts → readerToAudio` L0 tier computes `0 + percent * (0 − 0) = 0`.

Every reader→audio handoff lands at 0:00, regardless of where the user is in the book. Confirmed by runtime log:

```
[readerToAudio] L0 tier returned 0 timestamp despite non-zero epub percent
  { audioStart: 0, audioEnd: 0, epubPercent: 0.0317, alignmentChapterCount: 1 }
```

The bridge, `getCurrentPosition`, `chapterFraction`, `LOCATIONS_READY` payload, and `handoff.ts` math are all working correctly. The alignment is being built from zero-duration chapter data.

## Changes

### 1. Probe duration at import — `src/services/audio/audioProbe.ts` (new)

```ts
import TrackPlayer from 'react-native-track-player';
import { setupPlayer } from './trackPlayerService';

/** Load the file briefly to read its duration, then clear the queue. */
export async function probeAudioDuration(uri: string): Promise<number> {
  await setupPlayer();
  await TrackPlayer.reset();
  await TrackPlayer.add({ id: 'probe', url: uri, title: '', artist: '' });
  // getDuration resolves once metadata is ready. Track Player v4 returns 0
  // immediately if metadata isn't loaded yet — poll briefly with a cap.
  let d = await TrackPlayer.getDuration();
  const start = Date.now();
  while (d <= 0 && Date.now() - start < 3000) {
    await new Promise((r) => setTimeout(r, 100));
    d = await TrackPlayer.getDuration();
  }
  await TrackPlayer.reset();
  return d > 0 ? d : 0;
}
```

### 2. Use it in all four import sites — `src/screens/library/LibraryScreen.tsx`

Replace `totalDurationSeconds: 0` at lines 625, 700, 772, 844 with the probed value:

```ts
const totalDurationSeconds = await probeAudioDuration(audio.uri);
const bookData = {
  ...,
  totalDurationSeconds,
  ...
};
```

Wrap in try/catch — fall back to 0 only if the probe genuinely fails (corrupt file). Show a toast when that happens so the user knows sync won't work.

### 3. Self-heal already-imported books — `src/services/audio/prepareBookForPlayback.ts`

After loading `book` and computing `localAudioUri`, before `createFallbackChapter`:

```ts
let totalDuration = book.totalDurationSeconds;
if (totalDuration <= 0) {
  totalDuration = await probeAudioDuration(localAudioUri);
  if (totalDuration > 0) {
    await localWriteBook(userId, bookId, { ...book, totalDurationSeconds: totalDuration, updatedAt: Date.now() });
    logger.info('prepareBookForPlayback: backfilled totalDurationSeconds', { bookId, totalDuration });
  }
}
let chapters = createFallbackChapter(totalDuration);
```

Pass `totalDuration` (not `book.totalDurationSeconds`) into both `createFallbackChapter` and the eventual `localBook.totalDurationSeconds` field passed to `loadBook`. This unblocks the user's existing "King of Kings" book on next play.

### 4. Remove Pin button (per Q1 in discuss-phase)

Pin is no longer needed once auto-save works (it already worked — the bridge wasn't the bug — but it was writing a position that resolved to a 0-duration alignment, so it had no effect). Auto-save on `beforeRemove` and AppState blur covers the use case.

- `ReaderScreen.tsx`: remove `handlePinPosition`, `pinSaved` state, `setTimeout` toast clear, `pinSavedToast` style, and `onPinPosition` prop.
- `ReaderDrawer.tsx`: remove `onPinPosition` prop and the Pin UI element.

### 5. Consume `pendingCfiRef` on `LOCATIONS_READY` — `ReaderScreen.tsx`

Add:

```ts
useEffect(() => {
  if (!locationsReady) return;
  const cfi = pendingCfiRef.current;
  if (!cfi) return;
  pendingCfiRef.current = null;
  webViewRef.current?.goTo(cfi);
}, [locationsReady]);
```

`pendingCfiRef.current` is set at `ReaderScreen.tsx:365` for the "open book without `resumeFromAudio`" path but never read — so reopens currently always render at the beginning until a position update fires. Independent of the duration bug, but worth doing in the same change.

Do NOT also navigate from this effect when `params.resumeFromAudio` was true; that path already navigates via its own `setTimeout(1000)`. The two paths are mutually exclusive in the load effect (`else if (saved?.cfi)`), so no race in the current shape — but to defend against future maintainers, clear `pendingCfiRef.current` at the top of the `resumeFromAudio` branch around line 331.

## Not changing

- **Bridge** (`src/constants/epubBridgeHtml.ts`) — already correctly emits `getCurrentPosition` / `POSITION_RESULT` / `chapterFraction` / position-bearing `LOCATIONS_READY`. Earlier draft of this plan targeted the stale `assets/epub-bridge/epub-bridge.html`, which is not the runtime bridge. Independent reviewer (Plan agent) caught the mistake.
- **`handoff.ts` M=1 guard** — keep `alignment.chapters.length > 1`. For M=1 + N>1 books (single-chapter audio paired with multi-chapter epub), `chapterFraction` is the page fraction within the *current spine item*, not the book — multiplying it by audio duration would be wildly wrong. The pre-L0 tier is only safe when M=1 *and* N=1, and we don't currently track N in the alignment. Skip.
- **AssemblyAI L1 anchor pipeline** — already built and wired; will progressively refine accuracy from chapter-level (post-fix) to sentence-level as transcription completes.

## Misdiagnosis (recorded for memory)

The earlier draft of this plan claimed the bridge was missing `getCurrentPosition`, `chapterFraction`, and position data in `LOCATIONS_READY`. That diagnosis was based on inspecting `assets/epub-bridge/epub-bridge.html`, which is a stale reference copy. The actual runtime bridge — imported by `EpubWebView.tsx` from `@/constants/epubBridgeHtml` — is `src/constants/epubBridgeHtml.ts` and already implements all three. The "Pin shows Saved" datapoint in user testing was the smoking gun that disproved the bridge-side hypothesis, since Pin's success requires `getCurrentPosition` to work and to return `percentComplete > 0`. The actual broken signal was the L0 warning log showing `audioStart=0, audioEnd=0`.

Lesson for future debugging: when a `webpack`-style asset dir and a `.ts` constant both exist with similar names, verify which one the runtime imports before instrumenting either.

## Test plan

After fix:

1. Import a fresh m4b + epub pair → confirm book record's `totalDurationSeconds` is non-zero (log line "backfilled" should NOT fire on next open).
2. Open existing "King of Kings" book → confirm "backfilled totalDurationSeconds" log → close → reopen → log doesn't fire again (persisted).
3. Read to ~3% in reader → tap Start Audio → audio starts at ~3% × duration (≈ 30 min into a 16h audiobook), not 0:00. Verify against the `prepareBookForPlayback: used epub position` log: `startTimestamp` should equal `epubPercent × duration` within rounding.
4. Play audio for several minutes → close player → open reader without `resumeFromAudio` (i.e. via library) → reader lands at the position the audio reached, not the beginning (this exercises change #5).
5. Probe failure path: corrupt or missing audio file → import shows toast "Couldn't read audio duration; sync will be inaccurate" → book is created with duration 0 (degraded but not broken).
