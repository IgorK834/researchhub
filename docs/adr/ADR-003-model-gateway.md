# ADR-003: Central structured model gateway

Status: Accepted (RH-110).

ResearchHub needs a shared model boundary for future source questions and AI writing. Vendor
clients scattered through use cases would make replacement, safe errors and provenance inconsistent.

Keep Spring as the modular monolith. `ai.application.ModelGateway` composes workspace authorization,
versioned feature templates, current retrieval evidence and bounded call audit. Its `ModelProvider`
port has an internal HTTP adapter. The Python `ai.providers.ModelGateway` validates all generation
results and applies bounded transient retry around its provider protocol. Vendor wire formats live
only in `FoundryModelProvider`; no model receives product storage capabilities or executable tools.

Ship an explicitly identified deterministic extractive fixture for offline testing and a selectable
Foundry Azure OpenAI v1 adapter with strict JSON output. Use the pinned runtime's HTTP library;
no new SDK/dependency is needed. Worker provider configuration selects the adapter without changing
product use cases, retrieval or frontend contracts. Streaming is deferred and reported as false.

Spring owns `grounded-response:1`, its hash and parameters. The result records model/provider/version,
provider request identity, usage and validated citations. Spring builds source provenance. Invalid
schema/identity/citations, refusals and incomplete/tool output fail closed. Traceability validation
does not prove semantic entailment; model evaluation and human review remain necessary.

Flyway V15 creates workspace-owned `ai_generation_runs`. Input instructions are hashed; successful
outputs and provenance snapshots are persisted before returning success. A failed call records a
safe code. Preview generation uses VIEW_CONTENT and may be used by a viewer; document mutations
remain guarded by EDIT_CONTENT in that module. Membership/context are rechecked after inference.

Migration/testing: apply V15 before the gateway with Hibernate validation only; no index migration
or backfill. Previously ingested sources must have indexed READY chunks from RH-105. Template changes
add a new version/resource/fixtures; deployment changes pin expected model name and revision together.
Historical successful responses remain immutable. Java/Python share canonical fixtures, Foundry
requests/errors use a stubbed opener, and E2E tests use PDF ingestion, the real Python fake, sessions,
two workspaces and PostgreSQL audit. Separate gateway/worker-AI/frontend-AI coverage gates require 80%.

This adds no search service, agent execution, conversation history or AI writing workflow. The cloud
Spring profile remains the existing deployment scaffold; current use cases can select a cloud model
through worker configuration.

Primary protocol references: [Foundry Azure OpenAI v1](https://learn.microsoft.com/en-us/azure/foundry/openai/latest),
[structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).

RH-111 extends this boundary with application-owned deterministic context packing and a v2 internal
request. Budget reservation and source metadata remain server-owned; Python validates prepared
context and translates local model citation keys back to chunk IDs. No provider/tokenizer dependency
enters Java domain logic. Compatibility and policy: [grounded-context.md](../development/grounded-context.md).

RH-112 composes workspace-scoped retrieval with this gateway for a single source question. A
server-owned `workspace-question:1` template and feature parameters share the same context/provider
port; the audit records the actual feature identity. No-hit questions return explicit insufficiency
without inference. Selected-source validation precedes both scoped index presence and embedding;
every published citation must belong to the retrieved context. No schema/runtime dependency or
conversation history is added. Contract/testing: [workspace-questions.md](../development/workspace-questions.md).
