# Grounded context builder (RH-111)

`ai.application.GroundedContextBuilder` packs already-authorized, current READY retrieval chunks
for the [model gateway](model-gateway.md). It performs deterministic data serialization and budget
checks in the application layer; model calls and vendor response handling remain in Python.
It adds no search service, agent/tool capability or product chat workflow.

## Ordering, keys and provenance

The selected references retain their input/retrieval ranking order. Position 1 gets `S1`, position
2 gets `S2`, through `S12`. Given identical ordered chunks, metadata and configuration, the packed
context and its citation mapping are identical. Keys are local to the immutable request; another
ranking/selection can assign different keys. Persist and use the mapping belonging to that response.

Each block has a trusted label followed by one JSON object:

```text
[S1]
{"chunkId":"...","sourceId":"...","title":"Lecture 5","pageStart":38,"pageEnd":38,"sectionTitle":"Energy","processingVersion":"...","spans":[{"unitId":"unit-38","characterStart":0,"characterEnd":70}],"text":"...","textReference":null}
```

Spring resolves source titles through the public, workspace-scoped source service. Page ranges,
sections, processing versions and original unit/character spans come from retrieval provenance.
Source-derived values are JSON-escaped; newlines/quotes cannot create another trusted label or a
message role. The packed text appears only in the user-message data, never in the system message.
`grounded-response:2` explicitly treats source text and metadata as untrusted, ignores instructions
within them, demands local citation keys and exposes no tools/storage. This provides structural
role separation and traceability; semantic grounding still requires model evaluation.

By default, an identical content hash shares the earlier block's exact text via `textReference`.
Each duplicate keeps its own key, source ID, title and location. Near-duplicates, whitespace changes
and different numerical values are preserved; no fuzzy similarity heuristic is used. There is no
silent omission or partial chunk truncation.

The provider returns `citationKeys` such as `["S1"]`, without brackets. Python validates them
against this request's mapping and converts them to the existing public claim `evidenceIds` (chunk
IDs). Unknown, invented, duplicated or malformed keys fail closed. The public response adds a
`context` summary: builder/policy versions, budget, context hash, byte count, token upper bound and
key/chunk/text-reference bindings. The `evidence` snapshots add the source title. They preserve
full source provenance. The React renderer displays `[S1]` with the source title/page and the existing
version-aware source link; historical responses without context/title still render.

## Budgets and overflow

Server-only configuration under `researchhub.ai.features.grounded-response.context`:

| Property / environment variable | Default | Bounds/meaning |
| --- | --- | --- |
| `max-tokens` / `AI_GROUNDED_RESPONSE_CONTEXT_MAX_TOKENS` | 32768 | 64–131072; conservative total reservation including completion tokens. |
| `max-bytes` / `AI_GROUNDED_RESPONSE_CONTEXT_MAX_BYTES` | 24576 | 64–131072; UTF-8 bytes of the packed context, including source metadata/locations. |
| `collapse-exact-duplicates` / `AI_GROUNDED_RESPONSE_CONTEXT_COLLAPSE_EXACT_DUPLICATES` | true | Share exact text while preserving each citation. |

`utf8-conservative-v1` counts UTF-8 bytes of the exact system text and compact JSON user message,
then adds 2048 units for schema/message framing and the configured `maxOutputTokens`. It deliberately
avoids a guessed words-per-token ratio and a vendor-specific tokenizer. This conservative policy is
not an exact model token count; configure the reservation within the selected deployment's supported
window. Actual returned usage remains separate. Quotes, control characters, multibyte text and output
reservation are included before inference. The internal serialized request is also capped at 512 KiB.

If a limit is exceeded, Spring returns `413 AI_CONTEXT_TOO_LARGE` before any provider/metadata call
or audit write. The caller must reduce its selection. The worker independently validates context
hash, framing, key order, content equality, duplicate references, locations and recomputed budget
before inference. All remote retries reuse the same validated context.

## Compatibility and audit

The internal v2 request wraps the unchanged v1 model request and its built context; fixtures and
schema are in [`contracts/ai/v2`](../../contracts/ai/v2/README.md). The worker retains v1 for older
internal clients; current product generation always uses v2 and the default v2 template. The model
result's v1 envelope/claim chunk IDs remain compatible. Public context metadata is additive and null
for historical RH-110 responses.

Flyway V15's existing bounded JSON columns hold the new summary/title and server budget; no relational
schema, runtime or package dependency is added. The audit request hash includes the packed context,
while the persisted response contains its hash/mapping/measurements without the packed prompt text.
Source-derived claims remain workspace-protected. Do not rewrite the old v1 template/fixtures; new
templates and incompatible protocols receive new versions. Deploy a v2-capable worker before the new
backend and keep old successful responses immutable.

## Verification

`./mvnw verify` (run from `backend/`) enforces a separate 80% line coverage gate for context
contracts/configuration/builder, as well as the existing module gates. Tests cover deterministic
mapping, source locations, exact duplicates, differing numerical facts, JSON/injection framing,
UTF-8 and exact budget boundaries, empty context, v1 audit compatibility and canonical Java/Python
fixtures. E2E uses real Python, PostgreSQL and authenticated upload/retrieval/generation; it proves
budget overflow causes no model call and keeps citation mappings/source locations in saved responses.

From `ai-worker/`, `sh scripts/check.sh` enforces 80% separately for context validation and the AI
package after the full suite. Foundry tests prove role separation and local-key translation/rejection
without a cloud call. From `frontend/`, run coverage/build/lint/format checks; the AI feature retains
its 80% gate and tests both legacy and locally keyed, escaped citation rendering.
