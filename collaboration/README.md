# ResearchHub collaboration (RH-160–RH-166)

Small independent Node/TypeScript Hocuspocus process. Spring owns authorization and durable persistence;
this process has no product database credential. Architecture: [ADR-007](../docs/adr/ADR-007-realtime-document-authoring.md).

```bash
npm ci
npm run build
npm start
# or npm run dev
npm test             # real WebSocket clients + >=80% coverage gate
```

Environment (also documented in the root `.env.example`):

| Variable | Default / rule |
| --- | --- |
| `COLLABORATION_SERVICE_TOKEN` | Required; random secret >=32 characters; same private value in Spring |
| `COLLABORATION_PORT` | `8091` |
| `COLLABORATION_BACKEND_URL` | `http://127.0.0.1:8080`; Spring private origin |
| `COLLABORATION_ALLOWED_ORIGINS` | `http://localhost:3000`; comma-separated exact origins, no wildcard |
| `COLLABORATION_RECHECK_MS` | `5000`; 100–5000 ms |

Health: `GET http://localhost:8091/health` returns `{"status":"UP"}` for process health. Other HTTP routes return 404.
Use one service instance. Keep `/internal/collaboration/**` private, use TLS/WSS and configure allowed origins in deployment.
No anonymous rooms or direct file/database persistence. Graceful SIGTERM/SIGINT closes clients; committed state is in
PostgreSQL. Each incoming change is committed before broadcast/ack, and all active sessions periodically reauthorize.

Local full stack:

1. Start existing PostgreSQL/Azurite/worker using the root README.
2. Set `COLLABORATION_ENABLED=true`, a random `COLLABORATION_SERVICE_TOKEN` and
   `COLLABORATION_WEBSOCKET_URL=ws://localhost:8091` in the Spring environment. Start the backend normally.
3. Export the same service secret for this process and run `npm start` independently.
4. Start frontend with `RESEARCHHUB_COLLABORATION_ENABLED=true npm start` (or build with that value).
5. Open the same workspace document using two authorized editor sessions. Body/title merge; Saved means acknowledged
   durable state. A viewer receives REST read-only content and no editing socket.

Both feature flags default to false for existing installations. Activation is permanent per document; disabling the
flag does not allow old revision PATCH/AI-accept/restore to overwrite Yjs. History remains readable and Save version
creates a manual checkpoint. Revision-based AI insertion and historical restore require future CRDT transactions;
the realtime UI does not offer these replacement operations. Unacknowledged browser changes are held by IndexedDB.

Spring E2E test prerequisites and command from the repository root:

```bash
npm ci --prefix collaboration
npm run build --prefix collaboration
cd backend
./mvnw verify
```

`CollaborationApiIntegrationTest` launches `test/spring-e2e.mjs` against its random-port Spring server and Testcontainers
PostgreSQL. It runs two real provider clients, verifies room substitution fails, recreates the service and inspects the
committed REST projection. Frontend retains Webpack/Babel/Jest; collaboration tests do not serve the frontend.

Full browser acceptance test from the repository root:

```bash
npm ci --prefix frontend
npm ci --prefix collaboration
npm run test:browser --prefix collaboration
```

Requires Docker, Java 25 and Chrome. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a different local Chromium binary.
The command builds the real frontend with realtime enabled and starts a temporary Spring/Testcontainers environment.
Its test-only proxy forwards real session/CSRF requests and can inject persistence failures or drop a successful
commit response; it does not replace Spring authorization or domain persistence. Two isolated browser sessions edit,
undo/redo, disconnect/reconnect, checkpoint, reload and survive independently restarted (SIGKILL) Node processes.
They also check authenticated avatar/cursor/selection presence, removal on disconnect, editor demotion, member removal
and workspace archival through real owner APIs, including read-only transitions and denied reconnect.
Logs and screenshots are under `backend/target/collaboration-browser-*`. The browser test is opt-in for headless CI;
regular Maven verification still runs the two-provider Spring/PostgreSQL integration test.

Persistence uses one full snapshot per room, replaced with CAS after every accepted update, rather than an unbounded
update log. SHA-256 and materialization checks fail closed on corrupt/missing state. V26 retains only the latest write
receipt, making immediate transient retries idempotent without an ever-growing receipt table. Binary/JSON/revision
and any due history checkpoint share the Spring transaction. Snapshot limits fail visibly and retain pending local
edits. Back up PostgreSQL including binary state and immutable versions; restore matching binary/projection/sequence
with sessions stopped. Never delete the activation marker or seed an activated document from a REST copy.

Presence is ephemeral Yjs Awareness, never a snapshot/history field. Spring supplies only verified user ID, display
name and a generated color identifier. Node rejects extra fields (including email), forged identities and attempts
to update/remove another socket's presence. The document topbar shows active room users, not the workspace member list.
A disconnect removes presence immediately; a silently lost socket uses a 10-second heartbeat (usually <=20 seconds),
with the 30-second Awareness timeout as a fallback. Active permission checks do not overlap; within the configured
recheck interval plus the 5-second backend timeout, access revocation closes the room, removes its presence and locks
the visible editor. Token expiry renews via Spring; role/removal/archive denial requires an explicit access check/reload.
No new runtime settings, tables, broker or authorization cache are introduced by RH-165/RH-166.
