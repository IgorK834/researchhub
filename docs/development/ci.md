# Build, test and security CI — RH-342

`ResearchHub CI` (`.github/workflows/ci.yml`) owns builds, component tests, coverage and static
validation. `ResearchHub security regression` (`.github/workflows/security.yml`) owns browser
and prompt-injection regressions and calls `repository-security.yml` for secret, dependency and
container scans. The repository scan workflow is reusable; it has no independent event triggers.
Both entry workflows use commit-SHA action pins, read-only repository permissions and separate
concurrency groups that cancel superseded runs for the same pull request or branch.

## Required branch protection checks

Configure these **exact check names** as required for `main` (and `master` if used), with GitHub
Actions as the expected source:

| Required check | Workflow | What it requires |
| --- | --- | --- |
| `CI required` | ResearchHub CI | Path selection succeeds and every applicable build, test and validation job succeeds |
| `Security required` | ResearchHub security regression | Path selection, repository scanning and applicable browser/prompt-injection regressions succeed |

Replace the previous standalone `security` / `repository-security` requirements with these
aggregate checks. Do not require individual conditional jobs: a legitimate path-based skip must
not prevent a documentation pull request from merging. Both aggregates run with `always()` and
fail on failed or cancelled prerequisites; a skipped path-selection job also fails the aggregate.
Workflow YAML documents this policy but does not change GitHub branch protection settings.

## Job selection

The shared, tested policy in `scripts/ci/check.py` compares pull-request head and base SHAs using
a full-history Git merge-base diff. It includes deletions and both sides of renames and has no
300-file API limit. Markdown changes anywhere select `docs` and skip component jobs. Changes to
other documentation assets also select `docs` to catch broken image links.

| CI job | Pull-request paths | Validation |
| --- | --- | --- |
| `backend` | `backend/`, worker, collaboration, sandbox, contracts, `compose.yaml`, `.env.example` | Temurin JDK 25, Maven cache, `./mvnw verify`; runner Docker supplies Testcontainers and the sandbox image; prepare the frozen worker environment and collaboration build for existing E2E tests |
| `frontend` | `frontend/`, contracts | `npm ci`, typecheck, lint, `test:coverage`, cloud production Webpack build |
| `ai-worker` | `ai-worker/`, contracts | `uv sync --frozen`, `scripts/check.sh`, wheel build |
| `collaboration` | `collaboration/`, contracts | `npm ci`, build, tests with coverage |
| `sandbox` | `sandbox/`, worker Python manifest/lock | Image build, runtime pytest with coverage, constrained Docker acceptance tests |
| `infra` | `infra/azure/`, when that directory exists | Azure CLI `az bicep build` and `lint` for every recursive `.bicep`; `build-params` for `.bicepparam`; Bicep 0.48.1; no Azure login or deployment |
| `performance` | `performance/k6/`, `infra/demo/`, `scripts/demo/` | k6 2.3.0 `inspect` for every script; Node tests with 80% configuration-helper coverage |
| `containers` | Backend/frontend/sandbox or performance selection | Build all four pinned non-root images; static-hosting checks; public-REST real sandbox seed; shared-session/failover/quota proof; two-minute 5-VU smoke and resource evidence |
| `scripts` | `scripts/`, `ai-worker/scripts/` | ShellCheck for tracked shell scripts, including extensionless scripts; CI helper tests with branch coverage of at least 80% |
| `docs` | Markdown files and `docs/` assets | Lychee 0.24.2 offline Markdown link check across the repository; validates local files/images, without depending on external sites |

Changes to `.github/` or `scripts/ci/` select all available jobs. Pushes to `main`/`master` and
manual runs also select all available jobs, so the default branch verifies the entire repository.
Missing optional Azure infrastructure skips its job. Compiler, linter and inspector failures propagate to
their job and the required aggregate. Bicep uses each template's linter configuration; default
warning-level diagnostics remain warnings, while error diagnostics fail.

The backend and sandbox jobs require the committed RH-142 analysis security boundary before
computation tests, using `scripts/security/check_analysis_boundary.py` from the prerequisite work.
The containers job uses the same boundary through the temporary host seed server. It stops that
server before starting two container replicas with the sandbox disabled, then retains sanitized
summary/resource evidence for 14 days. An 80% branch-aware Python coverage gate covers the fixture,
REST seed/client, consistency and report modules using unit tests plus the actual REST/topology run.

Secret and tracked-file hygiene checks run on every pull request, including documentation-only
changes. Dependency scans run for changed Maven/npm/Python inventories, scanner policy changes,
or full runs. Container scans retain the existing opt-in policy: manually run the security
workflow with `scan_containers=true`. Browser/model-safety
regressions run for application and contract changes. A weekly security run on the default branch
retains the existing Monday 06:23 UTC schedule and runs secret/dependency scans and regressions. Scanner severities,
redaction and retained reports follow [repository-security.md](repository-security.md).

For a documentation-only pull request, the heavy build/test, dependency and image jobs are
skipped, while `docs`, path-selection policy tests, secret/hygiene scanning and both required
aggregate checks run.

## Local verification

```bash
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
uv sync --project ai-worker --frozen
uv run --project ai-worker --frozen python -m coverage run --branch --source=scripts/ci --omit='*/test_*' --data-file=/tmp/researchhub-ci.coverage -m unittest discover -s scripts/ci -p 'test_*.py'
uv run --project ai-worker --frozen python -m coverage report --data-file=/tmp/researchhub-ci.coverage --fail-under=80
python3 scripts/ci/check.py infra        # requires az and the pinned Bicep version
python3 scripts/ci/check.py performance  # requires the pinned k6 version
python3 scripts/ci/check.py scripts      # requires shellcheck
lychee --offline --no-progress './**/*.md'
```

Existing Maven, Jest, worker pytest and collaboration coverage thresholds remain in their
component configurations. The new CI helper independently enforces 80% coverage. For a negative
CI check, add an invalid `.bicep` in `infra/azure/` or an invalid `.js` in `performance/k6/` on a
throwaway branch: the corresponding validator and `CI required` must fail. These checks validate
syntax and configuration; `k6 inspect` does not establish application performance.
