# Azure staging tasks — local validation, 2026-10-12

Implemented scope: RH-343 monitoring/dashboard, RH-344 protected build/migration identity,
RH-329 guarded lifecycle scripts, RH-330 manual OIDC workflows, budgets and scheduled TTL detection.
The missing telemetry dependency is supplied by a digest-pinned Application Insights Java 3.7.9 agent
using OpenTelemetry instrumentation/Micrometer collection. The Azure sandbox remains unavailable.

| Verification | Result |
| --- | --- |
| Java 25 / Maven `verify` | BUILD SUCCESS: 1308 tests, 0 failures/errors, 27 optional skips; all configured coverage gates passed |
| Shared observability module | 99.28% lines / 96.25% branches, with >=80% gates; protected info, incomplete/mismatched identity, Flyway metadata and structured logs covered |
| Staging Node lifecycle/services/contracts | 18 passing tests; 100% lines and >97% branches/functions, gated at >=80%; real destroy wrapper tested with stub `az` and production-tagged group, no deletion |
| Bicep 0.48.1 | Staging main + all 4 modules build/lint without diagnostics; existing dev templates remain separate |
| ShellCheck 0.11.0 | All 7 shell wrappers pass |
| YAML | Every Azure workflow parses; actions are pinned, manual deploy/destroy use OIDC and protected environment; actual production-input guard executed locally and failed as required |
| Docker backend build | Successful non-root image with checked SHA build argument, build-info and pinned agent/config included; no image push performed |
| Real pinned agent → local ingestion stub | Java 25 probe passed: normalized `researchhub_*` / `hikaricp_*` names, zero counters for both queues, timer sum 123 ms / count 1; no Azure data was sent |
| Live Azure acceptance | Not run: subscription/OIDC environment/action-group recipient and cloud access have not been supplied |

The backend/image checks ran against the current working tree, which includes earlier unrelated,
uncommitted work. They are build/contract evidence, not a clean released-image claim. The staging
deployer refuses such a dirty checkout. A future GitHub/manual cloud run uses a clean commit, records
ACR digests and compares every sampled instance's info with the manifest before reporting success.

Reproduce the local exporter test after Maven tests have generated the classpath report:

```bash
STAGING_AGENT_JAR=/path/to/applicationinsights-agent-3.7.9.jar \
  node scripts/azure/agent-contract.mjs
```

The script verifies the downloaded agent against `backend/observability/agent-lock.json`, compiles a
synthetic Micrometer emitter, launches Java with that agent and captures HTTP ingestion on localhost.
It checks actual wire metric names, labels, zero values and timer units. CI runs the same probe after
Maven `verify`. It does not validate Azure-side KQL, delivery or portal rendering.

Lifecycle/monitoring reproduction commands and expected live evidence are in
[the runbook](../deployment/azure-staging.md). Collection enables alerts only after current staging
query/native-metric data is present. Dashboards/rules being compilable does not establish that their
provider deployment, queries, ingestion or alert email delivery have succeeded.

No existing Flyway migration is changed, no Hibernate schema creation is enabled, and no frontend/Python
package lock is modified. Staging keeps private PostgreSQL, the modular monolith, worker-only AI logic,
server workspace authorization and immutable source/provenance references. Production provisioning,
distributed collaboration, a cloud execution adapter and erasure implementation remain outside this work.
