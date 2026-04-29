---
phase: "01"
phase_name: "position-sync-fix"
depth: deep
status: issues
files_reviewed: 3
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
generated: 2026-04-29
---

## Summary

The user's reported regression — "exit the reader, come back, doesn't remember where I was" — is plausibly explained by code in scope. Phase 01's central invariant ("a saved CFI must survive the period between bridge-ready and locationsReady→goTo(pendingCfi)") rests entirely on the WebView bridge correctly tagging the initial chapter-0 render as `programmatic:true`. That tag is computed by a 1000 ms wall-clock window in `src/constants/epubBridgeHtml.ts:172` (`prog = (Date.now() - _lastProgrammaticNavMs) < 1000`). On real hardware with a non-trivial EPUB, the time from `loadBook()` (line 84) to the first `locationChanged` event regularly exceeds 1 s — meaning the initial chapter-0 render arrives flagged `programmatic:false`. When it does, `handlePositionChange` in `ReaderView.tsx:405-411` interprets it as a user-driven page-turn, clears `pendingCfi`, and falls through into the persist path — clobbering the saved CFI in AsyncStorage with chapter-0 before the `locationsReady` effect ever has a chance to run `goTo(pendingCfi)`. This is exactly the symptom the user described and matches a regression of the same race the phase was meant to close. A second critical concern: when `pendingCfi` is set, `livePositionRef` is intentionally never updated; if `locationsReady` never fires and the user backs out without paginating, the very first save of a brand-new session writes nothing — fine for that one case, but the same gate combined with the first issue above creates an even larger window where AsyncStorage gets clobbered. Audio save/restore looks coherent: `BookSessionScreen`'s `beforeRemove` writes the audio key synchronously, and `prepareBookForPlayback` reads the same key, so audio failures should be investigated outside this scope. The AssemblyAI word-match removal in `BookSessionScreen` (uncommitted) is unrelated to position persistence and looks safe.

## Critical findings

### CR-01 1000 ms `programmatic` window in bridge is too short — initial render frequently mis-classified as user nav, clobbers saved CFI

`src/components/book/ReaderView.tsx:398-411` together with `src/constants/epubBridgeHtml.ts:84,172`.

The phase's gate logic depends on the bridge's `programmatic` flag accurately distinguishing the initial chapter-0 render from a user page-turn. The bridge computes that flag as:

```js
// epubBridgeHtml.ts:84
loadBook: function(url) {
  _lastProgrammaticNavMs = Date.now();
  ...
}

// epubBridgeHtml.ts:172
var prog = (Date.now() - _lastProgrammaticNavMs) < 1000;
```

On a real device, the time from `loadBook(url)` to the first `_rendition.on('locationChanged')` event for chapter 0 includes XHR fetch of the EPUB into memory, JSZip extraction, OPF/NCX parse, and the initial display() render. For non-trivial EPUBs (>2 MB) on mid-tier hardware this regularly exceeds 1 s. When it does, the very first `POSITION_CHANGE` arrives with `programmatic: false`.

`handlePositionChange` then takes the wrong branch:

```ts
// ReaderView.tsx:405-411
if (pendingCfi) {
  if (programmatic) return;
  // User navigated manually during the pre-restore window. Accept this as
  // the real position and discard the pending restore so locationsReady
  // doesn't snap them back to the old saved CFI.
  setPendingCfi(null);
}
```

`setPendingCfi(null)` runs, the function falls through, `livePositionRef.current` is set to chapter-0, and `onPositionChange` fires the debounced AsyncStorage save with the chapter-0 CFI. By the time `locationsReady` arrives ~3-30 s later, `pendingCfi` is null, so the `useEffect [locationsReady, pendingCfi]` at line 529 does nothing. The user's saved position is gone from both memory and disk.

**Why it matters:** This is the user's reported symptom — "exit and come back, doesn't remember where I left off." It will reproduce reliably on slower devices or larger books and intermittently on faster ones. The forensic report of 2026-04-28 called the exact same race out, the percentComplete-guard was coincidentally protecting against it, and Fix 1 was supposed to close it. Fix 1 closes it only when the bridge correctly tags the initial render as programmatic — which it does not always do.

**Suggested fix:** Don't rely on a wall-clock heuristic to detect the initial render. Either (a) make the bridge tag the very first locationChanged after loadBook as programmatic unconditionally (set a `_pendingInitialRender` boolean cleared on the first event), or (b) lift the gate in `handlePositionChange` so that any `POSITION_CHANGE` while `pendingCfi` is set is treated as suspect and never clears `pendingCfi` — only the `locationsReady` effect (or an explicit user action like `goToChapter` from the drawer) should clear it. Option (b) is the safer, smaller change inside the React side.

---

### CR-02 `useEffect [locationsReady, pendingCfi]` clears `pendingCfi` even if `goTo` fails — restore is unrecoverable for that session

`src/components/book/ReaderView.tsx:529-534`:

```ts
useEffect(() => {
  if (!locationsReady || !pendingCfi) return;
  logger.info('ReaderView: navigating to saved CFI on locationsReady', { cfi: pendingCfi });
  webViewRef.current?.goTo(pendingCfi);
  setPendingCfi(null);
}, [locationsReady, pendingCfi]);
```

`webViewRef.current?.goTo(pendingCfi)` is fire-and-forget — it returns void and the bridge call inside epub.js (`_rendition.display(cfi)` per `epubBridgeHtml.ts:183`) is async and can reject. We then unconditionally `setPendingCfi(null)`. If the goTo fails (malformed CFI from a prior schema, epub.js parser crash, WebView gone), the saved CFI was just dropped from memory. The next `POSITION_CHANGE` (whatever the WebView is currently showing — chapter-0) goes through normally, livePositionRef is updated, and the chapter-0 CFI is persisted on the 2 s debounce, overwriting AsyncStorage.

**Why it matters:** This is a second, independent path to the same user-visible symptom (saved position lost). It currently only fires on bridge failures, but those happen on real hardware (memory pressure, OOM in the WebView).

**Suggested fix:** Move `setPendingCfi(null)` into the success path of `goTo`. Either change `EpubWebViewRef.goTo` to return a `Promise<boolean>` and only clear pendingCfi on resolve, or have the bridge fire a one-shot `RESTORE_COMPLETE` message that clears pendingCfi from the React side. As an immediate mitigation: keep `pendingCfi` set; clear it only when the resulting `POSITION_CHANGE` arrives with a CFI that matches `pendingCfi` (or is at the same chapter index — close enough).

---

## Warnings

### WR-01 `livePositionRef` is null for the entire pre-restore window — `beforeRemove` cannot save during a slow `locations.generate()`

`src/components/book/ReaderView.tsx:413` is inside the post-gate fall-through, so `livePositionRef.current = position` only runs when (a) pendingCfi is null, or (b) the user has manually paginated during the pre-restore window. In a brand-new session for a book that has never been opened (no saved CFI → `pendingCfi` never set, fine, livePositionRef gets set on first programmatic chapter-0 event) this is OK. In a returning session where `locations.generate()` is unusually slow and the user backs out before locationsReady fires, `livePositionRef.current` stays null, `beforeRemove` (`BookSessionScreen.tsx:137`) reads null and writes nothing. The previously-saved CFI in AsyncStorage is therefore preserved — actually the desired outcome — but combined with CR-01 this creates an even longer race window where mid-classified events can clobber storage.

**Suggested fix:** None standalone, but the fix for CR-01 should keep livePositionRef updates gated on `!pendingCfi` so this preservation behavior remains.

### WR-02 `resumeFromAudio` path leaves a 1 s window where chapter-0 can be saved over the audio-derived target

`src/components/book/ReaderView.tsx:340-363`:

```ts
if (resumeFromAudio && audioTimestampForHandoff > 0 && audioChapters.length > 0) {
  setPendingCfi(null);                       // <-- intentionally clears
  const alignment = await getOrBuildLayer0(...);
  ...
  setTimeout(() => {
    if (target.cfi) webViewRef.current?.goTo(target.cfi);
    else webViewRef.current?.goToChapter(target.chapterIndex);
  }, 1000);
}
```

Between bridge-ready and the 1 s setTimeout, `pendingCfi` is null, so the initial chapter-0 `POSITION_CHANGE` (whatever its programmatic flag) goes through the full path: livePositionRef = chapter-0, debounced save scheduled. If the user backs out within ~2 s of opening (before the resume completes), AsyncStorage may have just been overwritten with chapter-0.

**Suggested fix:** Use a separate `pendingResumeCfi` (or set `pendingCfi` to a sentinel like `target.cfi` synchronously, not after `await`) so the same gate protects the resume window. Or guard saves on a `resumePending` ref cleared inside the goTo callback.

### WR-03 `handlePositionChange` is recreated every render and `EpubWebView` re-binds it — possible mid-flight handler swap

The `handlePositionChange` callback at `ReaderView.tsx:398` lists `pendingCfi` (and several other state values) in its useCallback deps, so it gets a new identity each time pendingCfi flips. `EpubWebView` receives it as `onPositionChange` and almost certainly re-binds the message handler each render. There's a non-zero chance a `POSITION_CHANGE` fired by epub.js between the `setPendingCfi(null)` setState and the React commit lands in the *new* closure (where pendingCfi is null) instead of the old one, causing the gate to mis-decide. Worth verifying with logs; today the symptom would be intermittent and look exactly like CR-01.

**Suggested fix:** Stash `pendingCfi` into a ref (already done as `pendingCfiRef`) and read it from the ref inside `handlePositionChange` instead of from the closure. This makes the callback stable across pendingCfi changes and removes the closure-staleness vector.

### WR-04 Initial-load effect re-runs on `resumeFromAudio` change can re-call `loadBookFromUri`

`src/components/book/ReaderView.tsx:251` deps `[ready, user, bookId, resumeFromAudio]`. If a parent re-renders with a different `resumeFromAudio` after the initial mount (unlikely but possible — e.g., navigation params restored from state), the effect runs the entire load sequence again, calling `webViewRef.current?.loadBookFromUri(epubUri)` a second time, restarting `locations.generate()`, and re-triggering the pre-restore window. Not currently observed but a foot-gun.

**Suggested fix:** Either gate the body on a `loadedRef` so it only runs once per (user, bookId), or drop `resumeFromAudio` from deps and read it from a ref.

## Info

### IN-01 `useEpubPosition.onPositionChange` write order: AsyncStorage first, `onPersist` second

`src/hooks/useEpubPosition.ts:23-31`. The local cache is awaited before `onPersist` is called. If AsyncStorage throws (extremely rare), `onPersist` is still called via the `.then` chain — actually wait, no, the throw is caught by the try/catch and the function continues. So Firestore push happens even if local cache failed. That's actually good ordering for "local-first sync" but worth flagging since the comment says "save locally as backup." Functionally fine.

### IN-02 `currentChapterIndex` set inside `handlePositionChange` post-gate but UI may render stale during pre-restore

`ReaderView.tsx:414`. While `pendingCfi` is set and the gate returns early, `currentChapterIndex` is not updated, so the drawer's "current chapter" highlight may show the value from a *previous* book (the state survives across reopens of the same component). Cosmetic. Becomes correct once user paginates or restore completes.

### IN-03 `audioToReader` L0 fallback returns `cfi: ''`, but `syncToAudio` only navigates `chapterIndex > currentChapterIndex` — read→listen→read after backwards audio nav silently no-ops

`ReaderView.tsx:191-198`. The comment explains the rationale for the forward-only guard, and it does prevent reader-pull-back when audio is at 0. But it also means: audio at chapter 2 → user opens reader (currently at chapter 5) → syncToAudio receives chapterIndex=2, cfi=''→ neither branch fires → reader stays at chapter 5, silently misaligned with audio. Probably the intended UX (don't yank reader back) but the comment doesn't say "intentional silent no-op when audio is behind reader" — surface this in the comment so the next reader doesn't think it's a bug.

## Files reviewed

- `/Users/tmulvey/Documents/GitHub/Whisper/src/components/book/ReaderView.tsx`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/hooks/useEpubPosition.ts`
- `/Users/tmulvey/Documents/GitHub/Whisper/src/screens/book/BookSessionScreen.tsx`
