# Firebase Functions

Single purpose: dispatch alignment jobs to the Cloud Run worker.

- Watches `/alignmentJobs/{jobId}` for new docs.
- Enforces the per-user monthly job cap.
- Calls the Cloud Run worker with an identity-token-authenticated POST.
- Writes back `status: 'failed'` on dispatch errors so the client sees it.

The worker does all the actual alignment work — this function is thin on
purpose so it stays within the Functions free-tier runtime budget.

## Setup

```bash
cd functions
npm install
firebase functions:secrets:set WORKER_URL       # your Cloud Run URL
firebase functions:secrets:set MONTHLY_JOB_CAP  # optional, default 10
npm run deploy
```

The Function's service account needs `roles/run.invoker` on the Cloud Run
worker service.

## Client contract

See [`src/services/firebase/alignmentJobs.ts`](../src/services/firebase/alignmentJobs.ts)
for the shape the app writes. Progress is observable on
`users/{userId}/books/{bookId}/alignment/status`.
