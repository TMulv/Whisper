# Audiobook ↔ Ebook Handoff Sync — Implementation Plan

Companion to [2026-04-20-audiobook-ebook-sync-design.md](./2026-04-20-audiobook-ebook-sync-design.md).

Phased so each phase ships independently and leaves the app better than it found it. Phase 1 alone delivers the handoff accuracy win for every existing book.

---

## Phase 1 — Handoff resolver + L0 (ship first; user-visible improvement)

**Goal:** Replace every percent-of-book calculation with a single resolver that uses chapter-bounded proportional math. Every book in the library immediately gets better handoff, zero new infrastructure.

### 1.1 Types
- **Edit** [`src/types/sync.ts`](../../../src/types/sync.ts)
  - Add `ChapterAlignment`, `SentenceAnchor`, `BookAlignment` per spec §4.2.
  - Deprecate `AeneasSyncMap` and `AeneasFragment` — mark with a `@deprecated` JSDoc, don't remove yet (breaks imports).
- **Edit** [`src/types/firebase.ts`](../../../src/types/firebase.ts)
  - Add Firestore shapes for `BookAlignment` and per-chapter anchor docs.

### 1.2 Resolver module
- **Create** `src/services/sync/handoff.ts`:
  - `readerToAudio(epubPos, alignment): AudioPosition`
  - `audioToReader(audioPos, alignment): EpubPosition`
  - Both use L1 anchors when available, L0 proportional otherwise. Binary-search by CFI order (epub side) or by `audioSeconds` (audio side).
- **Create** `src/services/sync/alignmentBuilder.ts`:
  - `buildLayer0(m4bChapters, epubSpine): ChapterAlignment[]` — runs at import. Uses existing `parseChaptersJson` output and epub spine metadata from epub.js (exposed via the WebView bridge).

### 1.3 Wire resolver into call sites
- **Edit** [`src/services/audio/prepareBookForPlayback.ts`](../../../src/services/audio/prepareBookForPlayback.ts)
  - Replace `line 65`'s `epubPos.percentComplete * book.totalDurationSeconds` with `handoff.readerToAudio(epubPos, alignment).timestampSeconds`.
  - Load alignment from local cache (falls back to L0 if absent).
- **Edit** [`src/hooks/useImmersionReading.ts`](../../../src/hooks/useImmersionReading.ts)
  - Remove the `seekToPercent(position/duration)` call (lines ~67–76). The hook is for *live* sync, which is out of scope here — collapse it to chapter-change navigation only.
- **Edit** reader screen entry points
  - On reader mount after audio playback, call `handoff.audioToReader` and navigate to the returned CFI.

### 1.4 Alignment store
- **Create** `src/services/sync/alignmentStore.ts`:
  - `getAlignment(bookId): BookAlignment | null` — local cache read-through, falls back to Firestore.
  - `saveLayer0(bookId, chapters)` — writes local + Firestore.
  - Uses AsyncStorage for now (single-book reads fit). SQLite is an upgrade path once L1 chapter docs grow large.

### 1.5 Import wiring
- **Edit** the book import flow (where new books land — inspect [`src/screens/library`](../../../src/screens/library/) and [`src/screens/files`](../../../src/screens/files/) to locate the exact entry).
  - After m4b chapter parse + epub spine parse succeed, call `buildLayer0` and `saveLayer0`.
  - Mark `alignment.status = 'partial'` so Phase 2/3 can detect "needs L1."

### 1.6 Tests
- **Create** `src/services/sync/__tests__/handoff.test.ts`
  - L0-only book: reader at 40% into chapter 3 → audio at `chapter3Start + 0.4 * chapter3Duration`.
  - L1-only region: nearest-anchor interpolation.
  - Mixed: some chapters have L1, some don't — correctly picks per chapter.
  - Edges: book start, book end, chapter boundary (inclusive vs exclusive), single-chapter book.
- Delete tests that assert the old percent-of-book behavior.

### 1.7 Cleanup in this phase
- **Delete** [`scripts/aeneas-runner.sh`](../../../scripts/aeneas-runner.sh) — produces garbage, nothing depends on it.
- **Edit** [`src/services/sync/aeneasMapper.ts`](../../../src/services/sync/aeneasMapper.ts) — leave in place if used elsewhere, mark deprecated; delete if no callers remain.
- **Edit** [`src/services/sync/chapterMapper.ts`](../../../src/services/sync/chapterMapper.ts) — fold its logic into the new resolver, delete the file.

### 1.8 Verification
- Pick a test book where Chapter 1 starts 8 minutes into the m4b (front matter). Today: reader at start of Chapter 1 → audio at 0s (wrong). After Phase 1: audio at ~8 min (right).
- Manual spot-check: audio → reader handoff mid-chapter should land on the right chapter, within ~1–3 min drift within.

**Exit criteria:** All existing books get chapter-accurate handoff. No UI changes yet. No new dependencies.

---

## Phase 2 — On-device L1 for local books

**Goal:** Whisper transcription + DTW for books that live only on device. Runs opportunistically while the app is foreground or audio is playing.

### 2.1 Dependencies
- Add `whisper.rn` to `package.json`. Bundle `tiny.en` model (~75 MB) as an expo-asset, or download on first use (preferred to keep app binary small).
- Add `ffmpeg-kit-react-native` for on-device audio chunking per chapter (or use whisper.rn's built-in chunking if sufficient).
- Expo dev-client rebuild required — this is a config-plugin prebuild phase change.

### 2.2 Aligner service
- **Create** `src/services/sync/onDeviceAligner.ts`:
  - `AlignerQueue` — persistent queue of pending (bookId, chapterIndex) chunks. Persisted to AsyncStorage.
  - `processNext(): Promise<void>` — pops one chunk, transcribes, DTW-aligns, writes anchors, advances cursor.
  - Idempotent and resumable: if killed mid-chunk, next call restarts that chunk cleanly.
- **Create** `src/services/sync/dtw.ts`:
  - DTW algorithm matching whisper transcript tokens against chapter epub text tokens. Output: `SentenceAnchor[]` for the chapter.
  - Confidence score per anchor; drop anchors below threshold.

### 2.3 Lifecycle wiring
- **Create** `src/hooks/useOpportunisticAlignment.ts`:
  - Subscribes to app state + track-player state.
  - Drives `AlignerQueue.processNext` while (foreground || playing).
  - Yields between chunks to keep UI responsive.
- **Edit** `App.tsx` — mount the hook at root for any book where alignment is incomplete and source is local.

### 2.4 Android WorkManager
- **Create** `android/app/src/main/java/com/whisper/AlignmentWorker.kt` (or equivalent in the expo config plugin).
  - Schedules a periodic task to run aligner while charging + on WiFi.
  - Calls into a JS bridge that invokes `AlignerQueue.processNext` repeatedly until batteryLow or N chunks done.
- iOS does not get this. Document in spec §5.2 (already noted).

### 2.5 Tests
- **Create** `src/services/sync/__tests__/dtw.test.ts`
  - Fixture: short audio chunk + known transcript + known epub paragraph → expected anchor CFIs.
- **Create** `src/services/sync/__tests__/onDeviceAligner.test.ts`
  - Resume-after-kill: process a chunk partially (stub whisper), force exit, restart, verify we redo the chunk not the whole chapter.
  - Idempotency: process same chunk twice → identical anchors, no duplicates.

### 2.6 Verification
- Import a small local book (~30 min m4b). Let the app run in foreground. Expect L1 for chapter 1 in ~3 min, chapter 2 in ~6, etc.
- Kill app mid-chapter, reopen, verify cursor resumes correctly.
- Android: charge device overnight, verify WorkManager finishes the book.

**Exit criteria:** Local-only books reach L1 for every chapter the user engages with. Handoff drift within aligned chapters drops to ~5–10 seconds.

---

## Phase 3 — Cloud worker L1 for cloud books

**Goal:** Firebase Cloud Run worker handles cloud-sourced books completely unattended.

### 3.1 Worker service
- **Create** `cloud/alignment-worker/` (new top-level dir):
  - `Dockerfile` with Python 3.11, ffmpeg, whisper, scipy.
  - `main.py` — pulls m4b + epub from user's source (Drive/Dropbox/iCloud API), chunks by chapter, transcribes, DTW-aligns, writes to Firestore.
  - `README.md` — deployment instructions.
- Deploy via `gcloud run deploy` with GPU allocation (T4 is the cost sweet spot).

### 3.2 Source adapters
- **Create** `cloud/alignment-worker/sources/`:
  - `drive.py`, `dropbox.py`, `icloud.py` — each takes user credentials + file ID, returns a byte-stream.
- User credentials are already held by the app for each provider; pass via short-lived tokens to the worker.

### 3.3 Firestore triggers & status
- **Edit** `src/services/firebase/firestoreService.ts`:
  - Add functions to enqueue an alignment job: writes to `/alignmentJobs/{jobId}` with book pointers. Cloud Function listens and invokes Cloud Run.
  - Subscribe to `/users/{userId}/books/{bookId}/alignment` for progress updates.
- **Create** `functions/` Firebase Functions handler that dispatches to Cloud Run.

### 3.4 Push notifications
- Hook into existing notification setup (if any; confirm by checking `package.json` for `expo-notifications`). Worker writes `alignmentComplete: true` on the book doc → device receives Firestore update → local notification.

### 3.5 Tests
- Integration test harness: small fixture book uploaded to a test Drive account, run worker locally in Docker, verify output anchors against golden file.
- Retry/failure: simulate auth failure mid-book, verify status goes to `auth-required` and already-written chapters persist.

### 3.6 Verification
- Import a Dropbox-backed book. Close app immediately. Wait ~10 min. Reopen app — expect full L1 on all chapters.
- Reader handoff mid-book should land within seconds of the correct position.

**Exit criteria:** Cloud-sourced books go from import → full L1 with the app closed the whole time.

---

## Phase 4 — Import UX polish

**Goal:** The "fun animations while it loads" deliverable.

### 4.1 Cover badge
- **Create** `src/components/library/SyncBadge.tsx`:
  - Pulsing halo around cover while `alignment.status === 'partial' | 'processing'`.
  - Progress ring segment filled per completed chapter.
  - Taps open the status sheet.

### 4.2 Status sheet
- **Create** `src/components/library/SyncStatusSheet.tsx`:
  - Plain-language explanation ("Syncing as you listen" vs "Refining sync in the background").
  - Per-chapter checklist with progress.
  - Retry button for failed chapters.

### 4.3 Library card copy
- **Edit** [`src/screens/library/LibraryScreen.tsx`](../../../src/screens/library/LibraryScreen.tsx):
  - Replace tagline with dynamic sync status string when alignment is incomplete.

### 4.4 Verification
- Import both a cloud and a local book. Eye-test that animations read as intentional and subtle, not blocking. Accessibility: reduce-motion respects system setting.

**Exit criteria:** The import experience tells a clear, calm story. Nothing blocks the user.

---

## Phase 5 — Cleanup & long-tail

### 5.1 Remove deprecated types
- Delete `AeneasSyncMap`, `AeneasFragment`, `aeneasMapper.ts` if no callers remain after Phase 1 settled.
- Remove `SyncMode = 'aeneas'` from `book.ts` — migrate any existing `BookMetadata.syncMode === 'aeneas'` rows to `'chapter'` at app startup (one-shot migration).

### 5.2 Telemetry
- Log anchor confidence distributions to Firestore analytics. Feeds future tuning.

### 5.3 Future work (not in this project)
- Layer 2 (word-level) — reuses the same Whisper pipeline with word timestamps enabled.
- Live immersion highlighting — consumes L1/L2 anchors, out of scope per spec §3.

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `whisper.rn` binary size inflation | Download model on first use instead of bundling; gate aligner behind the model being present. |
| DTW false alignments on abridged audiobooks | Confidence threshold per anchor; low-confidence chapters stay L0-only. |
| Cloud Run cost overrun | Per-user monthly quota; soft-fail to on-device path if exceeded. |
| iOS App Store review flags bg-audio abuse | Aligner only runs during genuine playback, not with silent audio. Document the legitimate use in review notes. |
| Firestore write volume from per-chapter anchors | Batch writes; one doc per chapter (not per anchor). Anchor lists average ~50–150 entries per chapter. |

---

## Order of operations & what to build next

**Start with Phase 1.** It's self-contained, ships a real user-visible win for every existing book, introduces zero new dependencies, and lays the resolver foundation both other phases plug into. Roughly 1–2 days of work.

Phase 2 and Phase 3 can then proceed in parallel if you want — they're independent. Phase 2 is more complex (native integration) but Phase 3 has more moving pieces (cloud infra). Phase 4 lands on top of whichever finishes first. Phase 5 is cleanup, pure refactor.
