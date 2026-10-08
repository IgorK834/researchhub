# PostgreSQL dispatcher concurrency (RH-328)

The durable queue remains in PostgreSQL under [ADR-011](../adr/ADR-011-durable-processing-in-postgresql.md).
Three independent Spring contexts have separate Hikari pools and transaction managers against
one Testcontainers pgvector PostgreSQL 17 database, migrated with the production Flyway scripts.
Each queue receives 200 jobs. A start barrier releases three dispatchers together, and recording
fake worker/renderer/sandbox boundaries check the exact set of IDs and one call per ID. Each queue
runs **20 consecutive times**: 4,000 source jobs, 4,000 report exports and 4,000 analysis executions.
Every row must be `SUCCEEDED`, with a completion timestamp and no pending/running leftovers.
Worker threads propagate failures through bounded futures; a timeout cannot pass the test.

The processing queue claims with one atomic `UPDATE … RETURNING` over a `FOR UPDATE SKIP LOCKED`
candidate. Export and analysis stores select and update within real Spring-managed transactions
with the same row lock. Their proxies are deliberately exercised: constructing those adapters
directly would not activate `@Transactional`. No double-claim was found and no queue SQL change
was necessary. The tests use the actual dispatchers and completion services; only expensive
worker/render/sandbox dependencies and unrelated authorization/input reads are substituted.

The crash test blocks a processing dispatcher immediately after its committed claim, before the
worker call, interrupts its thread and closes its context/pool. Another context leaves the job
alone before the lease expires, recovers attempt 1 at expiry, and handles retryable failures on
attempts 2 and 3 with exponential backoff capped at four seconds. Attempt 4 completes. The old
attempt cannot overwrite the new state because the update compares both status and attempt count.
Existing queue tests cover stale recovery exhaustion and terminal failure at the retry bound.

This proves exclusive claiming and the tested recovery semantics. Delivery after a lease expires
is **at least once**: a worker that performed an external side effect and lost its response can
be retried. That requires idempotent worker effects/fencing; choosing a broker would not by itself
make those effects exactly once. Export and analysis retain their established terminal interrupted
attempt policy, rather than automatically retrying immutable execution records.

Run from `backend/`:

```bash
./mvnw -Dtest='*DispatcherRaceIntegrationTest' test
./mvnw verify
```

Test entrypoints are `ProcessingDispatcherRaceIntegrationTest`,
`ExportDispatcherRaceIntegrationTest` and `AnalysisDispatcherRaceIntegrationTest`.
JaCoCo's existing processing, export and analysis 80% coverage gates apply in full verification.
