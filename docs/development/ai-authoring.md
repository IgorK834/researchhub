# AI-assisted authoring (RH-120–122)

The document editor now offers draft sections, selected-fragment rewrites and evidence discovery.
All three operate on saved document revisions. Spring owns workspace/source authorization, retrieval,
proposal storage and approval. The existing Python worker owns model inference only; it has no document
or database write capability. No new service, vendor library or frontend dependency is introduced.

## Workflow

Select ready sources and a section placement, title/instruction, approximate word target (20–1000),
style (academic, concise, plain) and citation requirement to generate a draft. Drafting always requires
explicit selected source IDs and at least one citation for a successful result. Empty retrieval produces
an insufficiency suggestion, never ungrounded prose.

For rewriting, select 1–2000 UTF-16 characters of prose in Tiptap. Available actions are improve academic
style, shorten, expand, clarify, fix grammar and explain. Expansion can optionally use selected sources.
Only the selected text and at most 200 characters on either side are sent to inference; the entire
report/title/other paragraphs are not included. Source excerpts are independently constrained by the
existing context byte/token budget. Code blocks and structural/partial block selections are refused.
Selections across prose blocks retain the surrounding tree and flag paragraph/semantic formatting
changes. A replacement contained in one text node retains its marks. Existing citation nodes are retained
at the end of the replacement, with an explicit placement warning when selected.

The UI presents original and replacement as a deletion/insertion diff, with Accept, Reject and Edit.
Reject changes the proposal state only. Accept submits the saved proposal ID and revision; the server
constructs the edit, rather than accepting a replacement document from the browser. Accepting stale
content returns a conflict and leaves the document unchanged. While accepting, the editor is frozen;
a failed/interrupted response retains the exact approval input for retry or explicit reload.

For evidence discovery, selected prose is the claim; omitted/null source selection searches authorized
workspace sources, `[]` deliberately searches none. Results have source snippets (up to 1500 characters),
page/section/unit location, relevance (0–1), reason and `supporting`, `related` (partial/contextual) or
`insufficient` category. Contradiction is not a category. Add citation inserts a versioned source reference
at the claim's end, preserving every character and mark of the claim. Insufficient matches cannot be added.

## Explicit contracts and persistence

Routes below are scoped by `/api/workspaces/{workspaceId}/documents/{documentId}/ai/suggestions`:

| Method/path | Contract |
| --- | --- |
| POST | `AuthoringContracts.Command`, returns a durable pending `Suggestion` |
| GET /{id} | Authorized read of the proposal, state, model/context/citation provenance |
| POST /{id}/reject | Idempotently rejects pending suggestions, refuses accepted ones |
| POST /{id}/accept | `Accept`, returns `eventId`, `acceptedRevision` and the document |

Command fields: `kind` (`DRAFT`, `REWRITE`, `EVIDENCE`), `expectedRevision`, `placementBlock` (zero-based
boundary between top-level blocks, draft only), `from`/`to` (ProseMirror UTF-16 positions, rewrite/evidence
only), `action` (rewrite only), `instruction`, `selectedSourceIds`, `lengthTarget`, `stylePreset`,
`citationRequired`. Use null for inapplicable fields. Selected sources are mandatory for drafting;
rewriting requires an explicit list and permits nonempty lists only for expansion. No request can change
workspace identity, provider credentials, templates or model parameters.

`Accept`: `expectedRevision`, nullable `editedText`, nullable `citationChunkId`. Editing adjusts prose,
retaining the suggestion's validated references. Evidence approval accepts a single non-insufficient
candidate ID and refuses replacement text. Repeating an accepted proposal with the identical input
returns the original event/revision and current document; different input is a conflict.

V17 creates `ai_authoring_suggestions` and immutable `ai_authoring_events` with workspace/document foreign
keys. Proposal row locking serializes Accept/Reject; document revision locking prevents lost updates.
The document edit, `AI_ACCEPTANCE` history snapshot, event (proposal identity, approver, revision,
acceptance input, content hash) and approval state commit together. A duplicate request cannot insert twice.
Proposal metadata preserves the selected sources, generated/original text, retrieved citation locations,
model/usage, template hash, request ID and context hash/budget summary. JSON is bounded; raw provider bodies
and hidden reasoning are never persisted.

The `researchCitation` inline atom extends the existing ProseMirror JSON schema additively. References
carry the source, processing version, chunk/content hash and spans; navigation uses authorized existing
source routes. Previously stored documents remain valid; history remains restorable.

The internal worker POST `/internal/ai/author` accepts the existing v2 context envelope and returns the
versioned authoring result. Provider-local citation keys are mapped to retrieved chunk IDs. Both worker
and backend reject unknown citations, categories, invalid result identity and unsupported ready output.
Model templates are server-owned `authoring-{draft,rewrite,evidence}:1`. Model inference uses the existing
configured provider. `deterministic` is explicitly an offline extractive/lexical fixture: several rewrite
actions echo text, length/style are not simulated, and exact excerpts alone receive supporting labels.
Use the existing Foundry configuration for production inference; deployment quality/entailment needs human
review. Output must be complete and validated before it becomes a visible suggestion.

Configuration: `AI_AUTHORING_MAX_OUTPUT_TOKENS` (default 4096), `AI_AUTHORING_TEMPERATURE` (default 0,
`none` when the deployment does not support temperature). Existing grounded context settings apply.
Java/Spring BOM, package-lock, Python 3.13.3 and uv.lock are unchanged.

## Verification

- `cd backend && ./mvnw verify`: full tests/build; a dedicated JaCoCo authoring line coverage gate >=80%.
- `cd frontend && npm run test:coverage -- --runInBand && npm run build && npm run lint`: authoring API,
  review/approval/retry UI, saved editor integration, versioned citation round trips; coverage gates >=80%.
- `cd ai-worker && uv run --frozen pytest`: strict provider output, citation allowlist, actions, evidence
  categories, internal HTTP authorization, bounded retries and full regression suite; coverage gate >=80%.

Backend integration tests use real session/CSRF HTTP, worker HTTP transport, migrations/PostgreSQL and
concurrent approval transactions; retrieval/model fixtures provide deterministic evidence. Worker tests
exercise both the offline fixture and Foundry wire/schema behavior without paid remote calls.


RH-123 completes citation metadata, dynamic numbering, source navigation and display controls.
RH-124–125 add workspace source comparisons and potential differences; see
[structured citations and source analysis](source-analysis.md) for contracts and verification.
