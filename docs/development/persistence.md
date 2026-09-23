# Persistence

How the backend stores data. Product context for PostgreSQL and Flyway is [docs/context.md](../context.md) section 19. Connection variables and the SQL debug switch are in [configuration.md](configuration.md).

## Who owns the schema

Flyway is the only schema writer. Migrations live in `backend/src/main/resources/db/migration` and are loaded from `classpath:db/migration`. There is no second schema path.

Filename pattern for every new migration:

```text
V<version>__<snake_case_description>.sql
```

`<version>` is the next integer with no leading zeros. `V1` and `V001` are the same Flyway version, so do not zero-pad. `V1__baseline.sql` is already version 1. It is an empty baseline and must not be renamed or edited. The next file, when a module needs a table, is `V2__<description>.sql`. `V2__create_users.sql` is only an example of that name. Do not add the users table until the user module needs it.

Applied files are immutable. A checksum change fails startup (`spring.flyway.validate-on-migrate: true`). Ship a new migration instead of rewriting an old one.

Hibernate `ddl-auto` is `none` on the local profile. Do not set `create`, `create-drop`, or `update` on local or cloud. `validate` is allowed later, once migrations and entities describe the same tables. Production must not rely on Hibernate to create or alter schema.

Flyway runs before JPA uses the database. Spring Boot orders that startup. Do not create tables from `ddl-auto` to skip a migration.

## Profiles

| Profile | Database |
| --- | --- |
| `local` | Connects with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Flyway enabled. JPA `ddl-auto: none`. Open-session-in-view off. JDBC time zone UTC. |
| `test` | JDBC, Flyway, and JPA auto-configuration are excluded. Tests on this profile do not open a database. |
| `cloud` | `DB_URL` is required and is not a JDBC connection yet. The same auto-configuration is excluded. When a later task connects, map `spring.datasource.url` from `DB_URL` and keep `ddl-auto` at `none` or `validate`. |

A wrong host, port, or password on the local profile fails startup. The process exits before it serves HTTP. The log is HikariCP failing to obtain a connection. After the process is up, a later database outage is a readiness failure, not a dead process: [health.md](health.md).

## Where types live

`dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration` is active on the `local` profile. It scans `dev.researchhub` for entities and repositories. There is no global `repositories` package.

A product entity and its repository live in the module that owns the concept, for example `dev.researchhub.workspace`. Map them explicitly: `@Table` and `@Column`, not implicit names. Column length for user-entered text must be at least the matching constant in `dev.researchhub.shared.validation.FieldLengths`.

`shared` does not hold product entities or repositories.

## SQL logging

Off unless `researchhub.debug.sql` is `true` (`RESEARCHHUB_DEBUG_SQL=true` or `--researchhub.debug.sql=true`). That flag is read on the local profile and sets `org.hibernate.SQL` to DEBUG. Test and cloud do not enable it.

## Integration tests

`./mvnw test` runs `FlywayMigrationIntegrationTest` against PostgreSQL 17 in Testcontainers (`postgres:17`, the same image major as `compose.yaml`). That container is ephemeral. It is not the Compose database on port 5432. Docker must be running. A locally installed Postgres server is not required, and `docker compose up` is not required.

Annotate a new persistence test with `@PostgresIntegrationTest`. That annotation starts one PostgreSQL container for the Spring test context, points the datasource at it, uses the `local` profile so Flyway and JPA are enabled, and marks the class `@Transactional`. Classes that use the same annotation share that context and container. Each test method runs in a transaction that rolls back, so inserted rows and DDL from a test do not leak into the next method. Flyway has already committed `db/migration` during context startup, and those migrations stay. Do not reset the schema with Hibernate `create-drop`.

Tests that do not use `@PostgresIntegrationTest` do not start a container. `BackendApplicationTests`, `CloudProfileStartupTests`, `GlobalExceptionHandlerIntegrationTest`, and `NormalizeTest` stay on the `test` profile or a web slice.

Compose remains how you run the application. Testcontainers is only for Maven tests.
