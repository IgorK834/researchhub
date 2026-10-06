# Comment research assistance and product audit (RH-172 / RH-173)

The Comments panel follows `design-reference/Review,history&roles.pdf` and the evidence/source inspection
patterns in `Ask,evidence&comparison.pdf`. AI contributions use the existing lavender tokens, a sparkle icon
and **AI · Evidence suggestion**. The invoking person is labelled **Requested by**, never presented as the
author of generated evidence. Source excerpts are separate from model explanations. Insufficient evidence
is preserved as an honest result.

## Permission and user flow

1. Select prose, choose **Add comment** and save the human comment. Existing selection evidence tools also
   remain available for legacy authoring.
2. Choose **Find evidence with AI** in an open thread. Opening/reading a thread never invokes a model.
3. The server derives the current claim from its saved `TEXT_MARK_V1` mark, rather than trusting a client
   quote or offsets. It searches authorized workspace sources and uses the existing evidence authoring
   contract, bounded grounded context and Python model-provider boundary.
4. Inspect the source link, location, excerpt, relevance explanation and warnings. The human comment keeps
   its author/status; the AI contribution is separate and immutable. AI never resolves a thread.
5. Choose **Insert citation** for a supporting/related candidate. The editor resolves the mark again and
   inserts a semantic `researchCitation` node. Normal autosave/Yjs persistence validates and saves its
   workspace/source/version/chunk/location provenance. After persistence, the UI confirms manual acceptance
   with the backend, which verifies exact saved citation provenance and appends the audit event. Failed
   confirmation preserves the edit and offers **Retry confirmation**. Reading a suggestion never accepts it.

MVP: owners/editors can invoke these AI contributions and insert citations; viewers can read suggestions
and source links. `WorkspaceCapability.USE_AI` is explicit and checked by `requireAiContributor`, alongside
`EDIT_CONTENT` and the active-workspace rule. Existing read-only Ask AI features retain their permissions.
No role/entitlement/settings infrastructure is added. Actors come from the session; writes retain CSRF protection.

Inference holds no database transaction or document lock. Publication rechecks workspace permissions,
document/archive state, open-thread status and exact live claim in a short transaction under the document
lock shared with saves/collaboration. Nearby edits can change offsets without invalidating results;
editing/deleting the claim or resolving its thread during generation rejects publication. UUID request IDs
return the existing contribution on lost-response retries. Concurrent identical requests can infer twice,
but publish once. Quotes are historical context. Orphaned threads/suggestions remain readable after reload.
Changed claims require fresh evidence before citation acceptance. An existing acceptance receipt remains
idempotent even if a peer subsequently deletes the passage/citation. Failed confirmations can also be dismissed
while keeping the user's editor change. Panel portal containers retain native focus/clicks during editor rerenders.

## Public contracts

All paths begin with `/api/workspaces/{workspaceId}` and are scoped/authorized server-side.

| Method/path | Input | Result |
| --- | --- | --- |
| `POST /documents/{documentId}/comments/{commentId}/ai-evidence` | `{ "id": "<request UUID>" }` | `201` updated comment with `aiSuggestions` |
| `POST /documents/{documentId}/comments/{commentId}/ai-evidence/{suggestionId}/accept` | `{ "chunkId": "<64-char hash>" }` | `200` comment with durable receipt; unpersisted/forged/insufficient citations rejected |
| `GET /audit-events?limit=50&before=<event UUID>` | limit 1–100; optional workspace-scoped cursor | `{ events, nextCursor }`, newest first; no mutation routes |

`aiSuggestions[]`: `id`, `commentId`, `kind: AI_EVIDENCE`, `requestedBy`, `requestedByName`, `claim`, `createdAt`,
`acceptedChunkIds`, `evidence`. Evidence contains bounded `candidates`, `warnings`, `generation`, `context`.
Candidates contain trusted citation metadata, source snippet, category, relevance and model reason.
Generation/context preserve model, template/hash, request identity, usage and context provenance. Java assembles
source references from authorized retrieval. Invented citations fail existing structured-output validation.
No artificial AI user/member is created.

## Product audit

`ProductAudit` is a typed internal application port with no arbitrary metadata argument. Methods accept
identifiers, allowed roles, revision/size numbers and success flags. Passwords, tokens, prompts, source bodies,
report prose, captions and generated code cannot be passed as metadata. Model outputs remain in dedicated
AI/analysis provenance stores. Application logs remain in use. This history is not full event sourcing.

| Event | Commit boundary / safe metadata |
| --- | --- |
| `WORKSPACE_CREATED` | Workspace/initial ownership transaction |
| `MEMBER_ADDED` / `MEMBER_ROLE_CHANGED` / `MEMBER_REMOVED` | Membership transaction; member ID and old/new roles; unchanged role emits nothing |
| `SOURCE_UPLOADED` | Source/version/ingestion transaction; version ID and byte count |
| `SOURCE_REPROCESSED` | Reprocessing/replacement transaction; version/job IDs |
| `DOCUMENT_CREATED` | Initial document/version transaction; revision |
| `AI_EVIDENCE_REQUESTED` | Published comment suggestion transaction; document/comment IDs and human invoker |
| `AI_SUGGESTION_ACCEPTED` | Authoring approval or saved comment citation receipt; document ID/revision; retries emit nothing |
| `ANALYSIS_EXECUTED` | Completion, failure or recovery transaction; execution/analysis IDs and status; duplicate completion emits nothing |
| `ANALYSIS_BLOCK_INSERTED` | Validated create/save/Yjs persistence/restore; new/changed block/reference IDs and revision; unchanged references emit nothing |

Events have UUID identity, workspace ID, nullable actor-user ID for system actions, event/resource type,
resource ID, safe JSON metadata and timestamp. Flyway V28 creates audit events, immutable AI suggestions and
immutable per-candidate acceptance receipts. Events and actions commit together; audit failure rolls back the
action. Triggers also reject UPDATE/DELETE. Soft archiving preserves history. Tests clean up with
`TRUNCATE … CASCADE` without weakening production constraints. The read API uses indexed workspace-scoped
keyset pagination `(created_at,id)`; equal timestamps neither skip nor duplicate events. Every member can read
safe workspace history, including archived workspaces.

## Verification

Backend: `COLLABORATION_BROWSER_TESTS=true ./mvnw verify`. Frontend: `npm run test:coverage -- --runInBand`,
`npm run lint`, `npm run format:check`, `npm run build`, `npm run build:realtime`. Build realtime assets and
the collaboration service before the optional Chrome test.

HTTP tests exercise authenticated routes, Flyway/PostgreSQL, structured model HTTP and rollback, using
deterministic authorized retrieval fixtures. Chrome/Yjs covers two editors, explicit AI invocation, source links,
nearby edits, manual citation insertion, peer replication, reload, viewers and orphans, and checks durable
audit receipts. Pure Yjs tests verify binary recovery of citation provenance. JaCoCo enforces 80% lines for
comments and independently for audit; Jest enforces 80% lines/statements/functions/branches for comments.
