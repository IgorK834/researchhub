# ADR-011: Durable processing jobs in PostgreSQL

- Status: Accepted
- Date: 2026-10-08
- Tasks: RH-349, RH-080, RH-081, RH-311, RH-312

## Context

Source extraction and retrieval indexing must survive an HTTP request, replica restart and temporary worker
failure. An uploaded source/version and the work needed to process it cannot diverge. The Spring monolith owns
workspace authorization and durable state; Python owns parsing, embeddings and AI/data execution. The agreed
architecture needs a bounded durable queue without adding an unrelated broker infrastructure project.

## Decision

Persist job identity, workspace/resource scope, status, attempt count, timestamps, safe errors and the next retry
instant in PostgreSQL. Create the source/version and processing job in the owning application transaction.
The dispatcher processes only committed rows. A claim is one atomic SQL statement: select the next eligible row
with `FOR UPDATE SKIP LOCKED`, mark RUNNING, increment the attempt, and return the job. Concurrent replicas cannot
own the same claim; no JVM lock is the coordination mechanism.

Run worker HTTP outside the claim transaction, with a bounded timeout and a distinct service token. The worker
receives scoped temporary Blob read access, never browser credentials. Validate the returned contract before
writing source extraction/retrieval state. Completion uses expected status **and attempt count**; completion and
resource-owner notifications commit together. A late result from a recovered attempt cannot overwrite a newer one.
Delivery is at least once, not exactly once: side effects are scoped/idempotent and stale attempts are fenced by
state/attempt checks. Immutable source versions preserve the input identity and derived provenance.

Retry only classified transient failures (for example worker unavailability/timeouts), using capped exponential
backoff and a configured attempt ceiling. Permanent validation/parser failures become terminal with safe public
errors. Recover stale RUNNING jobs: requeue attempts below the ceiling, fail exhausted ones. A replica dying after
claim therefore does not abandon work indefinitely. Processing uses a sequential bounded batch per tick, the same
shared datasource, and no connection is held across the worker request. Metrics include queue age/state, retry and
failure counts; scheduler/pool limits are part of the [connection budget](../development/persistence.md#connection-budget-and-autoscaling-rh-314).

The analysis execution and export queues also use PostgreSQL claims, but retain their module-specific lifecycle.
Analysis marks interrupted execution failed; export marks interrupted rendering failed. They do not inherit source
retry/backoff behavior merely because they use the same database. AI/data Python concerns remain outside Java domain logic.

## Consequences

Uploads return while processing continues; durable failures/retries remain visible and auditable. Schema constraints,
transactions and Flyway migrations define the state machine. Polling adds database reads and a dispatch-delay latency;
queue activity competes within the database budget. Stale timeout must exceed normal execution plus transport overhead.
The model supports the current workload and multiple Spring claimants, while the database remains a shared failure domain.

## Alternatives considered

- **In-process async work:** loses pending work on shutdown and cannot coordinate replicas.
- **Immediate broker adoption:** adds deployment, credentials, consumer settlement, duplicate handling and a database-to-
  broker publication boundary before workload evidence requires it. A broker alone does not solve the commit/publish gap.
- **Azure Service Bus:** adopt when measured polling/lock/connection pressure breaches the request SLO, queue volume or
  dispatch latency exceeds this design, or independent consumer scaling, dead-letter operations and broker delivery
  controls become concrete requirements. Keep PostgreSQL job/provenance as authority and add a transactional outbox
  plus idempotent consumers and explicit migration/settlement contracts in that task; do not add dual writers here.

## Implementation and verification

- [Queue port](../../backend/src/main/java/dev/researchhub/processing/application/ProcessingJobQueue.java),
  [job creation](../../backend/src/main/java/dev/researchhub/processing/application/ProcessingJobService.java),
  [atomic claims/CAS/recovery](../../backend/src/main/java/dev/researchhub/processing/infrastructure/PostgresProcessingJobQueue.java),
  [dispatch/retry/backoff](../../backend/src/main/java/dev/researchhub/processing/application/ProcessingJobDispatcher.java),
  [worker transport](../../backend/src/main/java/dev/researchhub/processing/infrastructure/HttpProcessingWorkerClient.java).
- [Real PostgreSQL claims and rollback](../../backend/src/test/java/dev/researchhub/processing/infrastructure/PostgresProcessingJobQueueIntegrationTest.java),
  [dispatcher policy](../../backend/src/test/java/dev/researchhub/processing/application/ProcessingJobDispatcherTest.java),
  [worker contract](../../backend/src/test/java/dev/researchhub/processing/infrastructure/HttpProcessingWorkerClientTest.java),
  [source extraction E2E](../../backend/src/test/java/dev/researchhub/source/api/SourceExtractionEndToEndTest.java).
- [Operational settings](../development/processing.md) and [immutable source versions](ADR-005-immutable-source-versions.md).
