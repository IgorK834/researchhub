# Realtime document contract v1

Protocol: Hocuspocus 3.4.3 over WebSocket; Yjs 13 updates; Tiptap/ProseMirror editor schema 3.31.3.
Room identity is `document:<UUID>`. Body fragment is `default`; title is `metadata.title`.

Browser endpoints (existing Spring session + CSRF, EDIT_CONTENT required):

| Method/path | Response |
| --- | --- |
| `POST /api/workspaces/{workspaceId}/documents/{documentId}/collaboration/credential` | `{token,room,websocketUrl,expiresAt,user}`, no-store; opaque 256-bit token, <=120s |
| `POST .../collaboration/checkpoint` | Current committed `{summary,content}` application snapshot; records manual version once per revision |

`summary` contains the existing document summary fields; checkpoint `content` is serialized JSON text. The browser adapter parses it and flattens the summary before updating the document query cache.

Private service endpoints accept JSON with `X-Collaboration-Service-Token`. No browser authentication is accepted.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /internal/collaboration/authorize` | `{token,room}` | `{workspaceId,documentId,userId,expiresAt,user}` |
| `POST /internal/collaboration/load` | `{token,room}` | `State` (activates realtime under document row lock) |
| `POST /internal/collaboration/rooms/{room}/snapshot` | `{token,sequence,snapshotId,state,title,content}` | `State` after atomic commit |

`State`: `{sequence,state,stateSha256,title,content,revision,savedAt}`. Binary `state` is standard base64 (null before seeding and
in save acknowledgements); `content` is serialized ProseMirror JSON text, **not HTML**; `savedAt` is server ISO-8601.
`stateSha256` is a lowercase SHA-256 hex digest (null before the first commit); Node verifies it on recovery and
checks that binary state materializes to the stored JSON/title. `snapshotId` is a UUID identifying one write attempt;
a bounded retry must reuse the exact UUID, sequence, bytes and projection. An identical last receipt returns the
existing commit without another revision; altered reuse or an older sequence fails with 409.
The snapshot request's `sequence` is the previously committed sequence; a successful commit increments it by one.
`content` and binary `state` must describe the same candidate Y.Doc; Node validates/transforms the editor schema,
Spring validates size/domain/provenance. This correspondence is inside the trusted service boundary.

Existing API ProblemDetail codes apply: unauthorized service 401; non-member/scoped document mismatch 404;
insufficient role/expired or invalid token 403; stale sequence/archival/legacy replacement 409; invalid snapshot 400.
All room loads and writes repeat current workspace authorization. WebSocket failures disclose a generic denial.
Server-only stateless `{event:"persisted",revision,savedAt}` notifications follow database commit. `{event:"persistenceFailed",code}` precedes closing a failed write connection; codes are `PERSISTENCE_UNAVAILABLE`,
`SNAPSHOT_CONFLICT`, `ACCESS_DENIED` or `UPDATE_REJECTED`. The browser retains pending local state and retries through
reconnection; failure never broadcasts the candidate to peers. Incoming stateless
broadcasts are not exposed. Sync acknowledgements are durable because the awaited message hook persists first.

The service handles one replica; use WSS/TLS and private backend routing outside localhost. See
[ADR-007](../../../docs/adr/ADR-007-realtime-document-authoring.md) for revocation bounds, consistent reads and recovery.

## Presence and session access (RH-165/RH-166)

The credential and private authorize response both include the verified identity:

```json
{"userId":"<authorized-user-uuid>","displayName":"Ada Nowak","colorId":"coral"}
```

This is the value of `user`, not an account response. `colorId` is one of `blue`, `coral`, `lavender`, `mint`,
`yellow`, generated with the existing avatar hash. Only ID/name/color cross the presence boundary; email is absent.
The browser sends Yjs Awareness separately from CRDT sync: `{user, cursor?: {anchor,head}|null}`; relative positions
allow only Yjs type/item IDs, `tname: "default"` where applicable and `assoc: -1|0|1`. Empty state is permitted during
provider startup and `null` removes presence. Frames are limited to 16 KiB/64 clients. The service binds one awareness
client ID to a document connection and rejects impersonation, private/extra fields and updates/removal of another
connection's state. Stale/no-op provider echoes are allowed. Awareness is applied within the room queue while the
connection is registered; closed-session frames cannot resurrect it. No presence is included in binary snapshots,
JSON reads/exports or history. Disconnect clears it immediately; silently lost sockets are detected within two
10-second heartbeat intervals, with a 30-second stale-awareness fallback.

A current permission denial (403/404/409 during reauthorization) emits server stateless `{"event":"accessRevoked"}`
and closes the room with reason `ACCESS_REVOKED`. The UI hides presence, locks authoring, retains local unaccepted
changes and stops automatic retries; its Check access button reloads through ordinary session authorization.
Credential expiration uses `ACCESS_EXPIRED` and renews via the credential endpoint. Spring unavailability uses
`ACCESS_UNAVAILABLE`, closes the room without granting offline edits and permits reconnection. `SESSION_CLOSED`
only discards work queued for a connection that already ended; it never claims a membership change. The service
checks every incoming message and periodically, with no overlapping periodic calls and a maximum 5-second interval
plus the private HTTP timeout (5 seconds). Viewers still get only the REST read API and no editing transport.
