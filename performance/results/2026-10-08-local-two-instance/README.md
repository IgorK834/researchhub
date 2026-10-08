# 2026-10-08: local two-instance evidence

RH-192, RH-316, RH-325, RH-326 and RH-327 were validated locally end to end. Both replicas
served authenticated requests from a single session; the same session survived stopping one
replica. Atomic PostgreSQL quotas admitted exactly **60 of 128** concurrent requests globally.
All **eight recorded two-minute load runs**, totalling **83,432 runtime requests**,
completed with zero HTTP errors and zero authentication/CSRF failures. No planned measurement
was discarded. Setup/login traffic is excluded from the latency table and runtime totals.

## Environment and topology

[Machine facts](machine.json): Apple M4 Pro, Mac16,8, 12 host cores, 24 GiB RAM, macOS 15.7.4
ARM64. Docker Desktop 29.4.3 had 12 virtual CPUs and 7.75 GiB available RAM. This is a developer
laptop with local virtualization and background workloads, not a cloud environment.

[Compose](../../../infra/demo/compose.scale.yaml) runs two non-root backend images (1 GiB each),
one PostgreSQL 17/pgvector database, shared Azurite storage, one deterministic AI worker
(1 GiB), and Caddy round robin without a sticky cookie. Sessions use JDBC, quotas PostgreSQL,
and every response carries `X-Replica-Id`; structured application logs include `replicaId`.
Both model and embedding providers are deterministic. The measured topology disables the
sandbox. The earlier fixture seed used the real constrained Docker sandbox through a trusted
host backend; backend containers never receive the Docker socket.

Each backend pool is capped at eight connections, minimum idle two, connection timeout
3 s and maximum lifetime 240 s. The budget is `2 × (8 + 2) = 20 <= 0.8 × 50 = 40`.
The extra two are a capacity allowance, not a separate scheduler pool; request and scheduled
work use the same Hikari pool. See [persistence capacity rules](../../../docs/development/persistence.md).

## All measured load runs

Every row represents two minutes, with five VUs for smoke/retrieval and 50 for api-read.
Read scenarios use a one-second pause; retrieval uses 15 seconds. Each VU has its own
pre-created synthetic account and session. Retrieval checks supported answers and citations.
These are closed-loop VUs with think time, not simultaneous requests or an open-loop arrival rate.

| Series | Run | VUs | Runtime requests | p50 ms | p95 ms | p99 ms | HTTP error rate / auth failures | backend-1 / backend-2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | smoke-1 | 5 | 3480 | 4.72 | 16.40 | 28.96 | 0% / 0 | 1739 / 1741 |
| baseline | api-read-1 | 50 | 34632 | 4.11 | 16.36 | 40.33 | 0% / 0 | 17316 / 17316 |
| baseline | smoke-2 | 5 | 3510 | 3.22 | 12.46 | 19.72 | 0% / 0 | 1756 / 1754 |
| baseline | api-read-2 | 50 | 34800 | 4.28 | 15.59 | 30.64 | 0% / 0 | 17400 / 17400 |
| confirmation | smoke-1 | 5 | 3510 | 3.02 | 11.89 | 18.03 | 0% / 0 | 1755 / 1755 |
| confirmation | retrieval-1 | 5 | 40 | 142.81 | 295.11 | 296.55 | 0% / 0 | 16 / 24 |
| final | smoke-1 | 5 | 3420 | 6.04 | 21.87 | 48.08 | 0% / 0 | 1710 / 1710 |
| final | retrieval-1 | 5 | 40 | 150.78 | 353.08 | 354.76 | 0% / 0 | 24 / 16 |

[Combined summary](k6-summary.json) retains per-endpoint p50/p95/p99, request/error counts,
replica distribution, original summary paths and k6 exit codes. Original `--summary-export`
outputs are retained for all eight runs. The first four-run aggregate is unchanged in
[baseline-k6-summary.json](baseline-k6-summary.json); confirmation and final aggregates remain
in their own subdirectories. Every k6 process exited zero and every enforced threshold passed.

## Frozen latency thresholds

The first four runs had [no p95 thresholds](initial-baseline.json), while error/authentication
thresholds were enforced. Their worst endpoint p95 determined the read regression budgets:
`max(100, ceil(3 × measured p95 / 50) × 50)` milliseconds.

| Read endpoint | Worst first-baseline p95 ms | Frozen p95 budget ms |
| --- | --- | --- |
| analysis-history | 14.45 | 100 |
| audit-read | 14.14 | 100 |
| document-read | 14.63 | 100 |
| source-list | 16.31 | 100 |
| workspace-detail | 17.56 | 100 |
| workspace-list | 22.78 | 100 |

The confirmation smoke enforced those [read budgets](read-baseline.json). The first retrieval
run measured p95 295.11 ms; the same rule then fixed its budget at **900 ms**. The final smoke
and retrieval enforced the [complete budgets](final-baseline.json), without relaxing any limit.
The final workspace-list p95 rose to 43.93 ms, and retrieval to 353.08 ms; both remained within
the previously fixed budgets. These are local regression budgets, not a production SLA.
Workspace-members has no recorded p95 budget yet. The full 12-minute 50→200 VU mixed ramp
and standalone workspace scenario passed inspection/unit tests but were not load-measured.

## Sessions and exact global quota

Both [initial](consistency-initial.json) and [final](consistency-final.json) consistency checks
used a single login for **100 sequential authenticated requests**, distributed **50/50** between
replicas. Stopping backend-1 left the same session valid for **20/20** further requests through
Caddy on backend-2. Backend-1 was restored and became healthy afterwards.

The separate quota check sent **128 concurrent attempts** with 16 client threads to both
replicas directly, using four synthetic users in one new synthetic workspace within a single
aligned minute. The per-user cap was 20; the workspace cap was 60. Exactly **60 returned 200**
and **68 returned 429**. Initially the admitted split was 30/30; finally it was 29/31.
The 200 responses exercised the costly question endpoint with explicit insufficient evidence.
Thus successful admission was limited to 60 globally, rather than 60 per replica; user quotas
did not prevent reaching that exact workspace cap. These deliberate 429s are separate from the
zero-error load baseline and are retained in the consistency proofs.

## Resources and connection contention

[metrics.csv](metrics.csv) combines all **576** resource rows with a series/run label.
Unchanged per-series CSVs remain in [baseline-metrics.csv](baseline-metrics.csv),
[confirmation/metrics.csv](confirmation/metrics.csv) and [final/metrics.csv](final/metrics.csv).
Sampling uses `docker stats`, read-only `pg_stat_activity`, and scrape-token-protected
Micrometer/Hikari gauges. Sampling pauses five seconds after collection, so brief peaks may
be missed. There were no sampling failures.

| Series | Service | Sampled CPU peak | Sampled memory peak | Pool active peak | Pool pending peak |
| --- | --- | --- | --- | --- | --- |
| baseline | backend-1 | 150.40% | 499.6 MiB | 8.0 | 19.0 |
| baseline | backend-2 | 152.37% | 521.2 MiB | 7.0 | 6.0 |
| baseline | postgres | 52.42% | 82.0 MiB | — | — |
| baseline | ai-worker | 15.96% | 53.3 MiB | — | — |
| confirmation | backend-1 | 33.64% | 538.6 MiB | 2.0 | 0.0 |
| confirmation | backend-2 | 34.25% | 539.1 MiB | 1.0 | 0.0 |
| confirmation | postgres | 7.67% | 84.4 MiB | — | — |
| confirmation | ai-worker | 13.36% | 63.1 MiB | — | — |
| final | backend-1 | 141.76% | 469.4 MiB | 2.0 | 0.0 |
| final | backend-2 | 78.27% | 441.4 MiB | 1.0 | 0.0 |
| final | postgres | 20.99% | 79.1 MiB | — | — |
| final | ai-worker | 16.47% | 66.2 MiB | — | — |

Docker CPU percentages use 100% per logical core. Database connection peaks were **17**, **12**
and **16** for baseline, confirmation and final, including the monitoring connection. Two
eight-connection pools plus that monitor explain the first peak of 17; configured capacity
remained below the budget. Memory figures are Docker sampled usage, not isolated JVM heap.

The first series briefly observed **19 pending waiters** on backend-1 and six on backend-2;
scheduled components share the request pool, so this does not prove starvation is impossible.
All requests still succeeded at the reported latencies. Later series sampled zero pending
waiters. Sustained occupancy above 80% for five minutes, pending connections or increasing p95
should trigger the Task 21.15 investigation described in the configuration/persistence guides.
Do not scale replicas or increase pool sizes without rechecking the connection formula.

## Synthetic seed and real sandbox provenance

[Seed proof](seed-proof.json) records four fixture hashes, answer states and the immutable
analysis input/code/plan/image identities. [Idempotence proof](seed-idempotence.json) confirms
two runs reused the same workspace, four sources and successful execution; fixture regeneration
is byte-stable. The document contains Objective, Theory, Method, Measurements, Analysis,
Discussion and Conclusion, with collaboration comments and bound analysis outputs.

The real sandbox fit all **243** synthetic measurements from the immutable workbook version:
estimated tau **4.877783 s**, log-linear R² **0.998010**, with measured/fitted curves and residuals.
The nominal component expectation is **4.7 s**. The grounded question returned `SUPPORTED`
with three citations; humidity returned `INSUFFICIENT_EVIDENCE` with none. The executed sandbox
image in provenance predates the final metadata-only `HEALTHCHECK NONE` change; its numerical
runtime/code were unchanged. The final one-shot image and its non-root configuration were also
built and verified, with identities in [image-identities.txt](image-identities.txt).
Passwords, service tokens, cookies, CSRF values and private seed state are excluded from evidence.

## Source identity and validation

`commit.txt` identifies the committed implementation **d0b62a9ef498df0592e7ef44bc9158ab6acb5f70**, used for the final measured
series. Initial and confirmation runs were on the uncommitted implementation with base HEAD
9636fa6, preserved in `baseline-base-commit.txt` and `confirmation/commit.txt`. Their exact k6
sets were reconstructed from the implementation commit plus the retained budget snapshots and
verified against the SHA recorded at run start. [source-versions.json](source-versions.json)
maps every series to its original HEAD, tree, budget, script SHA and compose SHA. The recursive
script hash includes sorted repository-relative paths, a NUL separator and file bytes.

The subsequent commit **62c10f08fa999bea6eeb8d36340f79e4f6f833fb** corrects the mixed ramp's initial VU count to 50;
all five scripts were inspected and tested afterwards. It does not change the scripts executed
in this report. Original and final script hashes and the common compose hash are retained.

[Validation details](validation.json):

- Backend `mvnw verify`: **1099 passed**, zero failures/errors, **11 existing opt-in tests
  skipped** (browser/LaTeX/sandbox flags named in the JSON). All existing coverage gates passed;
  affected observability lines **99.04%**, branches **92.50%**.
- Frontend: **116 suites / 1084 tests passed**, typecheck and lint passed, production Webpack
  build passed; line coverage **98.84%**, branch coverage **95.35%**.
- AI worker: **417 passed**, combined statement/branch coverage **97.15%**;
  the RC fixture planner **100%**.
- Demo helpers: **12 unit tests**, plus actual real-sandbox seed, failover/quota and load runs;
  combined statement/branch coverage **95.98%** (minimum gate 80%).
- k6: all **five scripts inspected**, **seven unit tests passed**; lines/functions **100%**,
  branches **97.80%**. ShellCheck passed both new shell scripts.
- All four images built locally; runtime users are non-root, service health checks passed,
  and the static frontend passed read-only runtime, SPA fallback and security-header checks.
  GitHub Actions implements these stages; no remote CI execution is claimed.

## Reproduce and interpret

Follow the [demo instructions](../../../scripts/demo/README.md): build the dependencies/images,
seed twice through the trusted host backend with a real sandbox, stop that host backend, and
start the two-instance stack. Then run `scripts/demo/consistency.py` and
`scripts/demo/run-load.py --runs 2 --scenarios smoke api-read --output <fresh-directory>`.
Run retrieval separately, exporting its summary and retaining the current script SHA.
Use a fresh evidence directory; existing results cannot be overwritten by the runner.
Only synthetic accounts/fixtures and the deterministic provider may be used.

These results support shared-session continuity, atomic global admission quotas, two-replica
distribution, reproducible fixture/provenance behaviour and short read/retrieval checks within
the stated local connection budget. They **do not** establish Azure capacity, cloud failover,
paid-model quality/latency, open-loop throughput, 200-VU mixed-load capacity, upload/processing
throughput, or long-duration memory/retention behaviour. Evidence from this laptop should be
repeated in the Azure validation window before making those claims.
