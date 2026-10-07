# Backend architecture

Rules for the Spring Boot modular monolith. Product context stays in [docs/context.md](../context.md) (sections 18, 19, and 32). REST error JSON is specified in [api-errors.md](api-errors.md). Request DTO validation, shared length limits, and the trim policy are specified in [validation.md](validation.md).

Java owns domain rules and workspace authorization. Python under `ai-worker/` is outside this tree and exposes only
its health probe plus explicit internal processing contracts; it has no product PostgreSQL access or product API.
Do not add a global `controllers`, `services`, or `repositories` package under `dev.researchhub`.

## Packages in the repository today

```text
dev.researchhub
├── BackendApplication
├── config          Spring bootstrap that is not a product module
├── auth            Authentication mechanics
│   ├── api             AuthController, CurrentUserController, request/response records, @StrongPassword
│   ├── application     CurrentUserResolver
│   └── infrastructure  SecurityConfiguration, BrowserSession, ProblemDetail error writers
├── user            User identity
│   ├── domain          User, UserEmail, PasswordHash, UserStatus
│   ├── application     UserAccount, registration and authentication services, UserLookupService, PasswordPolicy
│   └── infrastructure  UserEntity, UserRepository
├── workspace       Workspace boundary, membership, and authorization
│   ├── api             WorkspaceController, WorkspaceMemberController, request/response records
│   ├── application     WorkspaceService, WorkspaceMembershipService, WorkspaceAuthorizationService, commands and summaries
│   ├── domain          Workspace, WorkspaceMembership, WorkspaceMembers, WorkspaceRole, WorkspaceCapability
│   └── infrastructure  WorkspaceEntity, WorkspaceMemberEntity, WorkspaceRepository, WorkspaceMemberRepository
├── document        Authored workspace content
│   ├── api             DocumentController, request/response records, @JsonDocumentContent
│   ├── application     DocumentService, CheckpointPolicy, SaveKind, commands, summaries and details
│   ├── domain          Document, DocumentContent, DocumentContentFormat, DocumentVersion, DocumentVersionReason, StaleRevisionException
│   └── infrastructure  DocumentEntity, DocumentRepository, DocumentVersionEntity, DocumentVersionRepository
├── source          Uploaded research material and its immutable versions
│   ├── api             SourceController, SourceResponse, SourceVersionResponse
│   ├── application     SourceService, processing listener, the SourceStorage port, limits and quota, version summaries/content
│   ├── domain          Source, SourceVersion, SourceType, SourceStatus, SourceFilename, StorageKey
│   └── infrastructure  SourceEntity, SourceVersionEntity, their repositories, AzureBlobSourceStorage and its configuration
├── analysis        Dataset inspection, computation planning, isolated execution and immutable results
│   ├── api             DatasetPreviewController, AnalysisController
│   ├── domain          AnalysisStatus and lifecycle transitions
│   ├── application     DatasetPreview, AnalysisContracts, services, plan validator and planner/store ports
│   └── infrastructure  PostgreSQL intent/plan/execution stores, worker planning adapter and trusted Docker runner
├── ai              Retrieval substrate
│   ├── api             Workspace-authorized current source chunk reads
│   ├── application     Chunk/config/provenance contracts, validation, retrieval read service and storage port
│   └── infrastructure  PostgreSQL span storage and canonical search projection
├── processing      Durable asynchronous work
│   ├── application     enqueue service, dispatcher, worker/listener ports and cross-module notifications
│   ├── domain          ProcessingJob, ProcessingJobStatus, job/resource types, safe error
│   └── infrastructure  PostgreSQL queue, local HTTP worker client and configuration
└── shared
    ├── error       Stable API error codes and exceptions modules may throw
    ├── api         HTTP translation of those errors
    ├── validation  Shared Bean Validation length limits and DTO normalization helpers
    └── infrastructure
        └── persistence   JPA scan for the local profile; not product repositories
```

`user` owns the user record and its password hash. It has no `api` package: nothing exposes users over HTTP directly, and the endpoints that create and verify them belong to `auth`.

`auth` owns the Spring Security filter chain, the password encoder bean, CSRF configuration, the CORS policy, the session cookie, and these endpoints:

| Endpoint | Auth |
| --- | --- |
| `POST /api/auth/register` | Public |
| `POST /api/auth/login` | Public |
| `GET /api/auth/csrf` | Public |
| `GET /api/me` | Required, canonical identity read |
| `GET /api/auth/me` | Required, alias of the above |
| `POST /api/auth/logout` | Required |

The mechanism is fixed by [../adr/ADR-001-authentication.md](../adr/ADR-001-authentication.md).

`workspace` owns the workspace boundary and every authorization decision about it:

| Endpoint | Auth | Capability | Who is served |
| --- | --- | --- | --- |
| `POST /api/workspaces` | Required | — | Any authenticated user. The caller becomes the workspace's `OWNER`. |
| `GET /api/workspaces` | Required | Membership | The caller's own **active** workspaces, from their memberships. Never anyone else's. |
| `GET /api/workspaces/{workspaceId}` | Required | Membership | Members only, including for an archived workspace. A non-member gets `404`, not `403`. |
| `PATCH /api/workspaces/{workspaceId}` | Required | `MANAGE_WORKSPACE` | Owners. Replaces name and description. `409` if the workspace is archived. |
| `POST /api/workspaces/{workspaceId}/archive` | Required | `MANAGE_WORKSPACE` | Owners. Soft archive, idempotent. |
| `GET /api/workspaces/{workspaceId}/members` | Required | Membership | Any member, including a viewer and including on an archived workspace. |
| `POST /api/workspaces/{workspaceId}/documents` | Required | `EDIT_CONTENT` | Editors and owners. 201, revision 1. |
| `GET /api/workspaces/{workspaceId}/documents` | Required | `VIEW_CONTENT` | Any member. Summaries of active documents, without content. |
| `GET /api/workspaces/{workspaceId}/documents/{documentId}` | Required | `VIEW_CONTENT` | Any member. The document with its content, archived or not. |
| `PATCH /api/workspaces/{workspaceId}/documents/{documentId}` | Required | `EDIT_CONTENT` | Editors and owners. 200 with the next revision, or 409. Optional `saveKind`: `MANUAL` (default) or `AUTOSAVE`, which decides only whether the save becomes a version. |
| `GET /api/workspaces/{workspaceId}/documents/{documentId}/versions` | Required | `VIEW_CONTENT` | Any member. The document's versions, newest first, without content. Archived documents too. |
| `GET /api/workspaces/{workspaceId}/documents/{documentId}/versions/{versionId}` | Required | `VIEW_CONTENT` | Any member. One version with its content. A version of another document is 404. |
| `POST /api/workspaces/{workspaceId}/documents/{documentId}/versions/{versionId}/restore` | Required | `EDIT_CONTENT` | Editors and owners. Body `{"revision": n}`. 200 with a new revision holding the old text, or 409 exactly as a save. Deletes nothing. |
| `DELETE /api/workspaces/{workspaceId}/documents/{documentId}` | Required | `EDIT_CONTENT` | Editors and owners. 204, soft archive. |
| `POST /api/workspaces/{workspaceId}/members` | Required | `MANAGE_MEMBERS` | Owners. Adds a registered user as `EDITOR` or `VIEWER`. 201. |
| `PATCH /api/workspaces/{workspaceId}/members/{userId}` | Required | `MANAGE_MEMBERS` | Owners. Changes one member's role. 200. |
| `DELETE /api/workspaces/{workspaceId}/members/{userId}` | Required | `MANAGE_MEMBERS` | Owners. Removes one membership row. 204. |

Reading the roster needs only membership, while changing it needs `MANAGE_MEMBERS`. Seeing who you work
with is part of being in a workspace; deciding who is in it is not.

The three mutating member routes answer `409 CONFLICT` on an archived workspace, by asking
`Workspace.requireActive` rather than repeating the check — one definition of "archived means no more
changes". `GET` still works, because archiving stops changes, not reading.

**There is no endpoint that lists or searches users.** A member is added by their exact, full email
address, normalized through `UserEmail` inside `user.application`. An address that is unknown, malformed,
or attached to a disabled account all answer `404` with the same detail, so the route cannot be used to
discover which addresses have accounts. `user.application.UserLookupService` documents that boundary and
is the only way into user data from `workspace`.

There is no `DELETE`. Archiving sets `archived_at` and `archived_by` and removes nothing, because the
sources, documents, and results that will hang off a workspace have to stay traceable (docs/context.md
sections 3.3 and 3.4). Details and the rules this imposes on future workspace-owned tables:
[persistence.md](persistence.md).

The last-owner rule lives in `workspace.domain.WorkspaceMembers`, which is pure: `changeRole` and `remove`
check the rule and return the membership to persist or delete without touching a repository.
`WorkspaceMembershipService` loads the roster, hands it to that type, and writes back the decision. That is
why a new endpoint cannot bypass the rule — there is no path that changes a membership without going through
the domain.

### Two rules the workspace module is built around

**A workspace is the security boundary, and the boundary is a membership row.** Access is decided by
`workspace_members`, never by `workspaces.created_by` and never by the client. `WorkspaceAuthorizationService`
is the single place that decides, so a new endpoint cannot invent its own answer:
`requireMember(workspaceId, userId)` returns the role held, and `requireCapability(..., capability)` also
checks what that role may do.

**A non-member is answered `404 RESOURCE_NOT_FOUND`, with the identical detail a genuinely missing
workspace produces.** A `403` there would confirm that another team's workspace exists to anyone who can
guess or has seen an id, so whether it exists is itself information only its members get. A member whose
role is merely too low *does* get `403 FORBIDDEN`: they already know the workspace exists, so hiding it
would tell them nothing and would misdescribe the failure.

Roles map to capabilities in `workspace.domain.WorkspaceRole`, which is the whole authorization table:

| | `VIEW_CONTENT` | `EDIT_CONTENT` | `MANAGE_MEMBERS` | `MANAGE_WORKSPACE` |
| --- | --- | --- | --- | --- |
| `OWNER` | yes | yes | yes | yes |
| `EDITOR` | yes | yes | no | no |
| `VIEWER` | yes | no | no | no |

Ask for a capability, not for a role. A call site that writes `role == OWNER || role == EDITOR` has quietly
decided that every role added later is denied, and it spreads the table across the codebase.

**State rules live in `workspace.domain`, not in the service.** Whether a change is *legal* — a name is not
blank, an archived workspace cannot be renamed, a workspace keeps at least one owner — is enforced by
`Workspace` and `WorkspaceMembers`, which throw `VALIDATION_FAILED` or `CONFLICT` from `shared.error`.
Whether a caller is *allowed to ask* is `WorkspaceAuthorizationService`. Keeping them apart is what lets the
role matrix be tested against a database and the state rules be tested as plain unit tests, and it means a
future endpoint gets both for free rather than reimplementing either.

`GET /api/me` lives in its own `CurrentUserController` because `AuthController` is mapped under `/api/auth` and identity sits at the top level. Both delegate to `auth.application.CurrentUserResolver`, so the canonical path and its alias cannot return different bodies or disagree about when a session is still valid.

Logout is authenticated, not public. It needs a session to invalidate, so an anonymous POST has nothing to do; answering 401 rather than a silent 204 also avoids confirming the route to an unauthenticated caller.

### Profile scoping, and why some beans have it

`JpaPersistenceConfiguration` is `@Profile("local")`, so `UserRepository` exists only there. Anything that needs it must carry the same guard, or the `test` and `cloud` contexts fail to start — `BackendApplicationTests` and `CloudProfileStartupTests` both load the full context on profiles that exclude JDBC and JPA.

That is why `UserRegistrationService`, `UserAuthenticationService`, `UserLookupService`, `CurrentUserResolver`, `AuthController`, `CurrentUserController`, `WorkspaceService`, `WorkspaceMembershipService`, `WorkspaceAuthorizationService`, `WorkspaceController`, `WorkspaceMemberController`, `DocumentService`, and `DocumentController` are `@Profile("local")`.

Repository interfaces themselves carry no annotation: the guard is on `JpaPersistenceConfiguration`'s scan, so they are simply never instantiated elsewhere. Anything that *injects* one needs the guard, and so does anything that injects that.

The security filter chain is deliberately **not** scoped that way, and authentication is performed by the controller calling `user.application` rather than by a `UserDetailsService` or `DaoAuthenticationProvider` wired into the chain. A chain that depended on the user repository could not start where the repository does not exist, which would leave the profiles used by those tests with no filter chain at all — and therefore no assurance that the public health routes and the deny-by-default rule behave the same everywhere. The chain instead depends on nothing but Spring Security itself, and only the `SecurityFilterChain` and `CorsConfigurationSource` beans are conditional, on a servlet web application, because `HttpSecurity` is absent from a non-web context such as `@SpringBootTest(webEnvironment = NONE)`.

`dev.researchhub.config` holds cross-cutting startup configuration, including the cloud profile's required settings. It is not a dumping ground for product rules.

`shared` holds technology that more than one module needs. It does not hold workspace, document, source, processing,
or analysis behavior.

## Modules added with their first feature

Create the package when the first type for that module is added. Do not add empty directories or empty layer trees ahead of that.

| Module | Owns |
| --- | --- |
| `auth` | Authentication mechanics and session or token handling |
| `user` | User identity inside ResearchHub |
| `workspace` | Workspace aggregate, membership, and authorization decisions for workspace-owned resources |
| `document` | Collaborative report content owned by a workspace |
| `source` | Workspace source metadata and ingestion status |
| `processing` | Durable job identity/state, safe claim/retry/recovery, and worker delivery ports |
| `ai` | Authorized retrieval/model orchestration and durable research conversations with SSE events. Model calls and data processing stay in `ai-worker/`. |
| `analysis` | Bounded dataset inspection, immutable computation requests/plans, durable execution attempts, computed results/artifacts and provenance. Planning stays in `ai-worker/`; untrusted Python executes only in `sandbox/` through the trusted local runner ([analysis-execution.md](analysis-execution.md)). |
| `audit` | Immutable review activity and typed, safe, append-only product events with workspace-scoped reads |
| `comment` | Authorized document review threads, replies and structured editor anchors |

[docs/context.md](../context.md) section 18 also names `citation`, a future module. Collaboration is implemented as described below; RH-170–175 implement comments, explicit AI evidence assistance, audit, block origins and collaborative snapshots. Do not create packages only to match the long-term diagram.

## Layers

A small module can keep its types directly in `dev.researchhub.<module>` until a split removes a real tangle.

When a module needs layers, use this shape and this direction only:

```text
<module>/
├── api              HTTP and request/response types
├── application      use cases
├── domain           business rules
└── infrastructure   persistence, clients, and framework adapters
```

Allowed dependencies inside one module:

- `api` may depend on `application`
- `application` may depend on `domain`, and on its own module's `infrastructure` repositories
- `infrastructure` may depend on `domain` and `application`
- `domain` depends on none of `api`, `application`, or `infrastructure`

The second line is what every service in the codebase already does: a Spring Data repository is an
`infrastructure` type, and an application service injects one. Stated explicitly because its absence read as a
prohibition of the normal case.

## Dependencies between packages

- A product module may depend on `dev.researchhub.shared.error`.
- A product module must not depend on another product module's `domain` or `infrastructure`.
- A dependency on another module's public application type is allowed only when this document lists it.

### Allowed cross-module dependencies

| From | To | Why |
| --- | --- | --- |
| `source.application` | `security.application.UploadInspector` | Inspect bounded staged bytes before storage/persistence; optional scanning is a public port. |
| `ai.api`, `analysis.api`, `comment.api` | `security.application.CostlyOperation`, `CostCategory` | Explicit costly-endpoint admission contracts; no security infrastructure imports. |
| `security.api`, `security.infrastructure` | `auth.application.CurrentUserResolver`, `user.application.UserAccount`, `workspace.application.WorkspaceAuthorizationService` | Resolve authenticated actors and authorize workspace access before quota consumption; only the account id is read. |
| `comment.api` | `auth.application.CurrentUserResolver` | Actors come from the session; only `id()` is read from the returned account. |
| `comment.application` | `document.application.DocumentService` | Scoped reader authorization and active editor-only locking via `findOne`/`lockForReview`, with no document domain/repository imports. |
| `comment.application` | `user.application.UserLookupService` and `UserAccount` | Snapshot display names for authorized contribution IDs. |
| `comment.application` | `audit.application.ReviewAudit` | Append events in the same transaction and read activity only after authorizing the thread. |
| `comment.application` | `ai.application.EvidenceAssistanceService`, `AuthoringContracts`, `GenerationContracts`, `ContextContracts` | Explicit research assistance through the grounded model boundary and immutable evidence/provenance contracts. |
| `comment.application` | `workspace.application.WorkspaceAuthorizationService` | Check `USE_AI` contributor authorization before inference and again at publication/acceptance. |
| `workspace.application`, `source.application`, `document.application`, `ai.application`, `analysis.infrastructure` | `audit.application.ProductAudit` | Typed, safe append-only events in the transaction of each significant action; the execution store records atomic completion. |
| `audit.api` | `auth.application.CurrentUserResolver` | Session actor for scoped audit reads. |
| `audit.application` | `workspace.application.WorkspaceAuthorizationService` | Authorize bounded workspace audit reads. |
| `auth` | `dev.researchhub.user.application` | `auth` owns login and registration endpoints; `user` owns the user record. The endpoints need to create and verify accounts. |
| `workspace.api` | `dev.researchhub.auth.application` | Every workspace route acts on behalf of the signed-in user, and `auth` owns the session. `WorkspaceController` calls `CurrentUserResolver.requireCurrentUser()` rather than trusting a request field, which is what stops a client from creating a workspace owned by somebody else. |
| `workspace.api` | `dev.researchhub.user.application` | Only as the return type of the call above: `requireCurrentUser()` hands back a `UserAccount`, of which `workspace` reads `id()` and nothing else. The call is chained, so the type is never even imported — but it is still a dependency, and this row is what makes it allowed. |
| `workspace.application` | `dev.researchhub.user.application.UserLookupService` and `UserAccount` | A workspace's roster is membership rows plus the names and addresses they point at, and `user` owns those. `WorkspaceMembershipService` resolves one exact email to add a member, and a set of ids to render the roster. It reads `id()`, `email()`, and `displayName()`, and never `status()`. |
| `document.api` | `dev.researchhub.auth.application` | Every document route acts on behalf of the signed-in user, and `auth` owns the session. As in `workspace.api`, the caller comes from `CurrentUserResolver` rather than the body, and only `id()` is read. |
| `source.application` | `dev.researchhub.workspace.application.WorkspaceAuthorizationService` | Exactly as for documents: a source's access rule is its workspace's. `SourceService` calls the two `void` guards and never learns what a role is. `source` must not import `workspace.domain`, `workspace.infrastructure`, `user.domain`, or `user.infrastructure`, and nothing in `source.domain` or `source.application` may import a cloud SDK. |
| `source.application` | `dev.researchhub.processing.application` | `SourceService` enqueues the durable job in its database transaction; `SourceIngestJobStateListener` implements the narrow notification interface to mirror status. It imports no processing domain or infrastructure type. |
| `ai.application` | `dev.researchhub.source.application.SourceReadScope`, `SourceExtractionService`, `SourceService`, `SourceSummary` and `SourceVersionSummary` | Selected-source and selected-**version** ownership (`requireSources`, `requireSourceVersions`), grounded chunk reads, historical per-version evidence and context title snapshots go through public source contracts; no source repository/domain import. |
| `analysis.api` | `dev.researchhub.auth.application.CurrentUserResolver` | The caller comes from the authenticated session, never a request field. |
| `analysis.application` | `dev.researchhub.source.application.SourceService`, `SourceExtractionService`, `SourceReadScope`, `SourceVersionSummary` and `SourceVersionContent` | Workspace authorization, "this version belongs to this source" and the archived worker profile of a version are decided by `source`; `analysis` only projects them. No `source.domain` or `source.infrastructure` import. |
| `analysis.application` | `dev.researchhub.workspace.application.WorkspaceAuthorizationService` | Request, planning, queue, dispatch, completion and result access repeat workspace authorization through public guards. |
| `analysis.application` | `dev.researchhub.ai.application.GenerationContracts`, `ModelFailure` and `RetrievalIdentity` | The planning boundary reuses versioned model/usage contracts and policy hashes; computed numeric results remain a separate execution contract. |
| `analysis.infrastructure` | `dev.researchhub.ai.application.GenerationContracts` and `ModelFailure` | The authenticated worker planning transport exchanges the same public model contracts and safe failure codes. |
| `analysis.application` | `dev.researchhub.processing.application.SourceExtraction` | The validated worker profile (`WorkbookMetadata`, `CsvProfile`) is a public application contract of `processing`; `analysis` reads it and never produces it. |
| `ai.application` | `dev.researchhub.workspace.application.WorkspaceAuthorizationService` | Retrieval authorizes before embedding and filters inside SQL. The model gateway authorizes before resolving evidence, rechecks after inference and scopes persisted responses to the workspace. |
| `ai.api` | `dev.researchhub.auth.application.CurrentUserResolver` | The caller comes from the authenticated session, never a request field. |
| `source.application` | `dev.researchhub.ai.application` | Ingestion uses embedding/index/chunk ports and requires complete indexed publication before READY. No vendor dependency. |
| `processing.infrastructure` | `dev.researchhub.ai.application` | The worker transport validates retrieval outputs and maps vendor-neutral embedding failures to durable job retry/error policy. |
| `document.application` | `dev.researchhub.workspace.application.WorkspaceAuthorizationService` | A document's access rule *is* its workspace's. `DocumentService` calls `requireContentReader` and `requireContentEditor`, which return `void` precisely so this edge stays this narrow. |

**The document module never learns what a role is.** It does not import `WorkspaceRole` or
`WorkspaceCapability`, and the two guards it calls return nothing, so the capability table stays inside the
module that owns it instead of spreading into every module that has content to protect. The archived-workspace
`409` is bundled into `requireContentEditor` for the same reason: a content module that had to remember the
check separately would eventually forget it.

`document` must not import `workspace.domain`, `workspace.infrastructure`, `user.domain`, or
`user.infrastructure`. `workspace_id` and `created_by` are bare `UUID`s on both the entity and the domain type,
and the references are enforced by foreign keys.

The session edge is confined to `workspace.api`. `workspace.application` and `workspace.domain` take a
`UUID` and have no idea a session exists, so the authorization rules can be tested — and reused by a
background job or a future endpoint — without an HTTP request. `workspace` must not import `user.domain`,
`user.infrastructure`, or `auth.infrastructure`, and neither `auth` nor `user` may import `workspace`.

Normalization stays behind that boundary too. `workspace` passes the raw address a person typed and
`user.application` trims and lowercases it through `UserEmail`, so the rule that decides account
uniqueness has exactly one implementation. A `workspace` that lowercased the string itself would be
reimplementing it, and would drift the first time the rule changed.

`auth` uses only `UserRegistrationService`, `UserAuthenticationService`, `UserAccount`, `RegisterUserCommand`, and `PasswordPolicy`. `auth.application.CurrentUserResolver` is the one place in `auth` that reads a user, and it goes through `UserAuthenticationService`. It must not import `user.domain` or `user.infrastructure`, and `user` must not import `auth`. Two details keep that honest in both directions:

- `UserAccount.status` is a `String`, not the `UserStatus` enum. Returning the enum would force every reader of `user.application` to import `user.domain`, quietly widening this dependency.
- `user.application` hashes passwords through Spring Security's `PasswordEncoder` interface, not through anything in `auth`. The bean is defined in `auth`, but the type it satisfies is a library interface, so the arrow still points one way.
- `shared` must not depend on `auth`, `user`, `workspace`, `document`, `source`, `processing`, `ai`, `analysis`, `audit`, or the future modules above.
- `config` may use Spring and `shared`. It must not depend on a product module.
- `BackendApplication` stays in `dev.researchhub` so component scan covers `dev.researchhub` and its children. New modules belong under that root.

`shared.api` may depend on `shared.error`. `shared.error` must not depend on `shared.api`, so domain code can throw an error without importing HTTP types.

## What does not belong in shared

`shared` is for cross-cutting mechanics: the REST error contract, shared validation limits, the JPA bootstrap under `shared.infrastructure.persistence`, and later things such as identifiers or time helpers used by several modules.

Product `@Entity` types and Spring Data repositories belong in the owning module, under `dev.researchhub`, so the local scan finds them. They do not belong in `shared`. Schema changes are Flyway migrations, not Hibernate DDL. Details: [persistence.md](persistence.md).

These do not belong in `shared`:

- workspace roles, membership rules, or permission checks — they live in `workspace.domain` and
  `workspace.application`
- document structure
- source parsing
- prompts, retrieval, or citation rules
- analysis formulas or sandbox execution
- a generic base service or repository hierarchy

If a type names a product concept, it belongs in that module.

## GitHub issues

Name the owning module in the issue body:

```text
Module: auth | user | workspace | document | source | processing | ai | analysis | audit | shared
```

Use `shared` only when the change is cross-cutting. A feature that touches a workspace resource is `workspace` even if it also returns an error from `shared`.

## Collaboration module (RH-160–162)

`collaboration.api` uses `auth.application.CurrentUserResolver` only for public credential/checkpoint requests.
`collaboration.application` calls `document.application.DocumentService` for document/workspace authorization,
row locking, provenance validation, editor projections and history; its infrastructure owns only collaboration
binary snapshots and hashed expiring credentials. `document.application.DocumentWriteGuard` is a public extension
port implemented by collaboration infrastructure, preventing legacy replacement after activation without importing
collaboration into the document module. Browser session security and the private service-token filter use separate,
narrowly matched chains. Contract and recovery: [ADR-007](../adr/ADR-007-realtime-document-authoring.md).


`document.application.DocumentSnapshotState` is a public transport-state port implemented by
collaboration infrastructure. Under the existing document row lock it supplies verified binary
snapshot metadata or retires the current collaboration epoch during restore. The document module
owns immutable version rows and has no dependency on collaboration implementation classes.
`ai.application` and `comment.application` call `document.application.DocumentProvenance` only after
explicit validated acceptance in the content transaction. This stores operation/block origins,
not inferred authorship. Scheduled history uses a narrow workspace application guard for active
system content maintenance. Contracts and limitations: [document-origins-and-snapshots.md](document-origins-and-snapshots.md).

## Academic report export

`export` owns the stable, versioned report representation and its DOCX/PDF renderers and LaTeX source bundles. It reads documents,
source versions and saved analysis results through their application APIs, and uses workspace content-reader
capabilities on every public operation. A module-local PostgreSQL queue and dedicated scheduler run expensive
rendering asynchronously. LaTeX emits an editable `.tex` file with PNG assets in a ZIP; compilation stays outside
the backend. Contracts, migrations, limits and validation: [report-export.md](report-export.md).
