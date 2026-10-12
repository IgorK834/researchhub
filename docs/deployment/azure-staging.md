# Ephemeral Azure staging (RH-329 / RH-330 / RH-343 / RH-344)

This runbook implements the staging window from [ADR-010](../adr/ADR-010-deployment-topology.md).
The Spring application remains a modular monolith; pgvector, JDBC sessions, PostgreSQL quotas and
durable dispatch remain the shared state. Python runs only the existing AI/data worker. No Redis,
Service Bus, Search, cloud sandbox adapter or production topology is introduced.

## Preconditions and cloud acceptance boundary

Use a clean, committed checkout. Required for **every** shell entrypoint:

```bash
export ENVIRONMENT=staging
export AZ_SUBSCRIPTION_ID='<subscription UUID>'
export AZ_RESOURCE_GROUP='rg-rh-staging-<alias>'
```

Replace placeholders before use. The group name must match the staging prefix and must not contain
`prod` in any case. Configure `STAGING_OWNER` (lowercase alias), `ALERT_EMAIL` and a restricted
`STAGING_CLIENT_CIDR` (`/24`–`/32`, normally the operator/runner IP `/32`) before deployment.
The static frontend accepts only this CIDR, including during synthetic registration. PostgreSQL is
private; Spring/worker ingress is internal. Workspace permission checks remain in Spring.

Tools: Java 25 for backend verification, Node >=22, Docker, Azure CLI authenticated to the explicitly
selected subscription, Bicep **0.48.1**, ShellCheck, and k6 **2.3.0** for optional load. The application
uses Spring Boot 4.1.1 / its BOM; no frontend lockfile is changed. Azure CLI extensions `containerapp`
and `application-insights` must be available. Confirm PostgreSQL 17/B1ms and Container Apps capacity.
Budgets must be supported by the subscription. The deployment queries Cost Management and refuses
an unknown/non-USD currency rather than silently calling 5/10/20 billing units USD. An empty billing
history can therefore block provisioning; establish the subscription's budget/currency contract first.

There is no recorded live Azure deployment for this change. Compiler tests, stubs, local ingestion
and Testcontainers prove specific offline/runtime contracts, not resource provisioning, portal chart
rendering, Azure ingestion, regional capacity or alert delivery. A successful cloud run requires the
evidence gates below. [Validation report](../development/azure-staging-validation.md).

## Scripts and lifecycle

All wrappers start with `set -euo pipefail`, require the three explicit variables above, and call a
tested Node orchestrator with argument arrays. Every wrapper accepts `--dry-run`; it prints a plan
with symbolic registry/digest/private-file references, without running Azure, Docker, seeding or deletion.

```bash
scripts/azure/deploy-staging.sh --dry-run
scripts/azure/destroy-staging.sh --dry-run

scripts/azure/deploy-staging.sh
scripts/azure/seed-staging.sh
scripts/azure/run-smoke.sh
scripts/azure/run-load-test.sh     # optional, fixed 5 users / 2 minutes
scripts/azure/collect-results.sh
scripts/azure/destroy-staging.sh  # separate explicit action, after evidence collection
```

Deploy validates config/ownership/currency, creates the dedicated tagged group, runs Bicep validation
and resource-only what-if, and provisions the foundation. It builds/pushes backend, worker and frontend
images to ACR by full Git SHA (never `latest`) and resolves actual digests. ACR admin credentials are
disabled; apps pull via an AcrPull-only managed identity. Backend `BUILD_COMMIT` is mandatory and is
embedded in build-info; the image also carries the OCI revision label. An uncommitted tree is refused.

The initial backend has **one replica**. Existing Flyway migrations run during startup; readiness and
protected info must report the exact expected migration, image digest and SHA. Only then the template
creates two backend replicas with pool 5. The rollout budget allows both old and new two-replica
revisions to overlap, including registration-setting updates:
`4*(5+2)=28 <= floor(0.8*(50-15))=28`. The validated pool value is passed through the root template
to `DB_POOL_MAX_SIZE`. Live server limits remain a check, not a guessed guarantee.
Hibernate uses `validate`; Spring Session schema initialization remains disabled. No schema migration
is introduced by these tasks.

`deployment.json` records SHA, all three image digests, migration version, staging environment, UTC
timestamp, outputs and TTL. Resource group and taggable resources receive the same revision facts.
Every taggable resource carries `project`, `environment`, `owner`, `purpose`, `managed-by` and `ttl`;
`validation-group` links Azure-managed environment resources to the subscription budget. Child
resources, role assignments and budgets that do not support tags inherit scope/identity from their
tagged owner; unsupported ARM `tags` properties are not fabricated.

Seeding opens registration only on the CIDR-restricted fixture, creates six generated synthetic
accounts and two authored RC text sources, waits for processing, then disables registration in
`finally`, including after a seed failure. It uses existing public REST/CSRF flows, not SQL injection.
The smoke verifies landing, login, the **same session on two real replica IDs**, protected instance
identity, workspace access, upload/processing, cited retrieval, deterministic source comparison and
SHA-256 of immutable Blob bytes. It also rejects anonymous info and a foreign workspace.

The worker is explicitly deterministic and sandbox execution stays disabled under ADR-015. The
"deterministic analysis" proof is a provenance-bearing source comparison; it does not pretend to be
an executed scientific calculation. Sandbox-failure telemetry retains the existing analysis queue
label and exports zero on a healthy fixture. No Azure runner or numerical execution success is claimed.

Generated database/service/scrape credentials and seed passwords are mode-0600 files under a private
mode-0700 directory. They never enter command arguments, public parameter files or artifacts.
Defaults: `.demo/azure/staging/private` and `.demo/azure/staging/results`; they must be disjoint.
GitHub uses `$RUNNER_TEMP` for private state and removes it after the run. CLI errors suppress captured
credential-bearing diagnostics; inspect private Azure deployment diagnostics when a command fails.
Repeated deployment rotates generated app/database credentials and revalidates migration before
scale-out; no zero-downtime guarantee is made for this disposable fixture.

## Telemetry, dashboard and alerts

Application Insights Java agent **3.7.9** is pinned by SHA-256 in the backend image. It is activated
only in staging via `JAVA_TOOL_OPTIONS`; its OpenTelemetry instrumentation exports the existing
Micrometer meters. The staging role is `researchhub-backend`, sampling 100% for the short synthetic
window, interval 60s. App Insights logging capture is off; structured console logs remain in Log
Analytics with `requestId`, `replicaId` and immutable build `commit`.

| Signal | Data contract |
| --- | --- |
| Rate / 5xx / HTTP p95 | App Insights `requests`, `resultCode`, numeric `duration` in milliseconds; rate per minute divided by 60; p95 from request samples, not averaged percentiles |
| Hikari active/max/pending/timeouts | Micrometer `hikaricp.connections.*` → agent `hikaricp_connections_*` in `customMetrics`, separated by `cloud_RoleInstance` |
| AI mean latency | `researchhub.ai.request.duration` → `researchhub_ai_request_duration`; timer sum/count in ms, weighted across samples |
| Terminal failed processing jobs | `researchhub.jobs.queue` → `researchhub_jobs_queue`, `queue=SOURCE_INGEST,status=FAILED`; maximum across replicas avoids double-counting shared PostgreSQL state |
| Sandbox / attempt failures | `researchhub.worker.failures` → `researchhub_worker_failures`; `customDimensions.queue` = `ANALYSIS_EXECUTION`; counts failed attempts, not distinct jobs |
| Provider unavailable | `researchhub.ai.provider.unavailable` → `researchhub_ai_provider_unavailable`; incremented for `AI_UNAVAILABLE` at the worker-backed model adapter |
| Backend replicas / CPU / memory | `Microsoft.App/containerapps`: `Replicas`, `UsageNanoCores`, `WorkingSetBytes` |
| Database connections / CPU / storage | `Microsoft.DBforPostgreSQL/flexibleServers`: `active_connections`, `cpu_percent`, `storage_percent` |

The dashboard has 13 tiles covering these signals. Queries are shared in
[`signals.json`](../../infra/azure/queries/signals.json), not duplicated names invented in IaC.
Staging uses the shortest standard 30-day workspace retention and a 0.1 GiB/day ingestion cap.
Log retention and an ingestion cap are not a hard spending stop; custom metrics and ACR can add cost.

One action group receives the parameterized email. Eight rules cover 5xx, p95, DB storage >80%, Hikari
active/max >80%, waiters, timeouts, failed processing and unavailable AI. Log rules evaluate 5-minute
windows every minute; connection pressure/waiters require five failing evaluations, while failures,
timeouts, p95 and 5xx notify on one failing evaluation. 5xx also requires the configured sample
count (default 20/minute). These are staging thresholds, not a production SLO.

Rules start disabled because they are created before application telemetry exists. Collection waits
for real Micrometer samples, verifies every query returns staging data (zero counters count as data),
and verifies each native platform metric has numeric points. It then enables all eight rules. Missing
or stale telemetry fails the run; missing data is never silently turned into success. Collection saves
Application Insights query results, platform metrics, content-free structured log fields, metric presence
and enabled-rule evidence. It does not export prompts, blobs, request bodies or signed URLs. Allow
ingestion time; if the five-minute live window has expired, rerun smoke before collecting.

Protocol references: [Java/Micrometer collection and name normalization](https://learn.microsoft.com/en-us/azure/azure-monitor/app/java-standalone-config),
[Container Apps metrics](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-app-containerapps-metrics),
[PostgreSQL metrics](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-dbforpostgresql-flexibleservers-metrics),
[request duration units](https://learn.microsoft.com/en-us/azure/azure-monitor/app/metrics-overview).

## Protected info and provenance

`GET /actuator/info` uses the existing metrics bearer token and rejects anonymous requests, ordinary
browser sessions, wrong tokens and non-GET methods. No proxy-supplied "internal" header bypasses it.
It exposes `deployment.commit`, `buildTime`, `imageDigest`, `instanceId` and latest successful
`flywayVersion`. Missing build/migration is explicit for non-deployment test slices; staging requires
complete, consistent build identity and refuses startup on a mismatched expected SHA.

Build-info comes from the Boot Maven goal; the pinned Git plugin supplies source build SHA locally.
Docker uses a checked full-SHA build argument because `.git` is not copied into the image. The runtime
digest is supplied by the trusted deployment after push. A container cannot bake its own final digest
into itself. Node compares the reported value with ACR's resolved digest; an env label alone is not proof.

## Workflows, OIDC and teardown controls

Deploy and destroy are **workflow_dispatch only** and use the protected `azure-staging` GitHub
environment. Inputs other than `staging` fail before Azure login. All actions are pinned by full SHA.
Configure environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZ_SUBSCRIPTION_ID`,
`AZ_RESOURCE_GROUP`, `STAGING_OWNER` and `ALERT_EMAIL`; no Azure client-secret/credentials secret is used.
Create the Entra federated subject `repo:<owner>/<repo>:environment:azure-staging`, audience
`api://AzureADTokenExchange`, and approval/branch restrictions in GitHub before invoking the workflow.
Azure/GitHub account setup is not performed by this repository change.

Grant only needed staging provisioning, ACR push, local AcrPull role-assignment, monitoring/query and
budget rights. Group creation and the tag-filtered subscription budget require subscription-level
deployment/budget permissions; document the principal separately from any production identity. The
subscription budget covers the fixture's `validation-group` tag including tagged managed networking.
Default actual-cost alerts are 5, 10 and 20 USD; configurable values must convert to whole percentage
points. Budgets send alerts and do not stop consumption.

Deploy uploads redacted evidence even on failure and does **not** destroy the group. Destroy checks the
actual live group tags/owner/subscription/name, deletes the dedicated group, verifies disappearance
and deletes its derived subscription budget. A partial deployment still requires cleanup; keep results
first. Confirm the managed Container Apps environment group is gone as well.

TTL runs hourly and records expired groups; it fails the run for GitHub workflow-failure notifications.
Enable notifications for the workflow. By default it deletes nothing. `AUTO_DESTROY=true` is an explicit
protected-environment variable; cleanup rechecks each group and rejects production/unowned targets.
The separate `azure-staging-ttl` environment should allow scheduled runs on the protected default branch
without interactive reviewer waits, with its own matching OIDC subject and narrowly scoped identity.
Otherwise reviewer approval can delay expiry detection. Expired detection remains a failure even when
automatic cleanup ran, so the event is observable. TTL tags are UTC expiry timestamps, not Azure timers.

## Local verification

```bash
node scripts/azure/check.mjs                 # all Bicep modules + every wrapper's ShellCheck
node --test --experimental-test-coverage \
  --test-coverage-include='scripts/azure/control.mjs' \
  --test-coverage-include='scripts/azure/services.mjs' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  scripts/azure/test/*.test.mjs
cd backend && ./mvnw verify
```

`BICEP_BIN`/`SHELLCHECK_BIN` can select pinned local binaries. Stub tests execute the real destroy wrapper
against a production-tagged group and assert no delete occurred; they test TTL expiry, workflow input
guard, dry-run, validation/migration/scale ordering, failure cleanup, cookie/CSRF, Blob hashes, signal
presence and alert activation. CI runs these checks without Azure login; an actual subscription run is
still necessary for the live acceptance criteria.
