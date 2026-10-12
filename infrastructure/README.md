# Disposable Azure infrastructure (RH-200 / RH-201)

Decisions: [ADR-010 topology, diagram and cost controls](../docs/adr/ADR-010-deployment-topology.md),
[ADR-017 Bicep versus Terraform](../docs/adr/ADR-017-azure-infrastructure-as-code.md).
This is a reproducible **dev fixture**, not a tested Azure release or production manifest. Offline
compilation/tests do not prove provider availability or runtime compatibility in a subscription.

## Scope and prerequisites

`main.bicep` creates a deterministic resource group at subscription scope. `modules/foundation.bicep`
creates private PostgreSQL 17 B1ms (VECTOR allowlist, empty database), authenticated Blob/container,
VNet/private DNS, Consumption Container Apps environment and capped Log Analytics. With
`deployApplications=true`, `modules/applications.bicep` adds internal backend/worker and a public static
frontend/Caddy edge. The Foundation already costs money even without apps.

Prerequisites: Node >=22 with test coverage threshold support; Azure CLI with Bicep **0.48.1**; a selected
Azure subscription with resource-group/provider creation rights and credit; available `westeurope` B1ms,
PostgreSQL 17 and Container Apps capacity. Confirm student restrictions and register only these providers
if they are not already registered: `Microsoft.Resources`, `Microsoft.Network`, `Microsoft.Storage`,
`Microsoft.DBforPostgreSQL`, `Microsoft.OperationalInsights`, `Microsoft.App`. Provider registration/region
availability is a live prerequisite, not something offline tests establish.

```bash
az login
az config set bicep.use_binary_from_path=false bicep.check_version=false
az bicep install --version v0.48.1
node infrastructure/scripts/check.mjs
node infrastructure/scripts/deploy.mjs validate
node --test --experimental-test-coverage \
  --test-coverage-include='infrastructure/scripts/deployment.mjs' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  infrastructure/test/*.test.mjs
```

The compiler/linter and tests use no Azure login. A standalone compiler can be selected with `BICEP_BIN`;
its version must also be 0.48.1. All compiled files and sensitive parameters are temporary, outside Git.
CI runs these commands in [azure-infrastructure.yml](../.github/workflows/azure-infrastructure.yml).

## Provision a clean fixture

Copy `environments/dev.json` to an **untracked** file under `infrastructure/`, for example
`infrastructure/dev.parameters.json`. This suffix is ignored by Git. Set a lowercase `owner` alias;
the default is `student`. Subscription plus `rg-rh-dev-<owner>` determine stable globally unique names.
Do not use email addresses or secrets in tags/configuration. The wrapper rejects unknown fields.

Supply secrets via private environment injection from your password manager/CI secret store. Do not
put values in shell command arguments/history or public parameter files. Required for foundation:
`AZURE_SUBSCRIPTION_ID` (subscription UUID) and `RH_DB_PASSWORD` (32–128 characters). Never generate a
different database password for a repeat deployment unless intentionally rotating it. When apps are
enabled also supply distinct `RH_WORKER_SERVICE_TOKEN` and `RH_METRICS_SCRAPE_TOKEN` (32–128 characters).
The database password must contain three of lowercase, uppercase, digits and non-alphanumeric characters,
and exclude the database login. Use generated credentials; quoted examples in tests are not deployment values.

```bash
# After private environment injection:
node infrastructure/scripts/deploy.mjs what-if infrastructure/dev.parameters.json
# Review resource changes and the window's credit allocation, then provision:
node infrastructure/scripts/deploy.mjs deploy infrastructure/dev.parameters.json
```

The wrapper validates the config and connection budget before calling Azure, checks the compiler pin,
writes mode-0600 secure parameters into a private mode-0700 temporary directory, runs ARM subscription
validation and then what-if/create, and cleans the directory even on failure. Secret values never enter
CLI arguments; only non-secret deployment outputs are printed after create. What-if uses resource IDs
instead of full property diffs. Azure deployment history is still privileged operational data. Only the
wrapper is supported: running native Bicep/ARM directly bypasses the derived capacity check.

The command provisions the group and foundation from nothing; application rollout is explicit. Inspect
live provider validation failures privately. A failed rollout may still leave billable resources; use
the teardown command after unsuccessful validation too. Names stay stable when the command is repeated;
`expiresAt` is refreshed to the configured window end. Tags do not implement automatic cleanup.

## Optional application rollout and image contract

Build the existing Dockerfiles for `linux/amd64` and publish to a public registry in a separate authorized
release step. Supply **real immutable digests** for `backendImage`, `workerImage` and `frontendImage` in
your untracked configuration, then set `deployApplications=true`. Tags, `latest`, private registries and
embedded registry credentials are unsupported. Publishing images is not part of this IaC command.

The frontend image must be built with same-origin API (`RESEARCHHUB_API_BASE_URL=""`),
`RESEARCHHUB_DEPLOYMENT_ENV=cloud` and `RESEARCHHUB_COLLABORATION_ENABLED=false` (existing Dockerfile defaults).
Use the Java 25/Spring Boot 4.1.1 backend and pinned Python 3.13.3 worker image/lockfile from this repository.
No new npm, Maven or Python dependency version is introduced here.

Repeat what-if/deploy. The frontend URL is printed when apps are deployed. Its edge proxies `/api` to
the internal backend, which calls the internal worker. Spring uses the `azure` profile; the deprecated
`application-cloud.yaml` alias already has the equivalent contract, so no duplicate `.yml` is introduced.
DB credentials, worker/metrics credentials and Blob connection strings are Container Apps secrets.
ARM derives the storage key; there is no key output, browser credential or implemented Blob identity adapter.
PostgreSQL tables are created exclusively by the existing Flyway migrations; Hibernate uses `validate`.
The JDBC URL uses `sslmode=verify-full` plus `org.postgresql.ssl.DefaultJavaSSLFactory` so the pinned
Java image's truststore validates the server certificate without requiring a missing `~/.postgresql/root.crt`.
Verify Azure's current CA chain against that image during the live window.
[pgJDBC SSL contract](https://jdbc.postgresql.org/documentation/ssl/).
Spring explicitly allows only the public frontend FQDN as the CORS origin: HTTPS proxy routing uses
the backend's Host header, so relying on Spring's same-origin detection would reject browser writes.
The pinned Caddy 2.11 image rewrites the HTTPS upstream Host for Azure ingress;
[Caddy's HTTPS upstream contract](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Registration, realtime collaboration and scientific execution are disabled. The worker explicitly uses
deterministic model/embedding fixtures; no real-model quality or cloud sandbox claim. This fixture does
not seed hosted accounts or research workspaces. Reuse the existing authorized application/test flows in
a later validation window rather than enabling anonymous registration in this template.

Backend/worker each keep one warm replica. The frontend can scale to zero. Default max 1 + rollout surge
1 with pool 8 + scheduler allowance 2 consumes 20 of the 28 planned connection slots. To test max 2 set
pool 6 (24 planned slots). Validate live `max_connections`, reserved slots, rollout overlap and other
consumers; the wrapper's defaults are conservative assumptions. [Pool contract](../docs/development/persistence.md).

## Live acceptance and teardown

Before claiming a cloud result, record the commit/image digests and sanitized outputs; confirm:

1. ARM validate/what-if/create succeed in a clean fixture and a repeat deployment keeps resource identities.
2. PostgreSQL private connectivity/TLS, `SHOW max_connections`, vector availability and Flyway schema history
   are valid; startup health/readiness succeeds. No Hibernate-created tables.
3. `curl --fail https://<frontend-fqdn>/healthz` and `/actuator/health/readiness` succeed; internal Spring
   routes and worker URLs cannot be reached from the public internet. Inspect internal connectivity from
   a temporary authenticated Container Apps exec session, not a broad database firewall rule.
4. With explicitly prepared authorized fixture accounts: login/CSRF, upload immutable source versions,
   extraction/retrieval and workspace-denial checks succeed. If max 2 is tested, record actual replica
   distribution, shared sessions and global quotas. Local evidence does not substitute for this step.
5. Real AI, realtime and sandbox remain visibly unavailable/fixture-only as documented. A successful
   health probe is not a complete product E2E or cloud security test.

Live checks have **not been run** for this change. Keep redacted results in a dated deployment evidence
directory only after an actual run. Do not retain secret parameters, prompts, research content or keys.

Allocate a short window (default 8h, wrapper maximum 24h), set Cost Management budget alerts and inspect
costs. No budget/expiry tag implements a hard spending cap. PostgreSQL/Blob/logs and VNet-managed networking
may keep charging when app replicas are zero. Do not use stop/start as a substitute for deletion.

```bash
# Destructive: only for this disposable synthetic fixture after retaining redacted evidence.
az group delete --subscription "$AZURE_SUBSCRIPTION_ID" --name rg-rh-dev-student --yes
az group exists --subscription "$AZURE_SUBSCRIPTION_ID" --name rg-rh-dev-student
```

Replace `student` with your configured alias. Group deletion should return `false` on the existence check;
check the Container Apps environment's Azure-managed group/resources are also gone. If deletion fails,
resolve it immediately rather than assuming expiry tags do the work. No real-user erasure guarantee is
provided: [ADR-014](../docs/adr/ADR-014-retention-and-erasure.md) is a proposed product policy.

Incremental deployment does not delete removed resources: switching apps to false leaves prior apps
running. Use full fixture teardown to stop costs. No automatic deployment, scheduled cleanup, production
rollout or paid provider creation runs from CI.

This paragraph concerns the disposable **dev** fixture. Separate manually triggered staging workflows,
OIDC, monitoring and an optional guarded TTL cleanup are now provided in
[the staging runbook](../docs/deployment/azure-staging.md); they do not deploy production or prove a live release.
