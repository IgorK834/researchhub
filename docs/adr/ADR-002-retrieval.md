# ADR-002: one PostgreSQL retrieval adapter first

Status: accepted, 2026-09-30. Scope: RH-102–RH-105.

## Decision

Use PostgreSQL 17 + pgvector 0.8.2 for local development and the first retrieval-capable cloud deployment. The current Spring `cloud` profile remains
the repository's environment-validation scaffold; product routes run under `local` in
this change. Azure embeddings can be selected there without enabling new cloud infrastructure.
Implement one application-level `RetrievalIndex` port. Azure AI Search is deferred until
measured quality/scale or an Azure portfolio demonstration justifies a second adapter.
The deterministic embedding provider supports offline development and tests; it is a
token-hashing fake, not a production semantic model. Azure embeddings are selectable in
the Python worker without changing Java retrieval use cases.

| Criterion | PostgreSQL + pgvector | Azure AI Search primary | Dual adapter |
| --- | --- | --- | --- |
| Azure learning | Azure PostgreSQL + embedding deployments | Highest: hybrid index and service lifecycle | Highest, with two lifecycles |
| Offline local work | Yes, Compose and deterministic embeddings | No equivalent local service | Yes via local PostgreSQL |
| Hybrid relevance | PostgreSQL full text + exact cosine + reciprocal rank fusion | Built-in hybrid/BM25, optional reranking | Requires relevance parity testing |
| Workspace filtering | SQL predicate before ranking, authoritative READY join | Mandatory prefilter and active-version publication required | Two security contracts to verify |
| Cost | Existing database; no separate search service | Additional provisioned service | Cloud service plus maintenance cost |
| Complexity | One transaction for extraction/chunks/index | Distributed publication, deletion and reconciliation | Both implementations and failure modes |

For this repository's current size, transactionally publishing searchable chunks and
keeping offline work reproducible outweigh adding a second service. Start with exact
vector search, avoiding approximate-index filtering/recall surprises. Measure latency
and grounded relevance before introducing HNSW, reranking or Azure AI Search.

## Versions and migration

Flyway V14 enables pgvector and adds a disposable search projection. It never fabricates
embeddings for legacy READY sources: explicitly reprocess them. Compose/Testcontainers
use the same pinned pgvector image. Existing PostgreSQL 17 volumes remain usable after
recreating the container with the new image. Cloud PostgreSQL must allow the `vector`
extension before migrations run. Hibernate only validates schema.

Each embedding namespace is the hash of provider, model name, immutable deployment/model
version and dimension. Stored rows include these values through a model foreign key;
dimension checks and scoped SQL prevent cross-model or cross-dimension comparisons.
Changing the provider/model/version/dimension creates a new namespace. Reprocess sources
to replace their active projection; queries in the new namespace exclude old vectors.
This is an explicit rolling rebuild, not a silent conversion. Deployment model upgrades
must be disabled or accompanied by a version configuration change and rebuild.

Chunk/projection replacement commits with extraction and its run journal. Source READY
requires that exact job's complete index. Failed embedding/indexing never publishes READY;
retries replace the complete current set, and chunk deletion removes its projection.
Old processing jobs cannot write over a newer attempt. Search always joins authoritative
source READY state and current extraction/chunk job identities.

## Testing and future adapter migration

Unit tests exercise deterministic/query embeddings, batching, malformed responses and
bounded transient-only retries. Real Python HTTP + PostgreSQL + authenticated API tests
seed two workspaces, validate source filters, PDF provenance, rebuilds, failure rollback
and publication. Python retrieval and Java AI/source/processing have separate >=80% gates.

A future Azure adapter must pass the same workspace/source/version isolation and rebuild
contract tests. Build a versioned index, upload complete source versions, then publish an
authoritative active-version pointer; fail closed while publication/deletion is incomplete.
Backfill from stored extraction with a new embedding namespace, compare a fixed query set
and latency/cost, then switch configuration. Keep PostgreSQL as rollback until validated.
Do not dual-write without this follow-up ADR. Usage/cost telemetry remains a later task.

References: [pgvector](https://github.com/pgvector/pgvector),
[Azure hybrid search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview),
[Azure embeddings REST contract](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/embeddings).
