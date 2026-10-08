# Persistence

How the backend stores data. Product context for PostgreSQL and Flyway is [docs/context.md](../context.md) section 19. Connection variables and the SQL debug switch are in [configuration.md](configuration.md).

## Who owns the schema

Flyway is the only schema writer. Migrations live in `backend/src/main/resources/db/migration` and are loaded from `classpath:db/migration`. There is no second schema path.

Filename pattern for every new migration:

```text
V<version>__<snake_case_description>.sql
```

`<version>` is the next integer with no leading zeros. `V1` and `V001` are the same Flyway version, so do not zero-pad. `V1__baseline.sql` is already version 1. It is an empty baseline and must not be renamed or edited.

Applied migrations:

| Version | File | Adds |
| --- | --- | --- |
| 1 | `V1__baseline.sql` | Nothing. Empty immutable baseline. |
| 2 | `V2__create_users.sql` | `users`, owned by the `user` module. |
| 3 | `V3__create_workspaces.sql` | `workspaces`, owned by the `workspace` module. |
| 4 | `V4__create_workspace_members.sql` | `workspace_members`, owned by the `workspace` module. |
| 5 | `V5__add_workspace_archival.sql` | `workspaces.archived_at` and `archived_by`, plus `ck_workspaces_archived_together`. |
| 6 | `V6__create_documents.sql` | `documents`, owned by the `document` module. |
| 7 | `V7__create_document_versions.sql` | `document_versions` and its immutability trigger, owned by the `document` module. |
| 8 | `V8__create_sources.sql` | `sources` and the trigger that keeps each original input immutable, owned by the `source` module. |
| 9 | `V9__add_source_failure_summary.sql` | Nullable `sources.failure_summary` plus the constraint tying it exactly to `FAILED`. |
| 10 | `V10__create_processing_jobs.sql` | Durable `processing_jobs`, idempotent resource identity, retry state checks, claim index, and immutable identity trigger. |
| 11 | `V11__create_source_extractions.sql` | Validated current extraction with scoped source/job identities. |
| 12 | `V12__version_source_processing.sql` | Processing generations and immutable successful extraction-run journal. |
| 13 | `V13__create_source_retrieval_chunks.sql` | Current versioned retrieval manifests and grounded source spans. |
| 14 | `V14__index_source_embeddings.sql` | pgvector extension, versioned embedding namespaces, scoped search projection and job stage. |
| 15 | `V15__audit_model_generations.sql` | Workspace-scoped model call trace, versioned template/parameter/input hash, bounded provenance, successful structured output and safe failure code. |
| 16 | `V16__create_ai_conversations.sql` | Workspace research conversations, visible questions and complete answers with citations/model/template/usage; idempotent request identities and attempt leases. |

| 17 | `V17__create_ai_authoring_suggestions.sql` | Source-grounded authoring suggestions and acceptance events. |
| 18 | `V18__create_ai_source_analyses.sql` | Immutable source comparisons and potential-difference analyses with provenance. |
| 19 | `V19__version_sources_and_dataset_previews.sql` | Immutable `source_versions` (existing sources become version 1, blobs untouched), the active-version projection and its triggers, job → version binding, per-version extraction and retrieval snapshots, and `ai_source_analysis_sources` (the exact versions an analysis consumed). See [source-versions.md](source-versions.md). |

The next migration is `V20__<description>.sql`.

Research history is created only by Flyway. Assistant messages must be complete; partial streaming
fragments are never persisted. Composite workspace ownership, unique turn identities and bounded
JSON checks complement server authorization. Lifecycle/retention and upgrade strategy:
[research-conversations.md](research-conversations.md).

`workspaces` and `workspace_members` are two migrations rather than one because they are two tables with
two owners of meaning: one is the boundary, the other is who may cross it. Splitting them also keeps each
file readable. They are applied together and neither is useful alone.

Applied files are immutable. A checksum change fails startup (`spring.flyway.validate-on-migrate: true`). Ship a new migration instead of rewriting an old one.

Hibernate `ddl-auto` is `validate` on every runtime profile, now that entities exist. Flyway still creates every table; `validate` only makes Hibernate check at startup that the entities match the schema the migrations produced, so a mapping that drifts from a migration fails immediately instead of failing later on a query. Do not set `create`, `create-drop`, or `update` on any profile. Production must not rely on Hibernate to create or alter schema.

Flyway runs before JPA uses the database. Spring Boot orders that startup. Do not create tables from `ddl-auto` to skip a migration.

## Profiles

| Profile | Database |
| --- | --- |
| `local` | Local `DB_HOST`/`DB_PORT`/`DB_NAME` defaults; Flyway enabled, JPA validation, open-in-view off, UTC. |
| `demo` | Local adapter settings plus JDBC sessions and PostgreSQL quotas. |
| `azure` | Required `DB_URL`, `DB_USER`, `DB_PASSWORD`; full PostgreSQL product graph, Flyway and JPA validation; capped Hikari pool. |
| `cloud` | Deprecated one-release alias of `azure`, with identical persistence requirements. |
| `test` | JDBC/Flyway/JPA auto-configuration excluded only for explicit infrastructure slices. Full product tests use local/azure and Testcontainers. |

A wrong host, port, or password on the local profile fails startup. The process exits before it serves HTTP. The log is HikariCP failing to obtain a connection. After the process is up, a later database outage is a readiness failure, not a dead process: [health.md](health.md).

## Where types live

`dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration` unconditionally scans
`dev.researchhub` for entities. Spring Boot's JPA repository auto-configuration scans the same application
root whenever a datasource/JPA runtime is available, regardless of profile. There is no global `repositories` package.

A product entity and its repository live in the module that owns the concept, for example `dev.researchhub.workspace`. Map them explicitly: `@Table` and `@Column`, not implicit names. Column length for user-entered text must be at least the matching constant in `dev.researchhub.shared.validation.FieldLengths`.

`shared` does not hold product entities or repositories.

Today that is:

| Table | Entity and repository | Module invariants |
| --- | --- | --- |
| `users` | `user.infrastructure.UserEntity`, `UserRepository` | `user.domain`: `User`, `UserEmail`, `PasswordHash`, `UserStatus` |
| `workspaces` | `workspace.infrastructure.WorkspaceEntity`, `WorkspaceRepository` | `workspace.domain`: `Workspace`, including the rename, describe, and archive rules |
| `workspace_members` | `workspace.infrastructure.WorkspaceMemberEntity`, `WorkspaceMemberRepository` | `workspace.domain`: `WorkspaceMembership`, `WorkspaceMembers`, `WorkspaceRole`, `WorkspaceCapability` |
| `documents` | `document.infrastructure.DocumentEntity`, `DocumentRepository` | `document.domain`: `Document`, `DocumentContent`, `DocumentContentFormat` |
| `sources` | `source.infrastructure.SourceEntity`, `SourceRepository` | `source.domain`: `Source`, `SourceType`, `SourceStatus`, `SourceFilename`, `StorageKey` |
| `processing_jobs` | `processing.infrastructure.PostgresProcessingJobQueue` (JDBC, no JPA entity) | `processing.domain`: `ProcessingJob`, its status graph, bounded safe error, and attempt ceiling |
| `document_versions` | `document.infrastructure.DocumentVersionEntity`, `DocumentVersionRepository` | `document.domain`: `DocumentVersion`, `DocumentVersionReason`; when to snapshot is `document.application.CheckpointPolicy` |

In each case the entity is the persistence representation and converts in both directions; the rules live
in the module's `domain`.

### Two things the workspace tables do differently

**No mapped association across a module boundary.** `workspaces.created_by` and
`workspace_members.user_id` are plain `uuid` columns, not `@ManyToOne` references to `UserEntity`. The
`workspace` module must not import `user.infrastructure` (see
[backend-architecture.md](backend-architecture.md)), so the reference is declared as a foreign key in the
migration and enforced by the database. No user column is copied onto either table; a caller that needs an
email reads it through the `user` module.

**Repositories that cannot list everything.** `WorkspaceRepository`, `WorkspaceMemberRepository`, and
`DocumentRepository` extend Spring Data's bare `Repository` marker rather than `JpaRepository`, which would
inherit `findAll()`. A workspace is a security boundary, so a method returning every workspace — or every
membership, or every document — in the database is not something that should exist to be called by mistake.
Every read is by id, by an explicit set of ids, or scoped to one user or workspace. `JpaRepository` is still
the right default for a table that is not a boundary, as `users` shows.

`DocumentRepository` goes one step further: it has no `findById` at all. **Every read takes the workspace id
as well**, so `findByWorkspaceIdAndId` is the only way to reach a document. A document id is exactly the kind
of value that ends up in a URL and gets tried against another workspace, and this is what makes that a query
matching no row rather than a forgotten `if`. A new workspace-owned table should follow the same shape.

### Documents

`documents` is the first workspace-owned content table, so it sets the pattern the rest will follow:

- `workspace_id` is a plain `uuid` with a foreign key and **no referential action**, like every other
  reference in this schema. The owning module does not import `workspace.infrastructure`, so the relationship
  is enforced by the database rather than by a mapped association.
- `created_by` references `users (id)`, never `workspace_members`, because authorship survives somebody
  leaving the team.
- `content` is `jsonb`, not `text`. That is what lets `ck_documents_content_is_object` reject an array, a
  string, or a number — all valid JSON, none of them a document — regardless of which code wrote the row.
- `content_format` is pinned to `PROSEMIRROR_JSON` by a check constraint. HTML and plain text are not stored
  formats: a format that can carry markup would make every renderer a sanitizer.
- `PROSEMIRROR_JSON` is the version tag for the body, and there is no `schemaVersion` inside the JSON. The
  frontend editor is Tiptap, and it saves `editor.getJSON()` unchanged. Adding a Tiptap node or mark does not
  change the format, because every body that was valid before is still valid, so it needs no migration. The
  backend does not validate the ProseMirror schema, so it needs no change either. A shape that existing rows
  would not fit is a new `DocumentContentFormat` value, widened into the check constraint by a Flyway
  migration that also says what happens to the old rows. It is never an in-place conversion, and never HTML.
- `ck_documents_content_size` bounds the row at `FieldLengths.DOCUMENT_CONTENT_MAX_BYTES`, measured on
  PostgreSQL's canonical serialization. It exists because nothing else bounds it yet — without chunking or a
  CRDT, every save stores the whole document.
- `revision` is a plain `bigint` starting at 1, not a Hibernate `@Version`. The client reads it and sends it
  back, and a stale value is refused with `409`. Hiding the token would leave the API unable to say that
  somebody else saved first.
- `archived_at` is a soft archive, exactly as on `workspaces`. Nothing deletes a document row.

- A revision-checked write (save or restore) reads the row with `SELECT ... FOR UPDATE`
  (`DocumentRepository.findForUpdateByWorkspaceIdAndId`). Without the lock, two saves carrying the same
  revision could both pass the comparison and the second would overwrite the first. With it, the second waits
  and is refused. Autosave makes that timing ordinary, not rare.

### Document versions

`document_versions` holds restore points, not every revision. `documents` keeps the current text; a version is
an immutable copy of one revision's content, taken at a milestone:

| `reason` | When |
| --- | --- |
| `CREATED` | The document is created (revision 1). |
| `MANUAL_SAVE` | A save with `saveKind` `MANUAL`, which is also the default when a client sends none. |
| `AUTOSAVE_CHECKPOINT` | A save with `saveKind` `AUTOSAVE`, when the newest version is at least `researchhub.documents.history.autosave-checkpoint-interval` old (default ten minutes), or there is none. |
| `RESTORE` | A restore. `restored_from_version_id` names the version whose text was restored, and `ck_document_versions_restore_source` makes that column set for exactly this reason. |

- **Immutable.** `DocumentVersionEntity` is `@Immutable` with every column `updatable = false`, and
  `tg_document_versions_immutable` refuses `UPDATE` and `DELETE` from any writer. Tests that clear the table use
  `TRUNCATE`, which the row trigger does not cover and no application path issues.
- **Restoring never rewinds.** The restored text becomes the document's next revision, under the same revision
  check as a save, and is recorded as a `RESTORE` version. Every version in between stays.
- **One version per revision**, by `uq_document_versions_document_revision`, which is also the index for "this
  document's history, newest first".
- **Scoped like documents.** There is no `workspace_id`. Every read takes the document id, and the caller finds
  the document through its workspace first, so a version id tried against another document matches no row.
- **Content only.** A version stores `content` and `content_format`, not the title; restoring keeps the current
  title. `content_format` is stored per version so a future format migration has to say what happens to history
  too.
- **No backfill.** V7 created no versions for existing documents. Their history starts at their next milestone.

### Sources

`sources` holds metadata about uploaded files. The bytes live in object storage under `storage_key`. The table follows
the `documents` pattern (workspace-owned, `workspace_id` with no referential action, a user id for authorship) and
adds three rules of its own. The full reference is [sources.md](sources.md).

- **Closed type mapping.** `ck_sources_source_type` allows only `PDF`, `DOCX`, `XLSX`, `CSV`, and `TXT`, and
  `ck_sources_media_type_matches_type` pairs each type with exactly one canonical media type.
- **Opaque keys.** `ck_sources_storage_key_format` accepts only `sources/<uuid v4>`, and `uq_sources_storage_key`
  keeps two rows from sharing bytes. A key is never derived from the file name and never used to find a row.
  `SourceRepository` has no lookup by key.
- **Immutable original.** The uploaded bytes live in `source_versions`; `tg_source_version_input_is_immutable` (V19)
  refuses any change to a version's input and any delete. `sources` keeps a stable `id`, `workspace_id` and `created_at`
  (never updatable) and projects its **active** version: `tg_sources_original_is_immutable` (V19) lets the file columns
  move only as a complete copy of one of that source's own versions (`fk_sources_active_version` is composite and
  deferred so a source and its first version insert in one transaction). `display_name`, `status`,
  `failure_summary` and `updated_at` may change. A replacement file is a new version, never an update.
- `size_bytes` is between 1 and 1 GiB (`ck_sources_size_bytes`). The configured per-source limit is at most that.
  `content_sha256` is lowercase hex (`ck_sources_content_sha256_format`).
- `ck_sources_failure_summary_matches_status` requires a concise summary for `FAILED` and requires it to be null for
  every other status. The value is capped at 1000 characters and is metadata visible to workspace members.

`SourceRepositoryIntegrationTest` proves each of these against PostgreSQL, including hand-written `UPDATE`s that the
trigger refuses.

### Processing jobs

`processing_jobs` is both the durable queue and the attempt ledger. It deliberately uses a JDBC adapter rather than a
JPA entity because claim is one PostgreSQL-specific `FOR UPDATE SKIP LOCKED` CTE/update statement. The unique
`(job_type, resource_type, resource_id)` key identifies duplicate enqueue requests; the UUID primary key is the
worker delivery idempotency key. `workspace_id` is a foreign key, while `resource_id` is a typed generic reference
whose allowed combinations are closed by the job/resource check constraints.

The state-field check requires exactly the timestamps, retry time, and safe error appropriate for each status.
`attempt_count` is 0–100, error text is paired and bounded, and the identity trigger prevents retargeting a job.
Detailed exceptions never enter this table. See [processing.md](processing.md) for claiming, retry, and recovery.

### Archiving does not delete

A workspace is retired by setting `archived_at` and `archived_by`, never by deleting the row. docs/context.md
sections 3.3 and 3.4 require sources, documents, and analysis results to stay traceable, and an archive that
removed the workspace they hang off would destroy that provenance — so archive is a state change, and there
is deliberately no `DELETE /api/workspaces/{id}`.

Two rules follow, and they bind every workspace-owned table added later:

- **A workspace-owned table references `workspaces (workspace_id)` with no `ON DELETE CASCADE`**, and no
  other `ON DELETE` or `ON UPDATE` action. Nothing in this schema may remove a row as a side effect of
  another row going away. `FlywayMigrationIntegrationTest` asserts that no foreign key in the schema has a
  referential action and that neither workspace table has a trigger.
- **Archiving must not delete or schedule deletion of those rows, or of stored files.** No membership is
  removed, so nobody loses access to the history; and when documents, sources, analyses, AI conversations,
  and audit events exist, archiving their workspace must leave their rows and their blobs in place. If a
  retention policy is ever needed, it is a separate, explicit feature — not a consequence of archiving.

### Removing a member removes access, not authorship

`DELETE /api/workspaces/{id}/members/{userId}` deletes exactly one `workspace_members` row. It is the only
delete in the module, and the same preservation rule applies to it:

- **An authorship column stores a user id and references `users (id)`, never `workspace_members`.**
  `workspaces.created_by` and `archived_by` already do this, and the document, source, analysis, comment,
  and audit tables must follow: who wrote something is a fact about a person, not about their current
  access. A foreign key to a membership row would make authorship disappear the moment somebody left the
  team, which is exactly the provenance docs/context.md sections 3.3 and 3.4 require to survive.
- **No `ON DELETE CASCADE` from `workspace_members`, and no trigger.** Removing a membership must not
  delete, null, or reassign a single row that records what that person did. `WorkspaceMemberApiIntegrationTest`
  asserts that after a removal the user row, the workspace row, and `workspaces.created_by` are all intact.

A removed member keeps their account and their login session. They are simply no longer a member, which
their next request discovers as the usual `404`.

The two columns are set together, and `ck_workspaces_archived_together` enforces that: a row recording when
it was archived but not by whom, or the reverse, is a state no reader could interpret. Archiving is
idempotent, and the original `archived_at` wins, so a retried request cannot rewrite when a workspace
actually left active use.

Reads split accordingly. `GET /api/workspaces` filters `archived_at IS NULL` inside the membership-scoped
query, so an archived workspace leaves the list without the database ever returning it.
`GET /api/workspaces/{id}` still returns it to its members with `archivedAt` set. A non-member gets the same
`404` either way.

### Timestamps

Every timestamp column is `timestamptz` and is mapped to `java.time.Instant`. The value comes from the
`Clock` bean in `dev.researchhub.config.TimeConfiguration` (`Clock.systemUTC()`), injected into the
application service that performs the write, and is passed into the domain factory as a parameter so the
timestamps are deterministic in tests. Do not call `Instant.now()` in a service or an entity.

`timestamptz` rather than `timestamp` so a value carries its offset and no reader has to guess a zone; the
local profile additionally sets `hibernate.jdbc.time_zone: UTC`. Hand-written SQL in a test has to convert
— the PostgreSQL driver rejects an `Instant` parameter because it cannot infer the SQL type — which is
what `UserRowFixture.timestamp(Instant)` does. Hibernate does that conversion for the entities.

## Identifiers

Primary keys are `uuid`, **UUID version 7**, generated by the application on insert:

```java
@Id
@UuidGenerator(style = UuidGenerator.Style.VERSION_7)
@Column(name = "id", nullable = false, updatable = false)
private UUID id;
```

One strategy for every entity. Migrations therefore give `id` **no** `DEFAULT`: `gen_random_uuid()` in the schema would be a second source of identifiers, and an entity that sometimes generates and sometimes defers is the kind of ambiguity that produces surprising nulls. Do not mix application-generated ids and database defaults.

Version 7 rather than version 4 because a v7 UUID starts with a millisecond timestamp, so newly inserted rows sort near each other in the primary-key index. Random v4 keys scatter inserts across the whole index. That still leaks approximate creation time, which is acceptable for these ids and no worse than the `created_at` column next to them.

## Normalized columns

When uniqueness must ignore case or surrounding whitespace, store the normal form in its own column and put the unique constraint on that column, rather than on a function index over the raw value.

`users` does this: `email` keeps what the user typed, trimmed, and `normalized_email` is that value lowercased with `Locale.ROOT`, carrying `uq_users_normalized_email`. The domain type derives the normal form so a caller cannot supply a mismatched one, `V2__create_users.sql` additionally checks `normalized_email = lower(btrim(normalized_email))`, and the uniqueness rule itself is enforced only by the database, because no single object can know whether another row already uses an address.

Locale matters: lowercasing with the JVM default would turn `I` into a dotless `ı` in a Turkish locale, so the same address would normalize differently depending on where the server runs.

## SQL logging

Off unless `researchhub.debug.sql` is `true` (`RESEARCHHUB_DEBUG_SQL=true` or `--researchhub.debug.sql=true`). That flag is read on the local profile and sets `org.hibernate.SQL` to DEBUG. Test and cloud do not enable it.

## Integration tests

`./mvnw test` runs `FlywayMigrationIntegrationTest` against PostgreSQL 17 in Testcontainers (`postgres:17`, the same image major as `compose.yaml`). That container is ephemeral. It is not the Compose database on port 5432. Docker must be running. A locally installed Postgres server is not required, and `docker compose up` is not required.

`UserRepositoryIntegrationTest` runs on the same container and is the proof for the `users` table: a second account whose email differs only by case, or only by surrounding whitespace, is rejected by `uq_users_normalized_email`, and the stored `password_hash` is the supplied hash and never a plaintext password.

`WorkspaceRepositoryIntegrationTest` is the equivalent proof for the workspace tables: a second membership
for the same `(workspace_id, user_id)` is rejected by `uq_workspace_members_workspace_user`, a role outside
`OWNER`/`EDITOR`/`VIEWER` is rejected by `ck_workspace_members_role`, a workspace or membership pointing at
a user or workspace that does not exist is rejected by its foreign key, a blank name is rejected by
`ck_workspaces_name_not_blank` even when the domain type is bypassed, half-recorded archival is rejected by
`ck_workspaces_archived_together`, an archived workspace is left out of the membership-scoped list by the
query itself, and neither table has a column copied from `users`.

`DocumentRepositoryIntegrationTest` is the proof for `documents`: a document cannot be inserted without a real
workspace or a real author, a query for one workspace never returns another's document, and the column rejects
content that is not a JSON object, content over the size limit, an unknown format, a blank title, and a
revision below 1. `DocumentVersionRepositoryIntegrationTest` does the same for `document_versions`, including
that a hand-written `UPDATE` or `DELETE` is refused by the trigger.

Authorization is proved over HTTP rather than here, because it is about what a particular signed-in user may
do: `WorkspaceApiIntegrationTest` covers cross-user isolation and that a membership row is what grants
visibility, `WorkspaceMetadataApiIntegrationTest` covers the owner-only workspace routes for every role,
`WorkspaceMemberApiIntegrationTest` covers the roster, and `DocumentApiIntegrationTest` covers the document
routes — including the case that a document reached through the wrong workspace is a `404` even for a caller
who belongs to both. `DocumentHistoryApiIntegrationTest` covers autosave, the history routes, restore, and two
saves racing on the same revision. They share the cookie-jar client in `dev.researchhub.support.ApiBrowser`, and each
instance of it is one person with their own session.

`WorkspaceCreationTransactionIntegrationTest` is deliberately **not** `@Transactional`, unlike everything
else above. It proves that a workspace and its owner membership are committed together, and a
test-managed transaction would hide exactly that: the service would join the test's transaction, so the
rollback under test would be indistinguishable from the rollback the test performs anyway. It cleans rows
in `@BeforeEach` instead. Copy that shape for any other test about what a service's own transaction
commits.

Annotate a new persistence test with `@PostgresIntegrationTest`. That annotation starts one PostgreSQL container for the Spring test context, points the datasource at it, uses the `local` profile so Flyway and JPA are enabled, and marks the class `@Transactional`. Classes that use the same annotation share that context and container. Each test method runs in a transaction that rolls back, so inserted rows and DDL from a test do not leak into the next method. Flyway has already committed `db/migration` during context startup, and those migrations stay. Do not reset the schema with Hibernate `create-drop`.

`BackendApplicationTests`, browser/actuator security tests and `GlobalExceptionHandlerIntegrationTest` use
explicit infrastructure or web slices. `CloudProfileStartupTests` validates configuration and missing-variable
failures without opening infrastructure. `LocalProfileBeanGraphTests` and `AzureProfileStartupIntegrationTest`
boot the complete product using PostgreSQL Testcontainers; the Azure test additionally uses HTTPS Azurite.

Compose remains how you run the application. Testcontainers is only for Maven tests.

## Connection budget and autoscaling (RH-314)

Every Azure replica has one Hikari datasource, shared by JPA, JDBC stores, sessions, quotas and scheduled work.
The runtime cap is `DB_POOL_MAX_SIZE=8`, with two idle connections and a three-second checkout timeout.
No module creates another production pool. Increasing replicas multiplies that cap, even when replicas are idle.

Deployment must satisfy:

```text
maxReplicas x (poolSize + scheduler headroom) <= 0.8 x max_connections
```

Scheduler headroom is a **conservative budget allowance**, not an additional datasource: use two connections
per replica for product scheduling/session cleanup. All actual checkouts still count inside the Hikari cap.
The 20% margin covers migration/startup, administration and other connections. Also subtract Azure's reserved
connections, other applications, parallel rollout replicas and maintenance jobs before accepting the result.
Use the stricter of this formula and 80% of the remaining user-connection limit.

Worked smallest-tier example: Azure Flexible Server **B1ms** (1 vCore / 2 GiB) has a documented default
`max_connections=50`, of which **35 are available to users**. Two replicas at pool size eight with two headroom:
`2 x (8 + 2) = 20 <= 0.8 x 50 = 40`, and `20 <= 0.8 x 35 = 28`. Three replicas would budget 30 and exceed the
stricter user limit, so this example caps at two, including any surge during rollout. Read the provisioned
`SHOW max_connections` and current reserved limits rather than inferring them solely from a SKU.
Source: [Microsoft PostgreSQL limits](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits).

`ProcessingJobDispatcher` claims and processes a bounded batch sequentially; `AnalysisExecutionDispatcher`
and `ExportDispatcher` claim one job per tick. `DocumentSnapshotScheduler` visits at most 100 candidates sequentially.
They inject the same JDBC/JPA infrastructure and do not create pools. Claim/update transactions finish before
worker HTTP, sandbox execution or report rendering; document snapshots use a transaction per document, with no
transaction around the scheduler loop. Thus one expensive background operation cannot retain the whole request pool.
Spring currently has one `ThreadPoolTaskScheduler`, `exportScheduler` (one thread); it also serves unqualified
product schedules. Spring Session cleanup can run independently. The headroom allowance covers both.
A bounded pool is not a strict request/background priority partition: slow SQL, lock contention or session/quota
traffic can still saturate it. Monitor waiters and timeouts; do not increase job concurrency without recalculating
this budget and load-testing requests. There is no separate scheduler datasource or fairness guarantee.

Hikari `max-lifetime=240000` ms must be shorter than the deployment's server/network idle cutoff (contract:
>=300 seconds). Set staging `DB_POOL_LEAK_DETECTION_THRESHOLD_MS=20000`; production defaults to zero.
Use [Hikari's lifetime/timeout guidance](https://github.com/brettwooldridge/HikariCP#configuration-knobs-baby)
when adapting to a different managed timeout; PostgreSQL idle-in-transaction and idle-session limits are distinct.

Micrometer/Prometheus already exports `hikaricp.connections.active`, `.idle`, `.pending`, `.max`, `.timeout` and
`.acquire` through the scrape-token-protected endpoint. Task **21.15** should alert per replica on
`active / max >= 0.8` for five minutes, warn on sustained pending checkouts, and page on new connection timeouts
or readiness failures. Prometheus names include `hikaricp_connections_active`, `hikaricp_connections_max`,
`hikaricp_connections_pending` and `hikaricp_connections_timeout_total`; retain instance/replica and pool labels.

**Epic 21 Bicep parameter validation contract:** parameters `maxReplicas`, backend pool size, scheduler headroom
and the managed database connection limit must reference this section. Reject a parameter set violating either
budget before deployment; include revision surge and other consumers. Render `DB_POOL_MAX_SIZE` from the same
pool-size parameter used in validation, so code and deployment cannot diverge. This repository has no Azure Bicep
module yet; RH-314 records its required validation rather than introducing infrastructure outside this change.

Evidence: `CloudProfileStartupTests` asserts every Hikari default and staging override;
`AzureProfileStartupIntegrationTest` checks the real single datasource and pool gauges after Flyway startup,
and executes sessions, Blob storage and the unavailable-sandbox API. Profile graph tests assert all four scheduled
product components. Transaction/claim behavior is covered by the processing, export and analysis integration suites.
