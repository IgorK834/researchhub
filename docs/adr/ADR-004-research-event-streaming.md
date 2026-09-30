# ADR-004: Research conversation events over SSE

- Status: Accepted
- Date: 2026-09-30
- Tasks: RH-113, RH-114, RH-115

## Context

The document editor needs a source-grounded research panel with durable, attributable answers and
responsive progress. The future collaboration WebSocket has a different lifecycle and is not needed
for one-way answer events. The current provider-neutral gateway validates a synchronous structured
model result; its adapters expose no token-streaming/cancellation port. Raw tokens may contain
unsupported citations or hidden reasoning and must not become saved assistant fragments.

## Decision

Use POST SSE on the authorized Spring conversation API with the existing session and CSRF protection.
React reads it with fetch/AbortSignal through the shared transport. Keep retrieval/model work in the
existing question use case and Python provider boundary; use a transport-neutral progress/checkpoint
observer. Send started and retrieval_completed immediately. Emit answer deltas only after the full
structured result validates and its complete assistant is committed, then send completed with citation
and model provenance. Terminal failures use a safe machine-readable error event.

Store visible user submissions before inference, complete assistants atomically, and protect every
attempt with an idempotent client identity and server lease. On disconnect or timeout, safely abandon
an already-running bounded synchronous call and prevent final publication at checkpoints. Preserve a
complete answer if commit already won the disconnect race. Recheck workspace membership at history
reads, model publication, heartbeat and final event delivery. Bound concurrency and stream lifetime.

## Alternatives and consequences

A collaboration WebSocket would couple research latency/errors to editor collaboration and add a
bidirectional protocol without a present benefit. Polling would lose immediate stage feedback.
EventSource cannot directly carry our POST body and CSRF header. Fetch SSE fits existing authentication
and works without an SDK/runtime dependency.

This first phase improves perceived latency with stage events; it does not stream live provider tokens.
A later provider streaming port must retain the same final validation and atomic history publication,
allow cancellation where supported, and expose only application-visible content. Transcript memory,
chat branches, new message queues and new collaboration infrastructure are outside this decision.

## Migration and testing

Apply additive Flyway V16 after V15; there is no raw-question backfill from hashed generation audits.
Existing stateless question/generation endpoints remain compatible. Roll back UI/API activation while
retaining rows. Shared Java/React contract fixtures fix the message/completion shape. Real authenticated
HTTP/PostgreSQL/PDF tests with deterministic providers prove provenance, workspace isolation, revocation,
retry identity, disconnect/timeout and no partial assistants. Separate conversation/SSE coverage gates
and frontend AI coverage gates require at least 80%. See
[research-conversations.md](../development/research-conversations.md) for API/configuration details.
