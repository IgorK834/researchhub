# Document review comments (RH-170 / RH-171)

Spring owns comments, replies and contribution history. Flyway V27 creates `document_comments`,
`comment_replies` and append-only `comment_audit_events`. No runtime dependency, auto-DDL, new service or
broker is introduced. The existing Hocuspocus service carries editor anchors in its binary/JSON snapshots.

## Permissions and lifecycle

Every route resolves the caller from the authenticated session and authorizes the scoped document. Reads,
including activity, require document read access. For this MVP **OWNER and EDITOR** can create, reply, resolve
and reopen; **VIEWER reads only**. This follows the backlog's default instead of the broader viewer-comment
permission in the design reference. Archived documents/workspaces remain readable and reject all writes.
Non-members and cross-workspace document/thread substitution return 404; viewer writes return 403.
Mutations require CSRF. Names are snapshots of already-authorized users; contributions survive member removal.

Base path: `/api/workspaces/{workspaceId}/documents/{documentId}/comments`.

| Method | Suffix | Request | Response |
| --- | --- | --- | --- |
| GET | base | — | `Comment[]`, oldest first, with replies and orphan state |
| POST | base | `{id, body, anchor}` | 201 `Comment` |
| GET | `/{id}` | — | `{comment, events}` |
| POST | `/{id}/replies` | `{id, body}` | 201 updated `Comment` |
| PATCH | `/{id}` | `{status: "OPEN" \| "RESOLVED"}` | updated `Comment` |

`Comment`: `id`, `workspaceId`, `documentId`, `authorId`, `authorName`, plain-text `body`, `status`, `anchor`,
`orphaned`, `createdAt`, `updatedAt`, `resolvedBy`, `resolvedAt`, `replies`. Bodies are 1–4000 characters.
Replies contain `id`, author metadata, body and creation time. Events contain `id`, `commentId`, optional
`replyId`, actor metadata, `action`, previous/current status and creation time. Emails and HTML are absent.

Comment/reply UUIDs identify immutable creation requests. Identical retries return existing values; altered
reuse returns 409. The browser uses the anchor UUID as the new comment UUID and retains reply UUIDs on retry.
Repeating the target status is a no-op. Replies require an open thread. Document row locking serializes review
writes with save/restore/collaboration commits. Changes and audit events commit in one transaction.
PostgreSQL triggers refuse audit/reply UPDATE/DELETE. No comment editing/deleting or mention delivery is exposed.

## Anchor contract: TEXT_MARK_V1

API metadata: `{strategy: "TEXT_MARK_V1", id: "<uuid>", quote: "<selection at creation>"}`.
The quote is historical context, bounded to 2000 characters; it is never used for fuzzy matching.
Stored editor mark:

```json
{"type":"commentAnchor","attrs":{"ids":["<anchor-uuid>","<overlapping-anchor-uuid>"]}}
```

ProseMirror transaction mapping and Yjs text formatting preserve this mark through nearby edits, formatting,
partial deletion, synchronization and binary recovery. An ordered ID set within one mark supports overlapping
threads without relying on multiple marks of the same type, which Yjs collapses. Navigation resolves current
positions from marked text; offsets are never persisted. Escaped `data-comment-anchor` spans render the mark.
Clipboard paste strips comment identities and preserves other formatting. Citations/provenance remain intact.

Creation attaches the mark in the live editor, waits for existing autosave/durable Yjs acknowledgement, then
POSTs. Spring checks that the UUID exists on non-blank marked text in the current stored document under the
same row lock. A deleted selection returns 409 and keeps the draft. Cancelled/failed unpublished markers may
remain as inert metadata; they are invisible without a matching thread/composer and create no discussion.
Selections containing only unmarkable content, such as a code block, produce no anchor.

When all marked text is deleted, the thread becomes orphaned. Its quote, discussion and activity survive;
navigation is unavailable and the panel explains the missing passage. Missing/malformed identifiers are
unavailable, without crashing. Restore/undo reconnects a thread if it recovers the same mark; content without
that mark leaves it orphaned. Pasted replacement text does not silently relocate a discussion.

## UI and synchronization

The selected-text toolbar offers **Add comment** for editors/owners, including realtime editing. The existing
context panel/slide-over hosts a composer, open/resolved filters, contribution cards, replies and activity.
Quote clicks scroll to and select current marked text; highlight clicks open its thread. Viewers/revoked
editors have no mutating controls. Errors retain drafts; requests disable repeat submissions while pending.
Comments refresh every five seconds while the document screen is open, on focus and manually. Live anchor
availability follows editor transactions. This uses existing REST transport, with no second realtime protocol.

## Verification

- `cd backend && ./mvnw verify`: real PostgreSQL HTTP authorization/CSRF, replay/concurrency, immutable
  history, atomic rollback, edits/deletion/restore; independent 80% JaCoCo line gate for `comment`/`audit`.
- `cd frontend && npm run test:coverage -- --runInBand`: independent 80% line/statement/function/branch
  gate for `features/documents/comments`; two Yjs editors, overlap/concurrent edits/reload, clipboard,
  keyboard, drafts/errors, replies/status, viewer and orphan states.
- `cd collaboration && npm run build && npm test`: transport schema and binary/JSON recovery.
- `cd collaboration && npm run test:browser`: production frontend, Spring/PostgreSQL/Hocuspocus and
  separate Chrome sessions; selection → comment → peer reply → resolve/reopen → activity, nearby peer
  edits, viewer read access and deletion/reload. Screenshots/logs go to `backend/target/`.

Workspace authorization, documents/history and opt-in realtime dependencies already exist. Comments support
both legacy autosave and realtime. RH-172/173 add [AI evidence contributions and product audit](comment-ai-and-product-audit.md).
Global feeds/notifications and whole-document attribution remain separate workstreams.
