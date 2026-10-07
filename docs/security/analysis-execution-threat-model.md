# Untrusted analysis execution threat model — RH-142

Date: 2026-10-07. Decision: [ADR-008](../adr/ADR-008-analysis-execution-boundary.md).
Scope: existing local `analysis/`, worker planning, scientific `sandbox/`, execution/artifact contracts,
server configuration and immutable persistence. Cloud is a mapping with a deployment gate, not an implementation.

## Assets, adversaries and boundaries

Protect host/service secrets and files, Docker control plane, workspace isolation, source integrity,
service availability, execution history and the safety of published artifacts. The adversary can control
an authorized prompt, uploaded dataset/header/cell, model-generated code, child processes, logs and output
files. Assume arbitrary Python and native-library behavior; do not assume the plan honestly describes code.
An unauthorized caller can also probe workspace/resource IDs and retry or flood requests.

Trust Spring's authentication/authorization, source-version selection, host adapter, daemon/kernel and
reviewed image. The AI worker may hold model-provider credentials but must never run generated code.
The execution container has a separate trust boundary: no application credentials or service channel.
All returned bytes cross back as hostile data and are validated by Java before publication.

1. Browser → Spring: session, CSRF, active workspace capability, foreign resource concealment and quotas.
2. Spring → AI worker → Spring: bounded authenticated planning contract; code remains inert/untrusted.
3. Spring → Docker: fixed argument list, local socket, selected immutable bytes, no inherited credentials.
4. Container → collector: freeze children, bounded archive, no host extraction, independent result validation.
5. Collector → storage/API/report: reauthorize, append-only records, restricted artifact serving and explicit insertion.

Dataset confidentiality ends at the selected **file version**, not the selected cells: mounted files are
fully readable. Authorized users may see data they selected via valid results/logs. No-network execution
does not prevent a program from encoding those selected bytes in outputs to that same authorized workspace.
Fine-grained redaction, scientific correctness, compromised administrators and kernel zero-days are not
claimed guarantees. Their implications remain in the residual-risk section.

## Threat and test matrix

| ID / threat | Attack and impact | Enforced control | Evidence to run / inspect |
| --- | --- | --- | --- |
| T1 Host files/secrets | Read home, `/proc`, environment, cloud tokens or neighboring input data | Only dedicated read-only code/input mounts; private process namespace, non-root, fixed child/CLI environment, no credential/socket mounts | `DockerSandboxRunnerTest.launchesOnlyTrustedImmutableImageAndCollectsBeforeCleanup`, integration `exactImmutableInputMountReadOnlyNoSecretsAndNetworking`; acceptance host secret outside mounts and injected secret stripping |
| T2 Network exfiltration | HTTP/DNS/metadata/service calls, listeners or Docker VM host channels | `--network none`, no ports/service network/host sockets, default seccomp on a supported maintained daemon; deployment-specific virtual-socket checks required | Runner integration and acceptance TCP failure; control-plane/metadata/VSOCK/DNS parity checks required before cloud approval |
| T3 CPU/memory/time exhaustion | Infinite loop, allocate memory, decompression or native BLAS work | Fixed CPU/memory+swap, startup/collection deadline, bounded scientific threads, force-remove container | `SandboxPropertiesTest`, runner timeout tests; integration `loopTimeoutAndMemoryLimitDoNotPoisonTheNextRun`; acceptance memory/loop checks |
| T4 Fork/process bombs | Spawn children/threads, background process survives main program | cgroup PID limit includes threads, descriptor cap, pause all processes for collection, force-remove whole container | Runner flag test; acceptance process/PID exhaustion; integration healthy run after failures |
| T5 Huge output | Fill disk/inodes, flood both logs, huge JSON/tar/table | Hard output/scratch tmpfs caps; disabled Docker logs; independent draining log retention; bounded archive/JSON/cells/artifacts | `SandboxOutputArchiveTest`, `ExecutionOutputValidatorTest`, runtime `test_protocol.py`; integration `stdoutAndStderrAreCappedAndDrained`; acceptance disk/log flood |
| T6 Malicious paths | `../`, absolute paths, symlink/hardlink/device, PAX overrides, duplicates, write source | Canonical source UUID paths; read-only mounts; flat regular output files; strict tar reader never extracts | `DockerSandboxRunnerTest`, `SandboxOutputArchiveTest`; runtime protocol path/link tests; integration `nonzeroAndFilesystemEscapesAreControlledFailures` |
| T7 Package installation | Prompt specifies package/command, pip/curl downloads malicious wheel | Server-owned fixed image, exact lock, build-only binary wheels, pip removed, no network, read-only installed packages | `sandbox/Dockerfile`, `requirements.lock`, planning boundary tests and acceptance pip absence; image scanner on reviewed rebuilds |
| T8 Docker/control plane | Mount daemon socket, change launch flags/image, remote Docker context, credential helper | Socket only in trusted host adapter, cleared CLI environment/config, fixed args/image ID and disabled pulls; no request runtime knobs | `DockerSandboxRunnerTest`, `test_computation_planning.py`, runner integration socket absence; inspect `DockerCommands.Local` |
| T9 Cross-execution persistence | Leave files/processes, reuse volume, poison next workspace/runtime | New container/staging/anonymous volume each attempt; read-only runtime; rm force+volumes; no published output after failed cleanup | `cleanupFailureNeverReportsSuccess`, integration healthy subsequent run; acceptance removal assertion; immutable retry/history tests |
| T10 Workspace authorization | Read/run foreign version/artifact, viewer mutation, revoked editor during run | Workspace checks on queue/read/dispatch/publication, immutable version/hash binding, session/CSRF, composite DB keys | `AnalysisApiIntegrationTest`, `ExecutionServiceTest`, real `SourceExtractionEndToEndTest` authorization and historical-version execution |
| T11 Active artifact / parser abuse | SVG script/XXE/external resource, duplicate JSON keys, NaN, table/image bomb | Java validation outside hostile container; passive SVG; bounded finite closed JSON; PNG signature; restricted content headers, SVG as image | `ExecutionOutputValidatorTest`, `SandboxOutputArchiveTest`, runtime protocol tests, authorized artifact API tests |
| T12 Provenance laundering | Claim model narrative is computation, alter code/source/runtime, overwrite old result | Persist actual structured output and hashes separately from model planning; immutable plan/versions/attempts; saved runtime rerun has no fallback | `AnalysisReproductionServiceTest`, API/restart tests and real CSV/XLSX E2E; review V20–V23 and execution contracts |

Test classes referenced above live under `backend/src/test/java/dev/researchhub/analysis/` unless explicitly
named under `source/api/`. Use `rg --files backend/src/test` to locate them. `ExecutionServiceTest` and
`AnalysisReproductionServiceTest` are in the application package; historical records are exercised by
the API/restart suite. The real Docker acceptance harness is supplemental: its own collector/launch differs
from Java, so it cannot replace the real Java runner/API integration tests.

## Required local limits

Use ADR-008's fixed defaults and ranges. Hard writable storage caps, process limits and deadlines are
mandatory even when code produces no result. Bounded archive memory protects the host collector even
if in-container result checks are bypassed. No successful exit or in-container validator is sufficient
to publish a result. Cleanup failure is a failed execution with no files published.

The existing dispatcher runs one synchronous claim per scheduling invocation; DB claims avoid duplicate
attempts. Existing per-user/workspace quotas bound API demand. Neither constitutes a proven global
capacity bound across many backend replicas. Keep the local adapter single-instance; cloud admission
control and aggregate budgets need review before enabling multi-tenant execution.

## Residual risks and acceptance scope

| Risk | Scope / response |
| --- | --- |
| Shared kernel, native packages, daemon compromise | Docker is accepted for explicit local development only. Patch host/daemon/images and retain default seccomp; require stronger isolation or demonstrated parity for production hostile workloads. No protection against a Docker administrator is claimed. |
| Network namespace is not a universal socket filter | Real tests currently cover IP/TCP isolation, not every address family. Maintained seccomp/host controls must also deny host virtual-socket bypasses. Do not claim universal egress confinement from `--network none` alone. |
| PNG decoding / decompression | Validators check signature/byte size, not full decode or dimensions. A small compressed PNG can request substantial browser memory; full decode/pixel-budget validation is a follow-up hardening requirement before public hostile multi-tenant artifact exposure. |
| Abrupt backend/daemon crash | Normal paths remove container/volume; cleanup errors fail closed. A host crash can leave staging/anonymous volumes. Idle PID1 expires after 135 s, but that is not a process/volume janitor guarantee. Inspect/remove orphan `rh-sandbox-*` containers and their attached volumes through the trusted daemon before resuming; never reuse them. Cloud needs tested reconciliation. |
| Read-only host staging cleanup | Host staging contains selected source/code bytes, not application secrets. Cleanup is best effort with restrictive parent permissions. Source confidentiality depends on trusted host access and operator orphan cleanup; do not claim secure erasure. |
| Authorized data encoded into output/logs | Expected exposure is limited to the selected authorized workspace. Validation cannot detect semantic steganography or ensure code uses only declared columns. Do not give a container data it is not allowed to reveal. |
| Incorrect scientific result / nondeterminism | Provenance records the executed bytes; it does not prove numerical validity or bit-identical reruns. Seeds, native versions and input order may affect results. Users inspect outputs and explicitly insert them. |
| Admission across multiple replicas | Per-run bounds do not bound aggregate host load. No multi-instance/cloud production approval until aggregate concurrency and queue/cost limits are demonstrated. |
| Review record authenticity | SHA-256 binds document bytes, not identity/approval. This is a named Codex technical review, not an independent human security sign-off. Maintainer PR review protects changes to the record and CI. |

## Review procedure and acceptance evidence

Review each threat against Java runner/service/archive/output code, worker planning, pinned runtime,
configuration, public contracts and real tests. The reviewer records ACCEPTED_LOCAL only when all local
policy decisions are explicit and residual risks are visible; cloud remains deferred. Record document
hashes and the audited baseline commit. Commit these reviewed policy files before dependent code or
generated-code execution; do not self-reference a future commit hash.

CI rejects missing, uncommitted, rejected or stale review bytes before execution tests. Re-review altered
policy, image capabilities, networking, mounts, resource ceilings, output types or deployment mappings.
Passing unit tests alone does not approve a daemon/deployment. Required runtime evidence: no skipped
Docker tests, successful authorized CSV/XLSX computation and artifact download, hostile resource/path/
network/log cases, cleanup and a healthy fresh attempt after failures. Require >=80% Java analysis,
worker analysis and sandbox runtime coverage. Results belong in
[analysis-security-validation.md](../development/analysis-security-validation.md), separately from the
reviewed normative policy, so test runs do not silently change accepted policy bytes.
