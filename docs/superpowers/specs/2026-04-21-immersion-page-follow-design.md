# Immersion Mode: Page-Follow (Reader Turns Pages as Audio Plays)

## Problem

In immersion mode, the reader advances its chapter when the audio chapter
index flips ([useImmersionReading.ts:80-111](../../../src/hooks/useImmersionReading.ts)),
but between chapter flips it does not turn pages. The live-follow loop calls
`highlightProgress(fraction)` which queries the epub.js iframe's DOM for
`p/h1/h2/.../li/blockquote` elements — in `flow: 'paginated'` mode that's
only the paragraphs of the **currently visible spread**. So as audio plays
through chapter 3, the `.whisper-immersion-active` class just moves between
the 4-5 paragraphs on page 1; the reader never turns to page 2.

## Fix (scoped — one change)

Add book-wide percent navigation and drive it from the immersion live-follow
loop. epub.js already emits `_book.locations` (generated at
[epubBridgeHtml.ts:141](../../../src/constants/epubBridgeHtml.ts) after the
initial render), so we can map a book-wide percent → CFI →
`rendition.display` with no new infrastructure.

### Change 1 — `src/constants/epubBridgeHtml.ts`

New bridge method alongside `seekToPercent`:

```js
scrollToBookPercent: function(p) {
  if (!_rendition || !_book || !_locationsReady) return;
  _lastProgrammaticNavMs = Date.now();
  try {
    var cfi = _book.locations.cfiFromPercentage(Math.max(0, Math.min(1, p)));
    if (!cfi) return;
    _rendition.display(cfi).catch(function(e) {
      postToRN({type:'ERROR', message:'scrollToBookPercent rejected: '+(e&&e.message||e)+' p='+p});
    });
  } catch(e) {
    postToRN({type:'ERROR', message:'scrollToBookPercent threw: '+(e&&e.message||e)+' p='+p});
  }
},
```

Setting `_lastProgrammaticNavMs` ensures the resulting `POSITION_CHANGE`
message is marked `programmatic: true`, which keeps the reader→audio seek
loop in `ReaderScreen.handlePositionChange` from fighting with immersion.

### Change 2 — `src/constants/epubInjection.ts`

```ts
export const JS_SCROLL_TO_BOOK_PERCENT = (percent: number) =>
  `window.whisper.scrollToBookPercent(${percent}); true;`;
```

### Change 3 — `src/components/reader/EpubWebView.tsx`

Add to `EpubWebViewRef` interface and `useImperativeHandle`:

```ts
scrollToBookPercent: (percent: number) => void;
// ...
scrollToBookPercent: (percent: number) => inject(JS_SCROLL_TO_BOOK_PERCENT(percent)),
```

### Change 4 — `src/hooks/useImmersionReading.ts`

In the live-follow effect, compute the book-wide percent from the resolver's
output, bucket it into ~500 discrete steps (one bucket ≈ 0.2% of the book,
roughly one page of reading pace for a typical audiobook), and call
`scrollToBookPercent` when the bucket changes:

```ts
const lastPageBucketRef = useRef<number>(-1);
// ...inside the live-follow effect:
let bookPercent: number | null = null;
if (alignment) {
  const resolved = audioToReader(
    { chapterIndex: currentAudioChapter.index, timestampSeconds: position, percentComplete: 0 },
    alignment,
  );
  bookPercent = resolved.percentComplete;
  // ...existing chapter-span / fraction math...
}
// Book-wide page navigation — turns pages as audio advances within a chapter.
if (bookPercent !== null && Number.isFinite(bookPercent)) {
  const pageBucket = Math.round(bookPercent * 500);
  if (pageBucket !== lastPageBucketRef.current) {
    lastPageBucketRef.current = pageBucket;
    webViewRef.current?.scrollToBookPercent(bookPercent);
  }
}
// Existing highlightProgress call stays — now it lands on a paragraph on the
// correct page because we just navigated there.
```

Also reset `lastPageBucketRef.current = -1` in the existing
"clear when immersion isn't active" effect at
[useImmersionReading.ts:177-182](../../../src/hooks/useImmersionReading.ts).

## Why this works

- `_book.locations` is epub.js' book-wide percent↔CFI index, already
  generated after first render (`locations.generate(1000)`).
- `cfiFromPercentage(p)` returns a real CFI that `rendition.display`
  parses cleanly (unlike synthetic chapter-base CFIs — see the prior
  [audio-to-reader handoff fix](./2026-04-21-audio-to-reader-handoff-fix-design.md)).
- The resolver's L0 `percentComplete` is already chapter-proportional
  within its chapter span, so as audio time advances through the chapter
  the book-percent advances smoothly through that chapter's percent band.
- Bucketing at 500 steps means ~72 seconds of audio per scroll call on a
  10-hour book at 1×, which is about a page of reading pace — no scroll
  storms.

## Non-goals

- Paragraph weights (`setChapterParagraphWeights`) still not populated —
  deferred to a follow-up. Once populated, `audioToReader` will return
  real CFIs in the L0.5 branch, and we can switch live-follow to
  `scrollToCfi(cfi)` for sentence-accuracy. This spec keeps us chapter-
  and page-accurate without that work.
- Whisper.rn linkage not addressed here — environmental, needs a dev
  build. L1 anchors continue to improve accuracy once they exist.
- Char-weighted L0 distribution (`epubPercentStart/End` per actual
  chapter length) not changed. Uniform chapter distribution is imperfect
  but "right page within chapter" is already a big jump.

## Verification

1. In immersion mode: start audio on a book with known long chapters.
   The reader should turn pages as audio progresses, not stay frozen on
   page 1.
2. Manual navigation (tap a chapter in the drawer) still works — the
   chapter-switch effect fires before the page-follow effect settles.
3. Reader→audio (flip a page when immersion is off) unchanged:
   `handlePositionChange` still runs the seek.
4. `handoff.test.ts` continues to pass — this change doesn't touch the
   resolver.
5. Sanity: `adb logcat | grep scrollToBookPercent` shows no `rejected`
   or `threw` error entries during a normal immersion session.
