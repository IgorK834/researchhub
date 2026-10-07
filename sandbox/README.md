# Scientific sandbox (RH-143–RH-145)

The governing security decision is [RH-142 / ADR-008](../docs/adr/ADR-008-analysis-execution-boundary.md),
with an explicit [threat model](../docs/security/analysis-execution-threat-model.md) and committed review.
Before executor work or generated-code tests, run `python3 scripts/security/check_analysis_boundary.py`
from the repository root. The real Docker acceptance harness also enforces this prerequisite.
See [current validation](../docs/development/analysis-security-validation.md) for evidence and local/cloud limits.

This image is the only place generated analysis Python executes. Spring authorizes and persists requests, plans,
execution attempts and results; the AI worker produces code without running it. A validated plan does not prove that
its code is safe. The trusted Java runner independently enforces the execution boundary.

## Build and enable

```bash
docker build -t researchhub-sandbox:1.1.1 sandbox
```

The base is Python **3.13.3**, pinned to an image digest in `Dockerfile`. Initial libraries are pandas **2.2.3**,
NumPy **2.2.4**, SciPy **1.15.2**, matplotlib **3.10.1** and openpyxl **3.1.5**; every transitive dependency is pinned
in `requirements.lock`. Installation happens only during image build, from binary wheels, and pip is removed.
Add packages through a reviewed lock/image change. There is no runtime install endpoint or prompt-controlled package
list. The image declares runtime version **1.1.1**.

After building, enable the backend's local adapter with `ANALYSIS_SANDBOX_ENABLED=true`. The fixed image tag cannot
be supplied by a request. The adapter resolves it to a `sha256:` image ID and launches that exact ID with automatic
pulling disabled. Both the configured tag and resolved ID are recorded with execution evidence. The local adapter
uses a local Linux Docker daemon (including Docker Desktop) and its `local` volume driver's tmpfs support.

| Backend environment variable | Default and range |
| --- | --- |
| `ANALYSIS_SANDBOX_ENABLED` | `false`; explicit local opt-in |
| `ANALYSIS_SANDBOX_SOCKET_PATH` | `/var/run/docker.sock`; absolute local Unix socket path |
| `ANALYSIS_SANDBOX_TIMEOUT` | `PT45S`; positive, at most `PT2M` |
| `ANALYSIS_SANDBOX_MEMORY_MIB` | `256`; 64–512 MiB |
| `ANALYSIS_SANDBOX_CPUS` | `1`; positive, at most 2 |
| `ANALYSIS_SANDBOX_PIDS` | `64`; 8–128 |
| `ANALYSIS_EXECUTION_DISPATCHER_ENABLED` | `true`; disable scheduled dispatch for manual tests |
| `ANALYSIS_EXECUTION_FIXED_DELAY` | `PT1S` |

Docker Desktop may use `/Users/<user>/.docker/run/docker.sock`. This socket is accessed only by the trusted host
adapter; it is never mounted in the sandbox or AI worker. Cloud execution infrastructure is not introduced here.

## Controlled execution

The entrypoint accepts no free-form arguments. It reads exactly `/execution/manifest.json` and
`/execution/code.py`. The manifest identifies 1–5 immutable versions, exact canonical `/inputs/<UUID>.csv|xlsx`
paths, SHA-256 hashes and the plan's named output kinds. Java constructs this data after server authorization.
See [execution v1](../contracts/analysis/execution/v1/README.md) for complete manifest/result shapes and limits.

The runtime verifies input hashes before starting a separate Python process with isolated import paths and a fixed
environment. Code never receives application secrets. It writes `/outputs/result.json` and declared flat PNG/SVG
files. JSON is strict, finite and bounded; SVG must contain only passive content. Java repeats validation after
collection and persists numeric results separately from model-authored planning summaries.

The runner fixes these controls independently of the generated plan:

* Non-root UID/GID `65532`, fixed `/execution` working directory, read-only root/code/input mounts.
* No networking, host namespaces, Docker socket, extra host directories or application environment.
* All Linux capabilities dropped; `no-new-privileges`; bounded CPU/memory with swap disabled; PID/file descriptor caps.
* Startup-inclusive wall-clock deadline; forced removal terminates background children too.
* Independent 64 KiB stdout/stderr retention; pipes continue draining after truncation; Docker logging is disabled.
* Output hard cap 16 MiB/128 inodes; scratch `/tmp` hard cap 16 MiB/256 inodes; per-result/artifact limits.

Output storage is an **anonymous local tmpfs volume**, removed by `docker rm --force --volumes`. Docker's archive API
omits direct tmpfs mount contents; the local volume keeps hard limits and allows collection while paused. A trusted
idle PID1 keeps the mount alive while the runtime executes through a fixed `docker exec` command. After execution,
the runner freezes every container process, reads a bounded tar stream and removes the container/volume. Tar content
is never extracted onto the host; paths, links, devices, nested directories and path/size overrides are rejected.
Cleanup failure produces `SANDBOX_CLEANUP_FAILED` and no published result; operators can inspect the corresponding
`rh-sandbox-<execution UUID>-...` container on the trusted daemon.

The API bounds staged data to 32 MiB per source and 64 MiB total. Attempts record authorized version/hash selections,
accepted plan/code hashes, actor, time, duration, exit status, bounded logs, runtime/image identity and result hashes.
Retries create new identities and keep earlier evidence. Stale running attempts fail explicitly; they are never
silently re-executed. Full orchestration: [analysis-execution.md](../docs/development/analysis-execution.md).

## Reproducible checks

After the existing AI worker's pinned development environment is installed (`uv sync --frozen` in `ai-worker`):

```bash
cd sandbox
../ai-worker/.venv/bin/python -m pytest
cd ..
ai-worker/.venv/bin/python sandbox/scripts/acceptance.py
cd backend
ANALYSIS_SANDBOX_TESTS=true ./mvnw verify
```

Runtime pytest independently enforces **80% coverage**. The worker's analysis coverage gate and Maven's complete
analysis coverage gate also enforce 80%. The real Docker harness executes attacker examples only inside constrained
containers. It checks an actual test secret outside all mounts, stripped secrets, network isolation, non-root/read-only
operation, CSV and XLSX U/I results, mA-to-A conversion, chart bytes, nonzero exit, invalid numeric cells/results,
symlinks, undeclared output, disk/memory/PID exhaustion, infinite loop, log flood and cleanup. Java runner integration
tests additionally verify independent log caps and a healthy subsequent execution after failures.

`SourceExtractionEndToEndTest` covers authenticated upload → real worker inspection/planning → durable queue → real
sandbox → PostgreSQL result/attempt persistence → authorized chart download. It verifies original-version execution
after a source replacement, explicit repeat attempts, and all XLSX rows beyond the limited inspection. These E2E
tests require the fixed image to be built first. Container tests that cannot run do not establish isolation.
