# Workspace source questions (RH-112)

The workspace page now offers **Ask workspace sources** to every workspace content reader,
including viewers. This is a single source-grounded question, without conversation history,
external web knowledge or document writes. It composes the existing authorized hybrid retrieval,
[context builder](grounded-context.md) and [model gateway](model-gateway.md).

## Public contract

`POST /api/workspaces/{workspaceId}/ai/questions` requires a signed-in session and CSRF token.
The route is authoritative for workspace identity; clients supply neither chunks nor model settings.
The response uses `Cache-Control: private, no-store`.

```json
{"question":"What is kinetic energy?","selectedSourceIds":["10000000-0000-0000-0000-000000000003"]}
```

Questions must be nonblank and at most 2,000 Java UTF-16 units (the existing retrieval query limit).
Selections contain at most 100 distinct, nonnull UUIDs. Omitted/null selection means all authorized
workspace sources; an empty array explicitly selects none. The source scope validates **every** ID
before querying embeddings. Foreign-workspace, unknown and unauthorized sources return the existing
indistinguishable `404 RESOURCE_NOT_FOUND`; invalid JSON/input returns 400. Uploading, failed or
reprocessing sources may be selected, but only published READY indexed chunks are searchable.

```json
{
  "status":"SUPPORTED",
  "reason":null,
  "answer":"Lecture 2: kinetic energy equals half the mass times velocity squared.",
  "citations":[{"sourceId":"...","chunkId":"...","pageStart":38,"pageEnd":38,"title":"Lecture 5","processingVersion":"...","spans":[]}],
  "generation":{"result":{"requestId":"...","answer":{"status":"SUPPORTED","claims":[]}},"evidence":[],"context":{}}
}
```

This abbreviated example shows the envelope, not a valid complete generation. The canonical complete
fixtures are in [`contracts/ai/questions/v1`](../../contracts/ai/questions/v1/README.md).
`answer` joins the validated factual claims in order. `citations` contains each actually cited chunk
once, in retrieval order, with server-owned workspace/source IDs, title, source/version identity,
page range, section, content hash and character spans. `generation` retains the existing immutable
claim-to-chunk mapping, local citation keys, model/usage metadata and audit request identity. Fetch
that saved generation through the existing workspace-scoped gateway endpoint.

## Evidence and security behavior

Spring authorizes workspace membership, validates selected source ownership, and tests scoped index
presence before any remote query embedding. Both the presence and ranked search queries constrain
workspace/source IDs and READY/current extraction inside SQL. Search uses the configured top-K.
The use case rejects an adapter scope violation rather than filtering a global result set.

If no published chunks exist, an explicit empty selection is supplied, or retrieval yields no hits,
return `INSUFFICIENT_EVIDENCE`, `reason=NO_RETRIEVED_EVIDENCE`, a fixed explanatory answer, empty
citations and `generation=null`. No embedding is requested when the scoped index is empty, and no
model/metadata call or generation audit write occurs on the no-hit path. An unrelated workspace's
indexed sources cannot change this result. If an index/model mismatch yields no hits, rebuild the
index using the configured embedding identity; never mix vector dimensions.

With hits, the shared gateway resolves current chunk versions again, packs escaped untrusted context
under local keys, checks the configured budget before inference, and validates the structured result.
The server-owned `workspace-question:1` template requires only supplied evidence and explicitly
demands `INSUFFICIENT_EVIDENCE` with no claims when the question cannot be answered. This becomes
`reason=INSUFFICIENT_RETRIEVED_EVIDENCE`, a fixed explanatory answer and no citations; its successful
generation/audit is retained. The server never supplies a fabricated answer on error or insufficiency.

Invented citation keys/IDs, changed provenance or a citation outside the retrieved context fail closed
with `AI_OUTPUT_INVALID`. The gateway rechecks membership and source processing versions after the
remote call. Model output cannot supply real source titles, pages or storage access. These checks
prove citation identity and scope; semantic entailment remains a model evaluation concern.

React renders structured claims as escaped text with version-aware source/page links and explicit
no-evidence/insufficiency states. It prevents concurrent submissions, displays safe failures, and
resets local question/results on workspace navigation, including late replies. Source selection is
limited to currently displayed READY sources; the server independently validates every request.

## Configuration and compatibility

Server-only feature configuration lives under `researchhub.ai.features.workspace-question`:

| Property / environment variable | Default | Bounds |
| --- | --- | --- |
| `top-k` / `AI_WORKSPACE_QUESTION_TOP_K` | 6 | 1–12 |
| `temperature` / `AI_WORKSPACE_QUESTION_TEMPERATURE` | 0 | 0–2; `none` omits the parameter |
| `max-output-tokens` / `AI_WORKSPACE_QUESTION_MAX_OUTPUT_TOKENS` | 1024 | 16–8192 |

The existing grounded-response context budget applies to both use cases, including completion
reservation; excessive context returns `413 AI_CONTEXT_TOO_LARGE`. Model/provider selection remains
worker configuration. The Foundry adapter receives the same v2 contextual request and local-key
schema; no provider SDK or question-specific vendor call is added. The deterministic extractive fake
quotes passages with nontrivial lexical overlap and returns insufficiency otherwise. It is an
offline fixture, not a semantic answer engine. Other generation templates keep their fixture behavior.

The question template is an immutable versioned resource with shared Java/Python fixtures. Apply
RH-110's Flyway V15 if not already installed; its bounded JSON audit columns already support questions
and record `feature_id=workspace-question`. No new schema, runtime or package dependency is introduced.
The question text is included in the request hash but never stored as a raw audit instruction.
Existing RH-110/RH-111 endpoints, templates and historical responses remain compatible. As elsewhere
in this repository, product persistence/use cases run on the local profile; cloud Spring deployment
remains the existing scaffold while the worker provider is configurable.

## Verification

From `backend/`, `./mvnw verify` builds the backend and enforces a dedicated >=80% question-module
line coverage gate. Unit tests cover ranking/configuration, source scope, insufficiency, input bounds,
adapter violations, fabricated provenance and shared fixtures. E2E uses PostgreSQL/pgvector, real
Python, deterministic embedding/model adapters and authenticated HTTP: upload/ingest PDF, question,
retrieved-only citations, audit read, two workspaces, cross-workspace rejection before providers,
viewers, nonmembers, CSRF, no sources/unready/reprocessing sources and invented model citations.

From `ai-worker/`, `sh scripts/check.sh` covers the question fake policy, canonical fixtures and
Foundry structured insufficiency using HTTP stubs. No paid cloud call is needed. From `frontend/`,
run `npm run test:coverage`, `npm run build`, `npm run lint` and `npm run format:check`. The AI feature
keeps its >=80% coverage gate and exercises the actual shared client/form/source links and workspace
navigation privacy.
