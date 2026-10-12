# ResearchHub case study: evidence and architectural limits

ResearchHub is a collaborative research workspace: source-grounded writing and analysis keep references
to immutable inputs and executions. Spring is a modular monolith; Python owns AI/data/scientific work
outside the Java domain. React/TypeScript is built with Webpack/Babel and pinned npm lockfiles.
Workspace authorization is enforced by the server, including internal service calls.

## What is built and what is verified

| Area | Implementation / evidence | Boundary |
| --- | --- | --- |
| Durable shared state | PostgreSQL sessions, quotas and job dispatch; [ADR-009](adr/ADR-009-shared-session-and-quota-state.md), [ADR-011](adr/ADR-011-durable-processing-in-postgresql.md) | No Redis or Service Bus dependency |
| Source provenance | Immutable source versions, pgvector and references to derived outputs; [ADR-005](adr/ADR-005-immutable-source-versions.md) | No complete retention/erasure workflow |
| Collaboration | Yjs/Hocuspocus with authorized Spring persistence; [ADR-007](adr/ADR-007-realtime-document-authoring.md) | One logical room writer; no distributed coordination |
| Local execution | Pinned Docker scientific sandbox; [ADR-008](adr/ADR-008-analysis-execution-boundary.md) | Local isolation evidence does not prove Azure isolation |
| Scaling evidence | [Recorded local two-instance tests](../performance/results/2026-10-08-local-two-instance/README.md) and [dispatcher concurrency](architecture/dispatcher-concurrency.md) | Synthetic local topology; no Azure throughput/SLA claim |
| Azure runtime seam | Azure/cloud profiles, tested persistence settings and Blob SDK adapter; [configuration](development/configuration.md) | Local Testcontainers, not live Azure validation; Blob managed identity is absent |
| Azure infrastructure | [Bicep modules, dev configuration, deployment wrapper and offline contracts](../infrastructure/README.md) | No subscription deployment or hosted product release has been recorded |

## Deliberate decisions and deferred work (RH-350)

- [ADR-010 — deployment topology](adr/ADR-010-deployment-topology.md) (Accepted): cost-optimized demo,
  ephemeral Azure validation and a production reference, with resource cost classification and explicit evidence boundaries.
- [ADR-013 — collaboration scale-out](adr/ADR-013-collaboration-scale-out.md) (Proposed): distributed room
  leases, document/epoch/update idempotency and hash partitioning; preserve persistence before broadcast,
  CAS, durable acknowledgement, revocation and state replacement if Redis fan-out is ever added.
- [ADR-014 — retention and erasure](adr/ADR-014-retention-and-erasure.md) (Proposed): tombstones,
  pseudonymisation, blob/derived-copy erasure and bounded retention alongside append-only provenance;
  design input for Task 30.7, with no implemented erasure promise.
- [ADR-015 — Azure sandbox runner](adr/ADR-015-azure-sandbox-runner.md) (Proposed): conditional Jobs and
  Dynamic Sessions mapping to the existing port; no Azure execution until isolation and cleanup are proved.

Each ADR names the implementation trigger. [ADR-017 — Bicep](adr/ADR-017-azure-infrastructure-as-code.md)
records RH-201's tool choice and reproducibility contract. The earlier Canvas AI ADR moved from number
013 to [ADR-016](adr/ADR-016-contextual-canvas-ai.md) to give collaboration its requested unique identity.
Local build/test results and their limits: [RH-350 / RH-200 / RH-201 validation](development/azure-architecture-validation.md).

## Portfolio release boundary

The local demo and archived test reports can be presented with their fixture/date limitations. Azure
can be described as an **infrastructure-as-code design with offline validation**. The production diagram
is a reference. Cloud deployment, managed failover, production availability, distributed room writers,
user erasure and isolated Azure execution require their own recorded implementation/test evidence.

Use the [Azure runbook](../infrastructure/README.md) for a short synthetic validation window. Preserve
credit by omitting Search, OCR, Service Bus, model deployments and sandbox compute from dev; destroy
the fixture afterwards. Do not publish a recruiter-facing cloud-success claim until the runbook's live
checks have actually passed. The remaining items are intentional scope boundaries, not hidden features.
