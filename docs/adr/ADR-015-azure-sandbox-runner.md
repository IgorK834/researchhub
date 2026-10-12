# ADR-015: Mapping SandboxRunner to an Azure execution boundary

- Status: Proposed
- Date: 2026-10-12
- Backlog: RH-350; prerequisite Task 14.3 / [ADR-008](ADR-008-analysis-execution-boundary.md)
- Implementation trigger: funded Azure execution requirement, plus demonstrated parity with every isolation, provenance and cleanup invariant below. Until then Azure execution remains unavailable.

## Current contract

The public Java port is [SandboxRunner](../../backend/src/main/java/dev/researchhub/analysis/application/SandboxRunner.java).
Only the local/demo Docker adapter is implemented. Azure/cloud uses the unavailable adapter and refuses
enabling the Docker sandbox. There is no Azure adapter, job/session resource, cloud execution benchmark
or proven managed sandbox security. The proposed adapter remains outside core domain logic; Python and
native scientific libraries stay in the pinned sandbox image, with runtime/package locks preserved.

`Request` binds execution/plan IDs, approved code, immutable source-version bytes/hashes and declared
outputs, optionally a previously saved runtime identity. The scientific-problem variant freezes its
problem snapshot/plan/candidate instead of uploaded inputs. `Result` carries success/failure, exit/timeout,
bounded stdout/stderr and truncation flags, image/runtime identity, collected files and code hashes.
Neither browser input nor the model can choose credentials, an arbitrary image or a cloud resource ID.

## Candidate comparison

| Candidate | Fit | Gaps / decision |
| --- | --- | --- |
| Container Apps manually triggered Job | Finite execution, custom digest-pinned image, CPU/memory and replica timeout, no ingress needed | Conditional first experiment, consistent with ADR-008; ordinary Jobs are not proof of hostile-code isolation, PID/filesystem controls or no egress |
| Dynamic Sessions, custom container | Custom scientific runtime and documented Hyper-V isolation; configurable egress | Alternative if all controls can be proved; pool lifecycle, ingress/file transfer, process limits, destruction and standing compute cost need evaluation |
| Dynamic Sessions, built-in code interpreter | Managed interpreter and file APIs | Do not select now: provider-managed package/runtime revisions cannot yet establish the saved runtime contract; APIs and limits still need proof |

Cloud service features are candidates, not a claim that a Jobs manifest can implement `--network none`
or the local Docker flag set. Do not introduce AKS, a general notebook service or a shared runtime to
fill gaps. If neither candidate meets the contract, retain `SANDBOX_UNAVAILABLE` and revisit the boundary
in a separate decision. A custom-session pool can have a different cost lifecycle from on-demand Jobs.

## Required mapping and proof

| Contract/invariant | Jobs mapping to evaluate | Sessions mapping to evaluate | Required acceptance proof |
| --- | --- | --- | --- |
| No network during hostile execution | Isolated environment plus effective deny-all egress; private ingress alone is insufficient | Disable session egress and constrain interpreter access to trusted controller | TCP/UDP/DNS, public/private destinations, link-local metadata and managed endpoints denied; no reachable local transfer helper |
| No secrets | No environment secret, identity, SAS URL or credential accessible to hostile process | Pool/controller auth kept outside allocated interpreter; no execution identity | Inspect env/files/processes/metadata and prove credentials cannot be read; identities used only by trusted control plane |
| Immutable inputs | Trusted pre-stage selected bytes outside hostile execution, verify SHA-256 and expose read-only per execution | Trusted file transfer before execution, validate hash and freeze files | Hash mismatch fails closed; no cross-workspace input, mutable input or shared writable cache; also hash frozen scientific-problem inputs/code |
| CPU/memory/process limits | Resource requests/limits and timeout, separately demonstrate process and child limits | Pool resource configuration plus effective interpreter/OS limits | Baseline 1 CPU, 256 MiB, 64 processes (local configurable limits); process bomb, memory exhaustion and children cannot escape bounds |
| Timeout | Replica timeout plus controller deadline/cancellation and reconciliation | Controller deadline, terminate and destroy allocation; cooldown is not execution timeout | Default local 45-second budget; kill whole workload and confirm no survivor after timeout/controller crash |
| Bounded output | Suppress unbounded platform logs; trusted collector validates artifact names, sizes and hashes | Bounded API/file collection and logs; never trust interpreter metadata | Preserve local 64 KiB stdout/stderr caps with flags, 16 MiB aggregate output cap, declared-output count/type checks and filesystem byte/inode bounds |
| Runtime identity | Approved image digest and pinned Python/package manifest; record actual completed identity | Custom image digest and runtime manifest; reject uncontrolled interpreter revisions | Re-run uses saved server runtime or fails explicitly; retain image/runtime/input/code/result hashes in immutable execution provenance |
| Cleanup, persistence and authorization | Controller owns submission ID, polls, cancels and reconciles Job resources | One allocation per execution; no reuse across workspaces, explicit destroy/reconcile | Reauthorize before dispatch/publication; idempotent request/result handling; do not expose result on cleanup failure |

The trusted adapter may hold Azure control-plane credentials; the untrusted process may not. Download/
upload helpers in the same container with SAS or service tokens are not an acceptable separation.
Define the pre-stage/run/collect/destruct protocol and a narrow transport before implementation. Azure
resource submission success is not analysis success. Lost responses, cancellation and retry must reconcile
the execution ID and durable PostgreSQL record without publishing two results or trusting request runtime IDs.

## Open questions and rollout gate

Open: region/subscription availability, quotas/student credit, current API lifecycle; effective process
limits/read-only mounts/inode caps; whether deny-all networking still allows a safe trusted staging path;
identity exposure across execution phases; signed-URL revocation; image digest and package attestation;
timeout start point, log billing limits, orphan reconciliation and session reuse/destruction semantics.

A follow-up implementation must specify error mapping into the existing result contract (or version it),
configuration defaults off, any additive Flyway migrations, least-privilege controller authorization and
bounded submission/concurrency. Run contract parity tests, the existing local sandbox attack suite and
cloud attacks for egress/metadata/secrets, fork/memory/output floods, corrupted input hashes, cross-workspace
access, stale saved runtime, controller crashes and cleanup failures. >=80% adapter coverage is required,
but unit coverage cannot replace actual cloud adversarial evidence. No resource is provisioned by this ADR.

Sources checked 2026-10-12: [Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs),
[Dynamic Sessions](https://learn.microsoft.com/en-us/azure/container-apps/sessions),
[custom containers](https://learn.microsoft.com/en-us/azure/container-apps/sessions-custom-container),
[network controls](https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration).
