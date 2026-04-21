# Deploying the cloud alignment worker

End-to-end walkthrough for standing up the cloud alignment path — the
pipeline that produces sentence-level anchors for cloud-sourced audiobooks
(Dropbox / Drive). The client-side and on-device Whisper paths work
without any of this; deploy when you want server-side alignment to offload
work from the phone or to support books that live only in the cloud.

Two components to deploy:

1. **Cloud Run worker** (Python / GPU) — does the actual Whisper + DTW work.
2. **Firebase Function** — listens for `alignmentJobs` writes and POSTs the
   worker with an authenticated identity token.

See [`cloud/alignment-worker/README.md`](../../../cloud/alignment-worker/README.md)
and [`functions/README.md`](../../../functions/README.md) for per-component
reference detail; this doc is the order-of-operations.

---

## 0. Prerequisites

- Google Cloud project with billing enabled. Firebase + Cloud Run share
  the project.
- `gcloud` CLI authenticated (`gcloud auth login`) and defaulted to the
  project (`gcloud config set project <PROJECT_ID>`).
- `firebase` CLI authenticated (`firebase login`) and the same project
  selected (`firebase use <PROJECT_ID>`).
- A Firebase Admin service account JSON for local testing, with Firestore
  read/write scope. Path in `GOOGLE_APPLICATION_CREDENTIALS`.

Enable the APIs once:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com
```

---

## 1. Deploy the Cloud Run worker

From the repo root:

```bash
cd cloud/alignment-worker
gcloud run deploy alignment-worker \
  --source . \
  --region us-central1 \
  --gpu 1 --gpu-type nvidia-l4 \
  --cpu 4 --memory 16Gi \
  --max-instances 10 \
  --concurrency 1 \
  --timeout 3600 \
  --no-allow-unauthenticated
```

Cloud Build packages the `Dockerfile`, pushes to Artifact Registry, and
rolls out the revision. First deploy takes ~10 min (the GPU image is
large); subsequent deploys reuse layers and finish in ~3.

Key flags:

- `--gpu 1 --gpu-type nvidia-l4`. L4 is the cost/perf sweet spot for
  Whisper small. T4 is ~30 % cheaper but ~50 % slower; prefer T4 only if
  you're bulk-aligning a backlog overnight.
- `--concurrency 1`. Whisper saturates the GPU per request; queuing
  additional concurrent requests on one instance slows everyone.
- `--timeout 3600`. An hour covers a ~20-hour audiobook; bump if you
  expect longer.
- `--no-allow-unauthenticated`. The Function calls with an identity
  token; nothing else should reach the worker directly.

Grab the URL that `gcloud run deploy` prints — you'll paste it as
`WORKER_URL` in the next step:

```
Service URL: https://alignment-worker-XXXXX-uc.a.run.app
```

### Smoke test (optional)

From a workstation with `GOOGLE_APPLICATION_CREDENTIALS` set:

```bash
TOKEN=$(gcloud auth print-identity-token --audiences=https://alignment-worker-XXXXX-uc.a.run.app)
curl -X POST https://alignment-worker-XXXXX-uc.a.run.app/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "jobId":"smoke","userId":"u1","bookId":"b1","source":"dropbox",
    "accessToken":"...","audioFileId":"/path/book.m4b","epubFileId":"/path/book.epub"
  }'
```

A 200 with `{ok: true}` confirms the worker image, GPU, Firestore auth,
and source adapter are all healthy. Any failure hits Cloud Logging under
the service name.

---

## 2. Wire the Firebase Function dispatcher

```bash
cd functions
npm install
```

Set the secrets (stored in Secret Manager, injected as env at invocation):

```bash
firebase functions:secrets:set WORKER_URL
# paste the Cloud Run URL from step 1

firebase functions:secrets:set MONTHLY_JOB_CAP
# optional — defaults to 10; raise if your per-user budget is larger
```

Grant the Function's service account permission to invoke the worker:

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# On v2 functions this is `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`
# unless you configured a dedicated runtime SA.
gcloud run services add-iam-policy-binding alignment-worker \
  --region us-central1 \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/run.invoker
```

Deploy:

```bash
npm run deploy
```

---

## 3. Verify end-to-end

From the client, trigger an alignment job the app way — add a cloud book,
open it. Then watch:

```bash
# Firebase Function picked it up
firebase functions:log --only dispatchAlignmentJob --lines 50

# Worker progress
gcloud run logs read alignment-worker --region us-central1 --limit 100
```

In Firestore, `users/{uid}/books/{bookId}/alignment/status` flips from
`processing` → `complete`, and `completedChapters` ticks up as each
chapter's DTW finishes.

In the app, the Sync badge progresses from "Syncing" → "Synced" and the
player's live-follow tick starts using L1 anchors (sentence-accurate) in
chapters where they've been written.

---

## 4. Day-2 operations

- **Rollback.** `gcloud run services update-traffic alignment-worker
  --to-revisions PREVIOUS=100 --region us-central1`. Revisions live
  indefinitely so rollback is O(seconds).
- **Cost.** Keep an eye on GPU minutes; Cloud Run bills per-100ms only
  while a request is in flight (no idle GPU charges). Per-user monthly
  cap is enforced in the Function — adjust via
  `firebase functions:secrets:set MONTHLY_JOB_CAP` then redeploy.
- **Model swap.** `WHISPER_MODEL` env on the Cloud Run service
  (`small` default; `tiny` for cost, `medium` for accuracy). Set via
  `gcloud run services update alignment-worker --set-env-vars
  WHISPER_MODEL=medium --region us-central1`.
- **Stuck jobs.** The worker is idempotent — safe to re-trigger by
  flipping a job's `status` back to `pending`; it'll skip chapters that
  already have anchors.

## 5. Known gaps

- **iCloud.** No adapter yet — needs a CloudKit server-to-server token
  flow. Drive + Dropbox ship first.
- **Auth-failure retry.** Worker reports `failed` on expired credentials;
  the client must re-enqueue with a fresh `accessToken`. Automating this
  handshake is tracked in the plan doc.
- **Pseudo-CFIs.** Worker emits `pseudo:chN/sM` anchor CFIs because
  Python epub tooling can't produce CFIs that match the RN reader's
  canonical form. The reader-side ingest is responsible for mapping them
  on first use.
