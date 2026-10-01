# Structured citations and source interpretation (RH-123–125)

RH-123 completes the editor citation entity introduced by authoring. RH-124 and RH-125 add
source comparisons and cautiously worded, AI-assisted interpretation of potential differences.
The existing Spring modular monolith authorizes and validates every operation; the existing
Python worker performs inference. No new service, vendor dependency or runtime is introduced.

## Structured editor references

`researchCitation` is an inline ProseMirror/Tiptap atom, stored in document JSON and history as
`attrs.citation`. A new entity carries `schemaVersion: "1.0"`, stable `citationId`, `workspaceId`,
`sourceId`, nullable `sourceVersionId`, `locator: {pageStart, pageEnd, sectionTitle}`, optional
`chunkId`, `label`, and `displayStyle` (`NUMERIC` or `SOURCE`). Retrieved references also retain
`processingVersion`, `contentHash`, spans and source title. Flat page/section fields remain for
compatibility with existing retrieval citation contracts; the nested locator must agree with them.

Accepted authoring/evidence proposals create entities, never pasted bracket text. Existing legacy
entities still open without rewriting the stored document. Source-level entities may omit the
chunk. Physical historical source versions are not yet published by ingestion, so `sourceVersionId`
currently remains null; processing-version identity and spans preserve the available provenance.
The existing source preview refuses stale processing locations rather than presenting new text
as historical evidence.

A document plugin derives numbering in first-reference order, with repeated entity ids sharing
a number. Deletion, reorder and undo recalculate presentation without mutating identity or
provenance. The selected citation's toolbar offers number or source/location display. Clicking
a citation navigates to the existing authorized source preview with processing version, unit
and page. Saving/reloading retains the metadata and style. Clipboard HTML carries validated
entity metadata; pasted URLs and visible numbers are ignored and rebuilt from the reference. `citationReferences(doc)` exposes the
stable, ordered references for future bibliography formatting; bibliography export itself is deferred.

## Source comparison workflow

On the workspace page, **Compare sources** accepts exactly 2–5 explicit source ids, 1–5 distinct
criteria (up to 64 characters each), and an optional instruction (up to 1000 characters). Defaults:
method, dataset, metric, main result, limitations. Viewer members can use this read-only workflow.
No analysis changes a document, and model settings/templates remain server-owned.

Every selected source is authorized before any retrieval/inference. Retrieval searches each source
independently for two chunks, up to ten total. This prevents a highly ranked source from consuming
all evidence slots. The source list and provenance are checked again after inference. Retrieval
adapter results outside the explicit workspace/source scope fail closed. Only published searchable
chunks are used; sources without matching indexed evidence remain columns with missing cells.

The renderable response has an exact source row/criterion cell shape. `REPORTED` cells contain text
and one or more retrieved chunk ids belonging to that same source. `MISSING` cells contain null text
and no citations. A ready comparison also has a narrative summary, with citations for every statement.
Unknown citations, wrong-source attribution, missing/extra/reordered dimensions, unknown fields and
incorrect result identities are rejected before persistence/rendering. Source excerpts are untrusted
context, not policy. Citations resolve to authoritative titles, versions, pages/sections and spans.
The table explicitly describes retrieved excerpts, without claiming full-paper coverage.

## Potential differences

**Find potential disagreements** uses a stored comparison id as its baseline. It reuses the exact
retrieved evidence of that comparison; changed/deleted evidence requires a fresh comparison.
The optional analysis focus is retained separately as `analysisInstruction`. Findings use only:

- Potential disagreement
- Different reported result
- Different experimental conditions

Every finding has exactly two distinct selected source sides, each with its own statement and
source-scoped citations. `methodologicalContext` is mandatory: reported context needs citations;
unavailable context stays missing and is explicitly flagged in the UI. The versioned model policy
asks for dataset, metric, population, assumptions and experimental-condition differences, and
forbids declaring definitive contradictions. The UI always labels the output AI-assisted interpretation.
No findings means no differences were identified in these excerpts, not proof of agreement.
With evidence from fewer than two sources the result is insufficient and inference is skipped.

## Public and internal contracts

All public routes are session/CSRF protected and scoped under
`/api/workspaces/{workspaceId}/ai/source-analyses`:

| Method/path | Input/output |
| --- | --- |
| POST /comparisons | `Compare {selectedSourceIds, criteria, instruction}` → immutable `Analysis` |
| GET /{id} | Authorized comparison or disagreement result with provenance |
| POST /{id}/disagreements | `FollowUp {instruction}` → `Analysis` linked to a comparison |

`Analysis` contains identity, workspace, creator, kind, parent comparison id, original comparison
command, actual analysis instruction, source descriptors, structured answer, retrieved citations,
warnings, model/template/hash/usage/request provenance, context hash/budget summary and timestamp.
V18 creates `ai_source_analyses`, with a workspace-scoped parent foreign key, bounded JSON and an
immutable trigger. Reads reauthorize all selected sources; an id from another workspace yields 404.

Worker POST `/internal/ai/analyze` requires the existing service credential and accepts the unchanged
v2 context envelope. It uses strict JSON schema, resolves local evidence keys (`S1` etc.) to chunk ids,
and independently validates shape, evidence and identity. Both Foundry transport and bounded transient
retries reuse the existing gateway. The versioned templates are `source-comparison:1` and
`source-disagreements:1`. Shared Java/Python examples are in `contracts/ai/source-analysis/v1/`.

The local `deterministic` provider is an explicitly labelled offline fixture: it extracts only labelled
lines such as `Method: ...` and reports differences between explicit values. It does not infer missing
research facts or perform production scientific assessment. Production inference uses the existing
Foundry configuration; automated tests mock that wire protocol and do not make paid remote calls.

## Limits and verification

| Environment variable | Default |
| --- | --- |
| AI_SOURCE_ANALYSIS_MAX_OUTPUT_TOKENS | 6144 (existing supported range 16–8192) |
| AI_SOURCE_ANALYSIS_TEMPERATURE | 0; use `none` when unsupported by the deployment |
| AI_SOURCE_ANALYSIS_CONTEXT_MAX_TOKENS | 98304 |
| AI_SOURCE_ANALYSIS_CONTEXT_MAX_BYTES | 65536 |

The conservative context builder rejects overflow before inference; it never truncates evidence under
an unchanged content hash. Context includes at most ten chunks and 1024 spans, output is bounded to
256 KiB. These limits and source retrieval configuration apply even to custom criteria/instructions.
Java 25/Spring Boot 4.1.1 BOM, npm package-lock and Python 3.13.3/uv.lock remain unchanged.

- `cd backend && ./mvnw verify`: full build/tests and dedicated JaCoCo source-analysis/authoring coverage gates ≥80%.
- `cd frontend && npm run test:coverage -- --runInBand && npm run build && npm run lint`: table, both-side findings,
  error/loading/boundary states, citation numbering/undo/save/reload, source navigation; individual module gates ≥80%.
- `cd ai-worker && uv run --frozen pytest`: strict schema and Foundry transport, scoped keys, both-side/context validation,
  authenticated bounded HTTP, retries, shared fixtures and full coverage gate ≥80%.

Integration tests exercise real session/CSRF HTTP, worker HTTP, Flyway/Postgres, immutable provenance and
2–5-source tables. The document page test saves/reloads structured references and opens their source
without rewriting the claim; backend tests persist accepted citation metadata through another manual save.


Final verification on 2026-10-01: 583 backend tests, 279 frontend tests and 292 worker tests passed.
Source-analysis backend line coverage is 100%; frontend comparison/API line coverage is 100% and
editor-citation line coverage exceeds 98%. The worker source-analysis module has 96% combined
statement/branch coverage. Maven JAR, Webpack production bundle and the pinned worker Docker image
built successfully. Both source-analysis fixtures also passed authenticated HTTP smoke tests in
the built worker image. Frontend lint/typecheck/format checks pass; Webpack retains its bundle-size
performance warnings.
