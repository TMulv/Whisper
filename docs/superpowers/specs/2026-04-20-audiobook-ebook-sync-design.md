# Audiobook ↔ Ebook Handoff Sync — Design

**Date:** 2026-04-20
**Scope:** Accurate bi-directional position handoff between the EPUB reader and the M4B player. *Not* live word-level immersion highlighting.

## 1. Problem

Switching between the reader and the audio player should resume at the same place in the book. Today it doesn't: handoffs routinely land minutes away from the correct position.

Two root causes:

1. **Naive linear-percent mapping everywhere.** [`prepareBookForPlayback.ts:65`](../../../src/services/audio/prepareBookForPlayback.ts) and [`useImmersionReading.ts:74`](../../../src/hooks/useImmersionReading.ts) both compute audio position as `epubPercent * totalDurationSeconds`. This assumes the narrator speaks at a constant rate and that every page of epub text has the same audio duration. Neither is true. Front matter, TOC, copyright, dedication, and varying narrator pacing across chapters guarantee drift.
2. **The Aeneas runner is broken.** [`scripts/aeneas-runner.sh:71`](../../../scripts/aeneas-runner.sh) writes `"Chapter N: {title}"` as the text to align — so even when the pipeline completes, the stored fragments align only chapter titles, not chapter contents. No usable sentence-level data has ever been produced by this code path.

## 2. Goals

- Reader → Audio and Audio → Reader handoff lands within a few seconds of the correct position.
- User can start using a newly imported book immediately — no blocking wait on alignment.
- For cloud-sourced books, full alignment completes with the app closed.
- For local-only books, alignment completes opportunistically without requiring the user to "keep their screen on."
- A book is never worse than it is today: handoff must always work, even before fine-grained alignment exists.

## 3. Non-goals

- Live word-level highlighting during immersion reading. Kept as a possible future use of the sentence-level data we'll produce, but not part of this spec.
- Reducing import latency below "chapter-level alignment ready in seconds." Fine alignment is allowed to take minutes or hours.
- Desktop companion app.
- In-app uploader for local books that users want processed in the cloud. (Workaround: move the book to Dropbox/Drive first.)

## 4. Architecture

### 4.1 Layers of alignment

The system supports three layers of handoff precision. Every book is always at *at least* Layer 0 from seconds after import. Layers 1 and 2 fill in progressively.

| Layer | Granularity | Source | Available when |
|-------|-------------|--------|----------------|
| **L0** — Chapter | Chapter boundary + proportional within chapter | M4B chapter timestamps (ffprobe) + EPUB spine | Immediately at import |
| **L1** — Sentence | Per-sentence `{audioSeconds, epubCfi}` anchors | Whisper transcription + DTW against epub text | After background processing completes, chapter-by-chapter |
| **L2** — Word | Per-word alignment | Out of scope for this spec | — |

Handoff always picks the most precise layer available for the target position. An L1 anchor near the target wins; otherwise fall back to L0.

### 4.2 Data model

New Firestore collection per user, keyed by book:

```
/users/{userId}/books/{bookId}/alignment/
  status          → 'pending' | 'processing' | 'partial' | 'complete' | 'failed'
  layer0          → { chapters: ChapterAlignment[] }      // always present after import
  layer1Progress  → { processedChapters: number, totalChapters: number, updatedAt }
  layer1Chapters/{chapterIndex}  → { anchors: SentenceAnchor[] }
```

Types:

```ts
interface ChapterAlignment {
  chapterIndex: number;
  audioStartSeconds: number;
  audioEndSeconds: number;
  epubSpineIndex: number;
  epubCfiBase: string;    // base CFI for this spine item
  chapterChars: number;   // total char count in the epub chapter, for L0 proportional fallback
  percentStart: number;   // of book
  percentEnd: number;
}

interface SentenceAnchor {
  audioSeconds: number;   // absolute, from start of m4b
  epubCfi: string;        // full CFI locating the sentence
  charOffset: number;     // char offset within CFI's text node
  confidence: number;     // 0..1 from DTW alignment score
}
```

Mirror to device SQLite for offline lookup. Firestore is the source of truth; the device cache is write-through for L0 (produced on-device) and read-through for L1 (produced by the worker or on-device background task).

### 4.3 Source-aware routing

At import time, the app determines the book's source and chooses a processing path:

| Source | Path | Responsible for producing L1 |
|--------|------|------------------------------|
| Google Drive, Dropbox, iCloud, any cloud-backed URI | **Cloud Worker** | Firebase Cloud Run worker pulls from user's source |
| Local filesystem only | **On-Device Whisper** | `whisper.rn` running on the phone |

The routing decision is persisted with the book — it does not change over its lifetime. This is the only user-visible behavioral split, and it maps to a one-sentence explanation: *"Where your book lives decides how it syncs."*

### 4.4 Components

```
┌─────────────────────────────────────────────────────────────┐
│  Import flow                                                │
│                                                             │
│  user picks book ──→ extract L0 (ffprobe + spine) ──→ save │
│                              │                              │
│                              ├─ cloud source? ──→ enqueue worker job
│                              └─ local source? ──→ schedule on-device
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐   ┌─────────────────────────────┐
│  Cloud worker (GCP Cloud Run)│   │  On-device aligner           │
│                              │   │                              │
│  1. Pull m4b + epub          │   │  whisper.rn (tiny.en)        │
│     from user's source       │   │                              │
│  2. ffmpeg split by chapter  │   │  Runs only while:            │
│  3. Whisper transcribe       │   │   • app foreground, OR       │
│  4. DTW against epub text    │   │   • audio actively playing   │
│  5. Write chapter alignment  │   │      (bg-audio keeps alive)  │
│     to Firestore as each     │   │   • Android: WorkManager     │
│     chapter finishes         │   │     while charging + on WiFi │
│  6. Push notification on     │   │                              │
│     complete                 │   │  Persists chunk cursor so it │
│                              │   │  resumes between sessions    │
└─────────────────────────────┘   └─────────────────────────────┘
                │                                │
                └──────────┬─────────────────────┘
                           ▼
              Firestore alignment docs
                           │
                           ▼
             ┌─────────────────────────┐
             │  Handoff resolver        │
             │                          │
             │  reader → audio:         │
             │    find nearest L1       │
             │    anchor by CFI,        │
             │    interpolate; else L0  │
             │                          │
             │  audio → reader:         │
             │    find nearest L1       │
             │    anchor by seconds,    │
             │    return CFI; else L0   │
             └─────────────────────────┘
```

### 4.5 Handoff resolver

One module, replaces the scattered percent-of-book math today. Lives at `src/services/sync/handoff.ts`.

```ts
function readerToAudio(epubPosition, alignment): AudioPosition {
  // 1. Look up the chapter alignment for this CFI's spine index (L0).
  // 2. If L1 anchors exist for this chapter:
  //       binary-search the anchors for the one nearest this CFI,
  //       linearly interpolate audioSeconds between that anchor and
  //       its neighbor.
  //    Else:
  //       proportional within chapter using (charOffset / chapterChars).
  // 3. Return AudioPosition.
}

function audioToReader(audioPosition, alignment): EpubPosition {
  // Symmetric to above, keyed on audioSeconds.
}
```

This resolver is the *only* place sync math lives. `prepareBookForPlayback` and `useImmersionReading` become thin callers.

## 5. Flows

### 5.1 Import (cloud-sourced book)

1. User picks book from Drive/Dropbox.
2. App fetches just the m4b chapter metadata via ffprobe (small range request when possible) and the epub container.
3. App computes L0 alignment locally — *seconds* of work, not minutes.
4. App writes L0 to Firestore and local cache. Status: `partial`.
5. App enqueues a Cloud Run job with pointers to the user's source files and OAuth credentials for the backing provider.
6. Book appears in library, marked "Ready to read — refining sync in the background." Close the app; done.
7. Worker pulls files, aligns chapter-by-chapter, writes each chapter's anchors to Firestore. Device picks them up via Firestore listener if app is foreground, or on next open.
8. On worker completion, send push notification: "Sync finished for *{title}*."

### 5.2 Import (local-only book)

1. User picks book from file picker.
2. Same L0 extraction as above. Status: `partial`. Book ready to use.
3. Alignment task registered in a persistent on-device queue.
4. Whenever the app is foregrounded, or track-player starts playback (keeping the process alive via background-audio), the aligner processes the next chapter chunk.
5. On Android, additionally schedule a WorkManager periodic task that fires while the device is charging and on WiFi — this lets a local Android book finish alignment overnight without the app being in use.
6. On iOS, alignment only advances while the user is actively using the app or listening. If a user never opens or plays the book again after import, alignment stays where it is. This is acceptable — an unused book doesn't need alignment.

### 5.3 Handoff at runtime

- Reader → Audio: `prepareBookForPlayback` calls `handoff.readerToAudio(currentEpubPosition, alignment)` and seeks track-player to the returned `audioSeconds`.
- Audio → Reader: `ReaderScreen` mount calls `handoff.audioToReader(currentAudioPosition, alignment)` and navigates the webview to the returned CFI.
- In both cases the resolver uses whatever layer is available: L1 if the current chapter has anchors, L0 otherwise.

## 6. Import UX ("fun animations while it loads")

Immediate (within 2–5 seconds of starting import):
- Progress to "Ready to read" — L0 is done, the book is usable.
- Tagline copy in the library card: *"Refining sync — 3 of 18 chapters"* (cloud) or *"Syncing as you listen"* (local).

During background refinement:
- Small badge on the book cover — subtle pulsing halo or a progress ring around the cover art while alignment is incomplete.
- Tapping the badge opens a sync-status sheet explaining what's happening in plain language and showing per-chapter progress.

On completion:
- Badge fades out.
- Push notification if app is backgrounded.

This is where the "fun animations" live. None of them block the user from opening the book.

## 7. Error handling & fallback

| Failure | Behavior |
|---------|----------|
| L0 extraction fails (corrupt m4b, missing chapters) | Fall back to single-chapter book covering full duration. Warn user; offer to retry. |
| Cloud worker fails mid-book | Already-written chapters are kept. Remaining chapters retry automatically; after 3 failures, marked `failed` with a "try again" button. |
| Cloud worker can't access user's source (auth expired) | Status → `auth-required`, prompt user to reconnect the provider. |
| On-device Whisper fails on a chunk | Skip and continue. That chapter stays L0 until next retry. |
| Alignment confidence below threshold (e.g., narrator deviates from text — abridgment, dramatization) | Mark chapter L0-only, don't store low-confidence anchors. User sees the same accuracy as today in that chapter; better elsewhere. |
| Device offline when worker finishes | Firestore offline persistence handles catch-up on next connection. |

Critical property: **at no point is handoff worse than L0.** If anything goes wrong, we're still no worse than chapter + proportional — which is itself better than today's whole-book-percent math.

## 8. Migration

- Ship the handoff resolver first, wired to produce L0 from existing m4b chapter data and epub spine. Every existing book immediately gets L0 handoff on first open. No user-visible migration UI.
- Remove the percent-of-book math in `prepareBookForPlayback.ts:65` and `useImmersionReading.ts:74` — replace with resolver calls.
- Delete or rewrite the broken `scripts/aeneas-runner.sh`. Keep the `AeneasSyncMap` *type* only if we're ingesting existing pre-computed data; otherwise remove to avoid confusion with the new anchor model.

## 9. Testing

- Unit: resolver correctness across L0-only, L1-only, mixed (L1 available for some chapters), and edge positions (book start, book end, chapter boundary, gap between anchors).
- Fixture book with known narrator/text for integration tests — 1 small public-domain m4b + epub, with a hand-verified anchor set, included in the repo.
- Cloud worker: integration tests against a fixture book, plus a golden-alignment comparison.
- On-device aligner: unit tests for chunk cursor persistence, resume-after-kill, and background/foreground transitions.
- End-to-end: import → L0 ready → listen 10 minutes → kill app → reopen reader → handoff lands within 5 seconds of where audio stopped.

## 10. Open questions for implementation plan

- Exact Cloud Run configuration (CPU vs GPU, memory, concurrency limits, cost target).
- Whisper model choice on device (`tiny.en` vs `base.en`) and storage strategy (bundled vs downloaded on first use).
- Anchor density: one per sentence, or one per ~5 sentences? Tighter = more storage, negligible runtime difference.
- DTW implementation: write locally, or use an off-the-shelf Python library in the worker / JS library on device.

These are implementation-plan concerns, not design-level.
