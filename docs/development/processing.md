# Durable processing

RH-080/RH-081 establish a durable boundary between the Spring modular monolith and Python AI/data work. This is a
local stepping stone before Azure Service Bus: PostgreSQL owns job state, a scheduled Spring dispatcher claims work,
and an internal HTTP request invokes `ai-worker`. Upload HTTP requests never wait for extraction or indexing.

## Creation and identity

A successful source upload writes the `sources` row and its `SOURCE_INGEST` job in the same PostgreSQL transaction.
The blob has already been stored at this point; if either database write fails, that transaction rolls back and the
upload compensation removes the blob. The source therefore becomes visible as `UPLOADED` together with a durable
`PENDING` job, never as `READY` without work.

`processing_jobs` is created by `V10__create_processing_jobs.sql`. Its unique key is
`(job_type, resource_type, resource_id)`, so duplicate enqueue requests for the same immutable source converge on one
job. The job UUID is also the delivery idempotency key sent to Python. Identity fields and `created_at` are immutable.

Initial vocabulary:

| Field | Value |
| --- | --- |
| `job_type` | `SOURCE_INGEST` |
| `resource_type` | `SOURCE` |
| Status | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |

Adding `ANALYSIS_EXECUTION`, `REINDEX_SOURCE`, or another resource kind requires both a Java contract change and a
Flyway migration that widens the closed database checks.

## Claim, retry, and recovery

Every dispatcher tick first recovers stale work, then claims at most the configured batch size. Claiming is one
PostgreSQL statement using `SELECT ... FOR UPDATE SKIP LOCKED` inside a CTE followed by `UPDATE ... RETURNING`.
Concurrent backend instances therefore cannot both move the same eligible row from `PENDING` to `RUNNING`.

Claiming increments `attempt_count`. A worker failure moves the job back to `PENDING`, records only a bounded safe
error, and sets `next_attempt_at` using capped exponential backoff. Once `max-attempts` is reached the job becomes
`FAILED`. A `RUNNING` job older than `stale-timeout` is requeued in the same way, or failed if it has exhausted its
attempts. Restarting Spring needs no in-memory recovery: the next tick reads the committed rows. Stopping Python
causes `WORKER_UNAVAILABLE` retries rather than data loss.

The source module listens through the narrow `processing.application` contract. A claimed ingest job moves its source
to `PROCESSING`; success moves it to `READY`; terminal failure stores the safe summary and moves it to `FAILED`.
Detailed exceptions and stack traces are logged by the backend or worker and never copied to either metadata table.

## Authenticated internal HTTP contract

The dispatcher creates a fresh request and authenticates itself with a service Bearer token. It does not forward an
end-user `Authorization`, cookies, CSRF headers, or any browser request object. The shortened shape is:

```http
POST /internal/jobs/source-ingest
Content-Type: application/json
Authorization: Bearer <service credential>

{
  "schemaVersion": "2.0",
  "jobId": "uuid",
  "workspaceId": "uuid",
  "sourceId": "uuid",
  "sourceType": "PDF",
  "fileAccess": {"kind": "SIGNED_URL", "url": "https://...", "expiresAt": "..."},
  "requestedProcessingVersion": "source-ingest-2",
  "attempt": 1
}
```

Spring resolves the source with both workspace and source id and creates a short-lived read-only SAS. Python validates
an exact field set and refuses a handler result that changes any identity; Spring repeats the identity and result
limit checks. Redelivery of the same job and immutable target in one worker process is acknowledged without executing
the handler twice, even when `attempt` and the renewed SAS change. Reuse of a job id for a different target is `409`.
Future durable outputs must also use `jobId` as their database idempotency key because a worker restart intentionally
clears its process-local delivery cache.

The synchronous response separates extraction metadata, page/section structure, chunks with provenance, warnings,
and a safe failure. Canonical examples, compatibility rules, size/count limits, and credential behavior are in
[source-extraction.md](source-extraction.md). The handler extracts PDF/DOCX/XLSX content with source provenance;
Spring persists the validated output before publishing READY. Index writes remain later work.

## Local operation

Start all local dependencies from the repository root:

```bash
docker compose up -d postgres azurite ai-worker
cd backend
./mvnw spring-boot:run
```

The worker image is built from `ai-worker/Dockerfile`, is pinned to Python 3.13.3, and installs the production subset
from the committed `uv.lock`. Its health endpoint is `GET http://localhost:8090/health`. PostgreSQL's named volume
preserves jobs across ordinary Compose restarts.
`docker compose down -v` is the intentional reset that deletes them.

The worker does not receive `DB_URL`, has no PostgreSQL driver, and must not read product tables directly. Spring owns
authorization, source metadata, and durable job state. FastAPI is used only for the health probe and internal job
delivery; it is not a second product/domain API.

| Spring property | Environment variable | Default |
| --- | --- | --- |
| `researchhub.processing.dispatcher.enabled` | `PROCESSING_DISPATCHER_ENABLED` | `true` |
| `researchhub.processing.dispatcher.fixed-delay` | `PROCESSING_FIXED_DELAY` | `PT1S` |
| `researchhub.processing.dispatcher.batch-size` | `PROCESSING_BATCH_SIZE` | `4` |
| `researchhub.processing.dispatcher.max-attempts` | `PROCESSING_MAX_ATTEMPTS` | `5` |
| `researchhub.processing.dispatcher.initial-backoff` | `PROCESSING_INITIAL_BACKOFF` | `PT2S` |
| `researchhub.processing.dispatcher.max-backoff` | `PROCESSING_MAX_BACKOFF` | `PT1M` |
| `researchhub.processing.dispatcher.stale-timeout` | `PROCESSING_STALE_TIMEOUT` | `PT5M` |
| `researchhub.processing.worker.base-url` | `AI_WORKER_BASE_URL` | `http://127.0.0.1:8090` |
| `researchhub.processing.worker.request-timeout` | `AI_WORKER_REQUEST_TIMEOUT` | `PT30S` |
| `researchhub.processing.worker.source-access-ttl` | `AI_WORKER_SOURCE_ACCESS_TTL` | `PT5M` |
| `researchhub.processing.worker.service-token` | `AI_WORKER_SERVICE_TOKEN` | local-only Compose value |

Compose also reads `AI_WORKER_PORT` (default `8090`) for the host mapping; when changing it, change the base URL too.
Durations use ISO-8601 syntax. Source access is positive and at most 15 minutes. Service tokens have at least 32
characters. A deployed value comes from secret configuration and is never a `RESEARCHHUB_*` browser variable.

## Verification

`PostgresProcessingJobQueueIntegrationTest` proves restart persistence, idempotent enqueue, stale recovery, bounded
retry, worker-down behavior, and a real two-thread double-claim race against PostgreSQL. The HTTP client test asserts
that no user credential header crosses the boundary. `./mvnw verify` enforces at least 80% line coverage for the Java
processing module separately from source; `uv run --frozen pytest` enforces at least 80% branch-aware worker coverage.

RH-090/RH-091/RH-093: PDF/DOCX/XLSX extraction is implemented end to end. See
[Source extraction](source-extraction.md) for provenance, parser limits, cloud OCR evaluation and verification.
