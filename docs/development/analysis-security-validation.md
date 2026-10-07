# RH-142 security boundary: review and validation

Date: 2026-10-07 (Europe/Warsaw). Governing decision:
[ADR-008](../adr/ADR-008-analysis-execution-boundary.md),
[threat model](../security/analysis-execution-threat-model.md),
[hash-bound technical review](../security/analysis-execution-review.json).

## Scope and sequencing

Task 14.2 / RH-141 was already implemented. The repository also already contained RH-143–145
execution without a dedicated security ADR. That historical sequencing gap is recorded explicitly;
this work does not claim to undo it. No executor or generated-code implementation was added during
the RH-142 review. The reviewed policy was committed in `bdbeada` before this task ran generated-code
tests or added the prerequisite check.

The review was performed by Codex against the repository, public contracts, configuration and existing
tests. It is a technical self-review, not independent human security approval. Normal maintainer PR
review remains applicable. The record's SHA-256 values bind the exact accepted ADR/threat-model bytes;
the baseline identifies the inherited implementation audited, rather than self-referencing a future commit.

`scripts/security/check_analysis_boundary.py` rejects absent, untracked/uncommitted, modified, rejected
or stale policy/review files. It also requires the audited baseline to be an ancestor of HEAD. Run it
before execution work. It neither imports generated source nor needs application credentials. The
real Docker acceptance harness runs it before any fixture execution. The dedicated
`.github/workflows/analysis-security.yml` runs it before runtime tests, builds the pinned worker/image,
and checks actual Docker, Java E2E and >=80% coverage. Git hashes do not authenticate reviewers or
prove when implementation started; changes to review records and workflow guards need maintainer review.
External branch-protection settings are not modified by repository YAML.

The existing main/security CI workflows were being changed concurrently in this shared workspace;
RH-142 uses its own workflow and preserves those independent changes.

## Design-reference analysis

All 15 PDFs were inventoried and their text extracted for review alongside `DESIGN_SPEC.md`.
The relevant analysis/results/roles pages were read in full; the running-analysis screen was also
rendered and inspected. `Analysis_studio.pdf` pp.2–4, `Results,provenance&insert.pdf` pp.1–3,
`Key_user_flows.pdf` p.2 and the design system's role matrix/screens 33–37 require isolated execution,
unchanged originals, safe user-facing failures, exact code/data/run provenance and explicit reruns/insertion.
These requirements map to the threat model's workspace, filesystem, output and provenance controls.
No UI redesign, notifications or automatic document mutation is introduced. Sample filenames and
example Python in the PDFs never become trusted launch/path contracts.

## Reproducible local checks

Python **3.13.3**, Java **25.0.2**, Spring Boot **4.1.1**, local Docker Engine **29.4.3**.
Existing reviewed sandbox **1.1.1**, resolved image:
`sha256:e31d9501a7779be287b4c7d854128c01f465971196d4c2d51704ab63be5b1f51`.
The scientific versions/locks and base-image digest are unchanged.

```bash
python3 scripts/security/check_analysis_boundary.py
mkdir -p security-reports
ai-worker/.venv/bin/python -m coverage run --branch --source=scripts/security --omit='*/test_*,*/check.py' --data-file=security-reports/.coverage-analysis-boundary -m unittest discover -s scripts/security -p test_analysis_boundary.py
ai-worker/.venv/bin/python -m coverage report --data-file=security-reports/.coverage-analysis-boundary --fail-under=80
cd ai-worker
.venv/bin/python -m pytest
.venv/bin/python -m coverage report --include='src/researchhub_worker/analysis/*' --fail-under=80
cd ../sandbox
../ai-worker/.venv/bin/python -m pytest
cd ..
ai-worker/.venv/bin/python sandbox/scripts/acceptance.py
cd backend
ANALYSIS_SANDBOX_TESTS=true ./mvnw --batch-mode --no-transfer-progress verify
```

Install the worker's pinned environment first with `uv sync --frozen`; CI uses uv **0.12.20**.
Docker Desktop on this host needs `DOCKER_HOST=unix:///Users/igor/.docker/run/docker.sock` and
`ANALYSIS_SANDBOX_SOCKET_PATH=/Users/igor/.docker/run/docker.sock` for Maven; substitute the local
socket path on another host. The fixed image must already be built. The execution runner remains
disabled by default in application configuration.

| Check | Result |
| --- | --- |
| Committed-policy gate | Passed against `bdbeada`; 8 tests with real temporary Git repositories, 97% statement/branch coverage |
| Full worker tests | 407 passed; total statement/branch coverage 97.12%; analysis module 99% |
| Sandbox protocol/runtime tests | 81 passed; statement/branch coverage 98.35% |
| Real Docker acceptance | 16 PASS checks: host secret/env/socket separation, read-only/non-root, TCP/IPv6/metadata/DNS/VSOCK isolation, fresh scratch/output, CSV/XLSX computation and PNG, malformed/nonfinite output, symlink/undeclared files, disk/inode/memory/PID/log limits, timeout and cleanup |
| Full Maven `verify` / backend JAR | BUILD SUCCESS in 3 min 40 s; 897 tests discovered, 890 passed, 7 unrelated opt-in tests skipped; zero failures/errors |
| Java analysis module | 99.12% line coverage (1,242 covered / 11 missed), 83.23% branch coverage (928 covered / 187 missed); enforced 80% line gate passed |
| Actual Java Docker runner | All 4 integration tests passed, zero skipped; startup/timeout/limits/log draining/cleanup and a healthy next execution verified |
| Actual computation API E2E | CSV historical-version/retry and XLSX full-row/unit-conversion tests passed in `SourceExtractionEndToEndTest`; zero computation/container tests skipped |
| Workflow static checks | YAML parsed; all actions pinned by 40-character commit; read-only GitHub permissions, full history and prerequisite step before execution verified |

The first restricted worker test invocation could not bind two local HTTP test servers; rerunning with
local networking available passed all 407 tests. This was a tool sandbox restriction, not a product failure.
Generated/attacker Python was executed only in constrained Docker containers.
Six skipped tests require browser-specific opt-in flags for unrelated frontend/security/source-library/
diagnostics/realtime/export flows; one requires a LaTeX compiler. This backend/runtime validation did not run browser QA
or claim a GitHub-hosted workflow run; no frontend code changed.

## Limits of the evidence

The new socket/inode/persistence checks supplement the acceptance harness. Its own collector and launch
are different from the product Java adapter, so actual Java runner/API E2E remains required. Existing
Java integration tests exercise authorized upload → worker planning → durable queue → real Docker →
validated persisted result/provenance → authorized chart download, original-version execution after
source replacement, explicit retry history, full XLSX rows, workspace revocation and safe failures.

Local passing tests do not prove every kernel/address-family/parser exploit impossible. In particular,
PNG signature validation has no full decode/pixel budget, normal cleanup is not crash reconciliation,
and a shared-kernel Docker host is not approved for hostile multi-tenant production. Read the threat
model's residual risks before enabling another daemon. The additional tests verify this daemon's
VSOCK and DNS/metadata behavior; cloud controls still need independently deployed parity tests.

Azure Container Apps Jobs is a conditional candidate, not a new runtime/deployment. No cloud resource,
schema migration, service or dependency is introduced. The Docker socket stays in the trusted host
adapter; neither the AI worker nor generated code gains control-plane access.
