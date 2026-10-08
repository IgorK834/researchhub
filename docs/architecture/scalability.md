# Local shared-state scalability evidence

The Spring backend is a modular monolith with stateless request routing and shared durable
PostgreSQL state. Blob bytes are shared through the storage adapter, not a replica filesystem.
Server authorization still scopes every workspace resource; scaling does not change permissions.

The [two-instance topology](../../infra/demo/compose.scale.yaml) uses JDBC sessions, atomic
PostgreSQL quotas, one PostgreSQL database and a deterministic worker. Caddy balances round robin
without a sticky session cookie. Response headers and structured application logs identify each
replica. The sandbox is disabled after a separate real host-backed synthetic seed.

[Repeatable demo and consistency checks](../../scripts/demo/README.md) prove a single login works
across both replicas and survives stopping one, and that a workspace limit admits exactly 60
requests globally rather than 60 per replica. The proof deliberately distinguishes successful
admission from rejected 429 responses and isolates the workspace limit from the per-user cap.

[Load scenarios and interpretation](../../performance/README.md) separate read traffic from
retrieval and exclude uploads, ingestion and generative authoring from the read baseline.
Recorded runs retain endpoint percentiles, error rates, replica distribution, resources and
the exact source/script/compose identities. Results are evidence for this fixture and local
topology; they do not claim Azure throughput or a production SLA.

Each replica uses the existing [connection budget](../development/persistence.md):
`maxReplicas × (poolSize + scheduler headroom) <= 0.8 × max_connections`.
With two replicas, pool eight and headroom two, 20 connections fit the demo's limit of 50, with
additional managed-tier reservation checks documented in persistence. Processing/export/snapshot/
analysis dispatchers share the same pool. A sustained pending-connection gauge and rising request
p95 indicate contention; increasing replica count without a database budget can make it worse.

Architecture decisions: [ADR-009 shared state](../adr/ADR-009-shared-session-and-quota-state.md),
[ADR-011 durable jobs](../adr/ADR-011-durable-processing-in-postgresql.md) and
[ADR-012 export pipeline](../adr/ADR-012-report-export-pipeline.md).
