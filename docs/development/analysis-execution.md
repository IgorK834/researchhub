# Isolated scientific computations (RH-143–RH-145)

Spring owns authorization, immutable source selection, planning validation, durable execution attempts and result
persistence. The AI worker produces a structured plan and untrusted Python; it never executes that Python. A trusted
local adapter launches the scientific sandbox with a fixed policy. This extends the RH-140/141 planning contracts.

The analysis and provenance flows in `design-reference/Analysis_studio.pdf`, `Results,provenance&insert.pdf`,
`Key_user_flows.pdf` and `DESIGN_SPEC.md` inform the lifecycle: original data remain unchanged, results retain the exact
data/code/run chain, and re-running creates history. Document insertion, notifications and additional analysis screens
are outside these backend/runtime tasks.

## Runtime and trust boundary

`sandbox/Dockerfile` pins Python and the initial scientific packages (pandas, NumPy, SciPy, matplotlib and openpyxl).
Package additions require a reviewed image rebuild; neither user prompts nor generated code configure installation.
The image uses a non-root user and fixed working directory. The entrypoint accepts one controlled execution manifest.
Input paths are server-generated source-version UUIDs under `/inputs`; code and the manifest are read-only under
`/execution`. Result files belong under `/outputs`. Temporary scratch space is separately bounded.

The sandbox receives no application environment variables, database credentials, storage URLs, host home directory
or Docker socket. Its root filesystem is read-only, network is disabled, capabilities are dropped and privilege
escalation is disabled. The runner fixes CPU, memory, swap, process count, wall time, output bytes/inodes and captured
stdout/stderr limits. A valid plan is intent and provenance, not evidence that its code is safe.

The trusted adapter resolves the configured versioned image to its content-addressed image ID and launches that ID.
The attempt records the configured image, resolved ID, runtime version, code hash, input version hashes, selected
sheets/columns, requester and timestamps. Rebuilding a tag cannot silently change the identity recorded for a run.

Outputs use a one-use anonymous local tmpfs volume with fixed hard caps, removed with the container. This supports
Docker archive collection while paused, including Docker versions that omit direct tmpfs mounts.
Output collection happens after execution is quiesced. The collector reads bounded bytes instead of extracting
untrusted archives onto the host. Links, devices, nested paths and unexpected files are rejected. Strict result JSON
must match the accepted plan's declared output names and kinds. Tables contain bounded scalar cells and finite
numbers; charts reference collected PNG/SVG files. Model-authored summaries are never substituted for computed tables.
Artifacts are served only through workspace-authorized endpoints with restrictive response headers.

## Execution API and history

Routes extend `/api/workspaces/{workspaceId}/analyses`:

| Method and path | Behavior |
| --- | --- |
| `POST /{analysisId}/execute` | Queue an explicit execution attempt; `202 Accepted` |
| `GET /{analysisId}/executions` | Read persisted execution history |
| `GET /{analysisId}/executions/{executionId}` | Read one attempt, computed result and provenance |
| `GET /{analysisId}/executions/{executionId}/artifacts/{artifactId}` | Download an authorized immutable chart |

Use the existing create and plan endpoints first. An execution takes the persisted accepted plan, not client-supplied
code, paths, container arguments or image names. Mutations require an active workspace and owner/editor permission,
the session and CSRF; viewers may read existing authorized results. Foreign resources and non-members receive `404`.
Authorization and immutable input hashes are checked again during dispatch and before successful publication.

Attempts follow `QUEUED → RUNNING → SUCCEEDED/FAILED`. A duplicate request while a run is queued or running cannot
create concurrent execution for the same analysis. Explicit retries append attempts without replacing previous
results, artifacts or failure evidence. Interrupted runs fail explicitly rather than silently re-executing code.
Planning retries and execution attempts remain separate audit histories.

The local PostgreSQL dispatcher claims jobs transactionally; execution and network calls happen outside the database
transaction. Flyway `V21` owns the execution/artifact schema and lifecycle guards. Hibernate does not create it.

## Local setup

Build the pinned image, then enable the runner in the backend's local environment:

```bash
docker build -t researchhub-sandbox:1.0.0 sandbox
```

Runner configuration and limits are documented in `.env.example`. Execution is opt-in and fails closed when the
runner is disabled or its fixed image cannot be resolved. Staged inputs are limited to 32 MiB per source and 64 MiB
total. Keep the backend on the host for this local adapter; the
host-side trusted runner requires access to the local Docker daemon. Never give that access to generated code or
the AI worker. Existing Compose source processing services continue to operate independently.

The deterministic worker supports a deliberately narrow impedance example with recognized frequency, voltage and
current columns. It reads the actual immutable CSV/XLSX bytes inside the sandbox, computes `Z = U / I`, writes a
result table and generates a chart. Explicit units are respected; assumptions are recorded. Other requests require
a configured model adapter. No numerical response is manufactured from inspection samples.

## Verification

The runtime tests enforce an independent minimum 80% coverage gate. Python analysis tests enforce the existing
80% worker analysis gate; Maven `verify` enforces at least 80% line coverage across the Java analysis module.
Security tests cover invalid manifests/results, path/link handling, bounded logs/output, timeout, safe runtime
failure, immutable history, source-version replacement and workspace authorization/revocation.

The real Docker acceptance suite verifies CSV/XLSX computation, PNG output, a host secret outside the mount,
network isolation, non-root/read-only operation and hostile execution limits. Java API E2E covers a real upload,
the authenticated Python planner, container execution, PostgreSQL persistence and artifact download. Tests requiring
Docker need a running daemon; a skipped container check does not establish isolation. Unit tests additionally
verify passive SVG acceptance and active/external SVG rejection.

See `sandbox/README.md` for reproducible commands and the runtime result/manifest contract.

Verified locally on 2026-10-03 with the pinned image and a running Docker daemon:

- `ANALYSIS_SANDBOX_TESTS=true ./mvnw verify`: 696 tests passed, zero skipped; backend JAR built successfully.
- Full AI worker suite: 356 tests passed; analysis coverage 99% (statements and branches).
- Sandbox runtime suite: 66 tests passed; coverage 97.97% (statements and branches).
- Java analysis coverage: 98.93% of lines and 80.77% of branches.
- Real Docker acceptance suite passed, including network/secret isolation, timeout, memory/process limits,
  bounded output/logs and cleanup. API E2E computed CSV and XLSX results, retained the selected historical source
  version after replacement, persisted explicit retries and downloaded the generated PNG through authorization.
