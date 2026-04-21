# Audio → Reader Handoff Crash Fix

## Problem

On Android, opening the reader from the player (Player → "Open Reader") crashes the EPUB WebView with:

```
EpubWebView bridge error: JS: Uncaught TypeError:
  Cannot read properties of undefined (reading 'split') (line 41)
```

Line 41 of `epubBridgeHtml.ts` is the minified ePub.js bundle. The error is ePub.js' CFI parser calling `.split()` on a substring that doesn't exist in the CFI we passed in.

## Root cause

When the user opens the reader from the player, `PlayerScreen.handleOpenReader`
navigates with `resumeFromAudio: true`. `ReaderScreen`'s post-bridge-ready
effect then runs the audio handoff branch:

1. Calls `getOrBuildLayer0(...)` with `audioChapters.length` as the epub
   chapter count (the reader hasn't rendered yet, so the `chapters` state is
   still `[]`).
2. Calls `audioToReader(...)`. With no L1 anchors and no L0.5 paragraph
   weights yet (cold handoff), this lands in the L0 fallback:

   ```ts
   return {
     chapterIndex: ch.epubChapterIndex,
     cfi: ch.epubCfiBase || buildChapterBaseCfi(ch.epubChapterIndex),
     // ...
   };
   ```

   `buildChapterBaseCfi(i)` returns a synthetic chapter base like
   `epubcfi(/6/4)` — no `!` separator, no inner path.

3. After a 1000 ms timer, `ReaderScreen` calls `webViewRef.goTo(target.cfi)`,
   which runs `_rendition.display("epubcfi(/6/4)")` in the WebView.

ePub.js' CFI parser expects the `!` base/path separator and tries to `.split('!')`
a sub-expression that is undefined in a chapter-base-only CFI. It throws; the
error bubbles to `window.onerror` and is posted to RN as a bridge error.

The saved-position path works because `loadLocalPosition()` returns a full CFI
previously emitted by ePub.js itself (e.g. `epubcfi(/6/4!/4/2/1:42)`), which
parses cleanly.

The immersion loop is unaffected: it only reads `percentComplete` from
`audioToReader`, never `cfi`.

## Fix

Stop handing ePub.js synthetic partial CFIs. The L0 fallback is a chapter-grain
answer — navigate the reader by chapter (the ePub.js spine-href path) instead
of by CFI.

### Change 1 — `src/services/sync/handoff.ts`

In `audioToReader`'s L0 fallback (the branch with no anchors and no weights),
return `cfi: ''` instead of a synthetic chapter-base CFI. The `chapterIndex`
and `percentComplete` the caller needs are still correct.

```ts
// L0: proportional within chapter. No anchors and no weights means we only
// know the chapter; the CFI we'd synthesize here is not a real epub.js CFI
// and crashes rendition.display on Android. Callers use chapterIndex in that
// case.
return {
  chapterIndex: ch.epubChapterIndex,
  cfi: '',
  charOffset: 0,
  percentComplete,
};
```

The `BookAlignment.ChapterAlignment.epubCfiBase` field and
`buildChapterBaseCfi` stay as-is — they're still used by other consumers
(e.g. `alignmentBuilder`) and may later carry precise CFIs from the epub
navigation document. This change is localized to `audioToReader`'s return
value.

### Change 2 — `src/screens/reader/ReaderScreen.tsx`

In the `resumeFromAudio` branch (the `setTimeout` at the end of the bridge-
ready effect), when `target.cfi` is empty, navigate by chapter instead of by
percent:

```ts
setTimeout(() => {
  if (target.cfi) {
    webViewRef.current?.goTo(target.cfi);
  } else {
    webViewRef.current?.goToChapter(target.chapterIndex);
  }
}, 1000);
```

Rationale for `goToChapter` over `seekToPercent`:

- `goToChapter` uses the spine-href path inside the bridge, which ePub.js
  handles reliably without needing `_locationsReady`.
- `seekToPercent` requires `_book.locations` to have been generated first;
  on a cold load it silently no-ops.
- The resolver's L0 answer is already chapter-grain, so chapter navigation
  matches the intent.

### Change 3 — `src/constants/epubBridgeHtml.ts`

Harden `whisper.goTo` so a future bad CFI surfaces with context instead of
bubbling to the generic `window.onerror` handler:

```js
goTo: function(cfi) {
  if (!_rendition) return;
  showLoading(true);
  try {
    _rendition.display(cfi)
      .then(function(){ showLoading(false); })
      .catch(function(e){
        showLoading(false);
        postToRN({type:'ERROR', message:'goTo rejected: '+(e.message||e)+' cfi='+cfi});
      });
  } catch(e) {
    showLoading(false);
    postToRN({type:'ERROR', message:'goTo threw: '+(e.message||e)+' cfi='+cfi});
  }
},
```

This turns "line 41 .split undefined" into something like
`goTo threw: Cannot read properties of undefined (reading 'split') cfi=epubcfi(/6/4)`
— the cfi string in the error message makes the next bug of this shape
obvious at a glance.

## Tests

### Update `src/services/sync/__tests__/handoff.test.ts`

The existing L0 test cases currently assert `r.cfi === 'epubcfi(/6/…)'` via
`buildChapterBaseCfi`. Update them to assert `r.cfi === ''`. The
`chapterIndex` and `percentComplete` assertions stand.

### Add a regression test

In the same file, add a test documenting the invariant:

```ts
it('L0 fallback returns empty cfi so callers use chapterIndex', () => {
  const r = audioToReader(
    { chapterIndex: 0, timestampSeconds: 0, percentComplete: 0 },
    baseAlignment, // no anchors, no weights
  );
  expect(r.cfi).toBe('');
  expect(r.chapterIndex).toBe(0);
});
```

## Non-goals

- No change to `readerToAudio` (only `audioToReader` returns the synthetic
  CFI; `readerToAudio` consumes CFIs).
- No change to the 1000 ms post-bridge-ready timer in `ReaderScreen`. The
  bug is bad input, not a timing race.
- No change to the immersion live-follow loop. It reads `percentComplete`,
  not `cfi`.
- `buildChapterBaseCfi` is not removed. `alignmentBuilder` still writes
  it into `ChapterAlignment.epubCfiBase` and future code may populate
  precise CFIs from the epub nav doc.

## Verification

1. On Android: Player → "Open Reader" → reader should open on the current
   audio chapter with no bridge error.
2. The immersion flow (audio playing, reader following) still behaves as
   today — this fix does not touch the paragraph-highlight path.
3. The saved-position path (open reader without audio loaded) is unaffected.
4. `handoff.test.ts` passes.
