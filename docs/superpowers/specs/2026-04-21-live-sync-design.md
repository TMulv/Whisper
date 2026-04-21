# 2026-04-21 — Live Reader↔Audio Sync

## Symptom

> "The audio and the words are not syncing up at all. How can we id what page
> the reader is on, and what part of the m4b it is. And vice versa. So when
> the reader switches to audio it picks up on the page he was on, and when he
> switches back to reader it opens to the page the audio was on."

## Root cause (three gaps)

1. **No L1 anchors exist yet.** `whisper.rn` is not installed and the cloud
   worker is not deployed, so `stubWhisperAdapter` throws and no
   `SentenceAnchor[]` are ever written. Every handoff falls through to
   proportional-within-chapter math, which at best lands you at the chapter's
   starting CFI. For a 45-minute chapter that looks like "no sync."

2. **Immersion mode is chapter-only.** `useImmersionReading` only calls
   `webViewRef.current?.goToChapter(idx)` when the audio chapter index flips.
   Inside a chapter, the reader never moves, so the words visibly lag by tens
   of minutes.

3. **Two entry points bypass the handoff resolver.**
   - `PlayerScreen`'s epub "Jump there" banner computes
     `percentComplete * duration` — raw whole-book percent × audio duration,
     ignoring chapter boundaries entirely. 2% of a 20 h book is 24 minutes of
     drift.
   - `ReaderScreen.handlePositionChange` only seeks audio to
     `audioStartSeconds` on manual chapter nav, so moving within a chapter
     doesn't move audio at all.

## Fix — three layers shippable today, no native deps

### 1. L0.5 — paragraph-weighted chapter interpolation

Add `ParagraphWeight[]` per chapter to `BookAlignment`:
```ts
interface ParagraphWeight { cfi: string; charCount: number; }
```
Reported by the epub WebView on first load of each chapter (we already have
the DOM). `handoff.ts` consults this list between L0 (proportional) and L1
(anchors): given a paragraph CFI, interpolate `tSec` inside the chapter by
cumulative `charCount`. Given an audio second inside a chapter, find the
paragraph whose cum-char window contains the fractional position.

- No ASR, no network, builds once per chapter on first visit
- ~1 KB per chapter of storage
- When L1 anchors exist for a chapter, they win; weights are a fallback

### 2. Live-follow during immersion

Extend `useImmersionReading` with a second effect driven by `useProgress(500)`:
- Every 500 ms: `audioToReader({chapterIndex, timestampSeconds}, alignment)`
- If the resolved CFI changed and is outside the visible range,
  `webViewRef.current?.scrollToCfi(cfi, { highlight: true })`
- Throttle: compare CFI to last emitted; skip if same (paragraph-granular)

Requires one new EpubWebView method `scrollToCfi(cfi, { highlight })` that
highlights without scrolling if the target is already on screen.

### 3. Consistent resolver at every entry point

- `PlayerScreen` epub banner "Jump there": replace
  `seekTo(percentComplete * duration)` with
  `seekTo(readerToAudio({percentComplete, chapterIndex, …}, alignment).timestampSeconds)`.
- `ReaderScreen.handlePositionChange`: drop the
  `targetSeconds = ch?.audioStartSeconds` override and use
  `target.timestampSeconds` directly — the resolver already does the right
  thing when paragraph weights or L1 anchors are present.

## What we are NOT doing today

- Word-level L2 highlighting — needs ASR tokens + DOM word mapping
- `whisper.rn` install — still queued as Phase 2
- Cloud worker deploy — still queued as Phase 3

The same interfaces are what L1/L2 will fill in; this change makes the handoff
feel right *today* and raises the floor for when the cloud worker does finish
a book's anchors.

## File touch list

- NEW `src/services/sync/paragraphWeights.ts` — pure interpolation helpers + tests
- EDIT `src/types/sync.ts` — add `ParagraphWeight` + `paragraphWeights?:` to `BookAlignment`
- EDIT `src/services/sync/alignmentStore.ts` — `setChapterParagraphWeights`
- EDIT `src/services/sync/handoff.ts` — consult weights between L0 and L1
- EDIT `src/components/reader/EpubWebView.tsx` — add `onParagraphWeights` callback + `scrollToCfi` method + reader-side JS that walks the DOM
- EDIT `src/hooks/useImmersionReading.ts` — add position-tick live-follow
- EDIT `src/screens/reader/ReaderScreen.tsx` — wire weight reporting, drop the chapter-start override
- EDIT `src/screens/player/PlayerScreen.tsx` — route banner "Jump there" through the resolver

## Test plan

**Unit** `paragraphWeights.test.ts`:
- Round-trip: `audioToReader(readerToAudio(p)) ≈ p` within one paragraph
- Given synthetic `[100, 200, 100]` char distribution and 400 s chapter, cum
  fractions land at expected seconds (0, 100, 300)

**Manual**:
- Pair one real m4b + epub with only L0 built (no Whisper)
- Open reader, scroll 40 % into a long chapter, tap Start Audio → audio begins
  near the 40 % mark of that chapter, not the chapter's opening
- While playing, leave reader open → page scrolls paragraph-by-paragraph with
  audio, current paragraph visibly highlighted
- Pause, close player, reopen reader → lands on the paragraph that was
  playing, not the last manually-read one
