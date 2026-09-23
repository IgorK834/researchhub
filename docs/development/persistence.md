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

The next migration is `V5__<description>.sql`.

`workspaces` and `workspace_members` are two migrations rather than one because they are two tables with
two owners of meaning: one is the boundary, the other is who may cross it. Splitting them also keeps each
file readable. They are applied together and neither is useful alone.

Applied files are immutable. A checksum change fails startup (`spring.flyway.validate-on-migrate: true`). Ship a new migration instead of rewriting an old one.

Hibernate `ddl-auto` is `validate` on the local profile, now that entities exist. Flyway still creates every table; `validate` only makes Hibernate check at startup that the entities match the schema the migrations produced, so a mapping that drifts from a migration fails immediately instead of failing later on a query. Do not set `create`, `create-drop`, or `update` on any profile. Production must not rely on Hibernate to create or alter schema.

Flyway runs before JPA uses the database. Spring Boot orders that startup. Do not create tables from `ddl-auto` to skip a migration.

## Profiles

| Profile | Database |
| --- | --- |
| `local` | Connects with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Flyway enabled. JPA `ddl-auto: validate`. Open-session-in-view off. JDBC time zone UTC. |
| `test` | JDBC, Flyway, and JPA auto-configuration are excluded. Tests on this profile do not open a database. |
| `cloud` | `DB_URL` is required and is not a JDBC connection yet. The same auto-configuration is excluded. When a later task connects, map `spring.datasource.url` from `DB_URL` and keep `ddl-auto` at `validate` or `none`. |

A wrong host, port, or password on the local profile fails startup. The process exits before it serves HTTP. The log is HikariCP failing to obtain a connection. After the process is up, a later database outage is a readiness failure, not a dead process: [health.md](health.md).

## Where types live

`dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration` is active on the `local` profile. It scans `dev.researchhub` for entities and repositories. There is no global `repositories` package.

A product entity and its repository live in the module that owns the concept, for example `dev.researchhub.workspace`. Map them explicitly: `@Table` and `@Column`, not implicit names. Column length for user-entered text must be at least the matching constant in `dev.researchhub.shared.validation.FieldLengths`.

`shared` does not hold product entities or repositories.

Today that is:

| Table | Entity and repository | Module invariants |
| --- | --- | --- |
| `users` | `user.infrastructure.UserEntity`, `UserRepository` | `user.domain`: `User`, `UserEmail`, `PasswordHash`, `UserStatus` |
| `workspaces` | `workspace.infrastructure.WorkspaceEntity`, `WorkspaceRepository` | `workspace.domain`: `Workspace` |
| `workspace_members` | `workspace.infrastructure.WorkspaceMemberEntity`, `WorkspaceMemberRepository` | `workspace.domain`: `WorkspaceMembership`, `WorkspaceMembers`, `WorkspaceRole`, `WorkspaceCapability` |

In each case the entity is the persistence representation and converts in both directions; the rules live
in the module's `domain`.

### Two things the workspace tables do differently

**No mapped association across a module boundary.** `workspaces.created_by` and
`workspace_members.user_id` are plain `uuid` columns, not `@ManyToOne` references to `UserEntity`. The
`workspace` module must not import `user.infrastructure` (see
[backend-architecture.md](backend-architecture.md)), so the reference is declared as a foreign key in the
migration and enforced by the database. No user column is copied onto either table; a caller that needs an
email reads it through the `user` module.

**Repositories that cannot list everything.** `WorkspaceRepository` and `WorkspaceMemberRepository` extend
Spring Data's bare `Repository` marker rather than `JpaRepository`, which would inherit `findAll()`. A
workspace is a security boundary, so a method returning every workspace — or every membership — in the
database is not something that should exist to be called by mistake. Every read is by id, by an explicit
set of ids, or scoped to one user or workspace. `JpaRepository` is still the right default for a table
that is not a boundary, as `users` shows.

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
`ck_workspaces_name_not_blank` even when the domain type is bypassed, and neither table has a column
copied from `users`.

`WorkspaceCreationTransactionIntegrationTest` is deliberately **not** `@Transactional`, unlike everything
else above. It proves that a workspace and its owner membership are committed together, and a
test-managed transaction would hide exactly that: the service would join the test's transaction, so the
rollback under test would be indistinguishable from the rollback the test performs anyway. It cleans rows
in `@BeforeEach` instead. Copy that shape for any other test about what a service's own transaction
commits.

Annotate a new persistence test with `@PostgresIntegrationTest`. That annotation starts one PostgreSQL container for the Spring test context, points the datasource at it, uses the `local` profile so Flyway and JPA are enabled, and marks the class `@Transactional`. Classes that use the same annotation share that context and container. Each test method runs in a transaction that rolls back, so inserted rows and DDL from a test do not leak into the next method. Flyway has already committed `db/migration` during context startup, and those migrations stay. Do not reset the schema with Hibernate `create-drop`.

Tests that do not use `@PostgresIntegrationTest` do not start a container. `BackendApplicationTests`, `CloudProfileStartupTests`, `GlobalExceptionHandlerIntegrationTest`, and `NormalizeTest` stay on the `test` profile or a web slice.

Compose remains how you run the application. Testcontainers is only for Maven tests.
