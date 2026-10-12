# RH-350 / RH-200 / RH-201 validation — 2026-10-12

Scope: four forward-looking ADRs, a Bicep choice ADR, disposable Azure dev IaC, offline deployment/security
contracts, CI integration and README/case-study links. No Java domain logic, production schema, dependency
lock or cloud execution adapter is introduced. The existing `azure` profile already meets the required
runtime seam; `cloud` remains its deprecated alias.

## Results from this working tree

| Check | Result and limitation |
| --- | --- |
| Bicep 0.48.1 compile and lint | All 3 templates passed with no diagnostics; tests inspect emitted ARM, including secure parameters/private ingress and database/TLS/provenance boundaries |
| Infrastructure Node tests | 14 passed; deployment logic 100% lines, branches and functions, with >=80% gates; includes actual CLI validation and redacted failure paths using a private fake Azure CLI |
| CI helper tests | 20 passed; 98% combined statement/branch coverage, >=80% gate; infrastructure path selection and failing compile/config/test subprocesses propagate to the required job |
| Java 25 / Maven `verify` | BUILD SUCCESS; 1303 tests, 0 failures, 0 errors, 27 optional tests skipped; all configured JaCoCo gates passed |
| Relevant profile tests | `CloudProfileStartupTests`: 37 passed; `AzureProfileStartupIntegrationTest`: 1 passed with real Testcontainers PostgreSQL/Azurite; these are local profile tests |
| Azure Blob adapter coverage | 98.65% lines / 88.89% branches; existing >=80% gates passed |
| Cloud provider deployment | Not run; no authenticated Azure CLI/subscription, supplied cloud secrets or image-release digests were available for this task |

Commands from the repository root:

```bash
node infrastructure/scripts/check.mjs
node infrastructure/scripts/deploy.mjs validate
node --test --experimental-test-coverage \
  --test-coverage-include='infrastructure/scripts/deployment.mjs' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  infrastructure/test/*.test.mjs
PYTHONPATH=scripts/ci ai-worker/.venv/bin/python -m coverage run --branch \
  --source=scripts/ci --omit='*/test_*' --data-file=/tmp/researchhub-ci.coverage \
  -m unittest discover -s scripts/ci -p 'test_*.py'
ai-worker/.venv/bin/python -m coverage report --data-file=/tmp/researchhub-ci.coverage --fail-under=80
(cd backend && ./mvnw --batch-mode --no-transfer-progress verify)
```

The Bicep CLI may be supplied through `BICEP_BIN` instead of Azure CLI. Compilation/ARM-contract tests
require the pinned compiler, not cloud credentials. Bicep declarations and ADR prose have no executable
line-coverage metric; coverage numbers apply to the deployment logic and existing runtime modules.

## Remaining live acceptance boundary

The [runbook](../../infrastructure/README.md) supplies clean-group/repeat-deployment commands, synthetic
smoke checks and teardown. A real window must verify region/SKU/extension availability, Azure TLS and
ingress behavior, Flyway, private service routing, authorized product flows and measured connection limits.
Offline tests and local profile tests cannot prove those. Cloud costs are controlled by explicit lifecycle,
bounded resources and operator teardown, not an automatic budget stop/expiry controller.

The production reference, distributed room coordination, erasure lifecycle and Azure sandbox stay designs.
Their implementation triggers and tests are documented in [ADR-010](../adr/ADR-010-deployment-topology.md),
[ADR-013](../adr/ADR-013-collaboration-scale-out.md), [ADR-014](../adr/ADR-014-retention-and-erasure.md) and
[ADR-015](../adr/ADR-015-azure-sandbox-runner.md). The earlier contextual Canvas ADR was renumbered to
ADR-016 without changing its implementation scope.
