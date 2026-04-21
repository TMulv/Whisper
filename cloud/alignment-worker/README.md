# Alignment worker

Cloud Run service that produces sentence-level anchors for cloud-sourced
audiobooks. One job = one book. Dispatched by a Firebase Function that
watches `/alignmentJobs/{jobId}` in Firestore.

## Pipeline

1. Pull m4b + epub from the user's cloud provider (Dropbox, Drive).
2. Probe chapter boundaries with ffprobe.
3. Tokenize the epub per chapter (ebooklib + BeautifulSoup).
4. For each chapter: slice audio with ffmpeg → Whisper (word timestamps) →
   DTW align → `SentenceAnchor[]` → write to Firestore.
5. Update job + book status as it goes. Re-runs skip chapters that already
   have anchors, so a crash mid-book resumes cleanly.

The DTW cost model is identical to
[`src/services/sync/dtw.ts`](../../src/services/sync/dtw.ts) so on-device
and cloud anchors are fungible.

## Firestore shape

```
alignmentJobs/{jobId}
  { userId, bookId, source, status, startedAt, completedChapters, error? }

users/{userId}/books/{bookId}/alignment/status
  { status: 'processing'|'complete'|'failed', totalChapters, completedChapters }

users/{userId}/books/{bookId}/alignment/{chapterIndex}
  { anchors: SentenceAnchor[], updatedAt }
```

## Running locally

```bash
cd cloud/alignment-worker
pip install -r requirements.txt
# Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a Firebase service
# account JSON with Firestore admin scope.
python main.py
# POST a spec:
curl -X POST http://localhost:8080 -H 'content-type: application/json' -d '{
  "jobId": "test",
  "userId": "u1",
  "bookId": "b1",
  "source": "dropbox",
  "accessToken": "...",
  "audioFileId": "/Apps/Whisper/book.m4b",
  "epubFileId": "/Apps/Whisper/book.epub"
}'
```

## Deploying

```bash
gcloud run deploy alignment-worker \
  --source . \
  --region us-central1 \
  --gpu 1 --gpu-type nvidia-l4 \
  --cpu 4 --memory 16Gi \
  --max-instances 10 \
  --concurrency 1 \
  --timeout 3600
```

T4 is the cost sweet spot but L4 is faster per dollar on Whisper small.
Concurrency=1 because Whisper is GPU-bound per request.

## Cost guardrails

- Per-user monthly cap enforced in the Firebase Function dispatcher — not
  in the worker — so a misbehaving client can't consume quota by
  re-enqueuing.
- Worker soft-fails (writes `status: 'failed'`) if Whisper model load fails;
  the app falls back to the on-device path when the source allows.

## Known gaps (tracked in the plan)

- Pseudo-CFIs. The worker emits `pseudo:chN/sM` as a placeholder — the RN
  reader maps those back to real epub.js CFIs on first ingest, since Python
  epub tooling can't produce CFIs that match the reader's canonical form.
- No iCloud adapter yet. Drive + Dropbox ship first; iCloud needs a
  CloudKit server-to-server token flow, deferred.
- Retry-on-auth-failure is noop today — the worker reports `failed` and the
  app must re-enqueue with fresh credentials.
