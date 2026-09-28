# Configuration

How ResearchHub separates local development, automated tests, and a future cloud deployment. Follow this document instead of inventing a new place for secrets.

Security rules in [docs/context.md](../context.md) still apply, including “Never commit secrets” (section 32).

## Profiles

| Profile | When it is used | Secrets |
| --- | --- | --- |
| `local` | Developer machine. This is the default when no profile is set. | Not in Git. Use environment variables when a later task needs a secret. |
| `test` | `./mvnw test` and other automated tests. | None. Tests must start on a clean machine. |
| `cloud` | A deployed environment, later. | A managed store such as Azure Key Vault. Not wired up yet. |

Shared non-secret defaults live in `backend/src/main/resources/application.yaml`. Each profile adds `application-local.yaml`, `application-test.yaml`, or `application-cloud.yaml` next to that file. Files use the `.yaml` extension.

`BackendApplication` activates `local` when the process does not already name a profile. A normal `./mvnw spring-boot:run` therefore uses `local`. Setting `spring.profiles.default` in `application.yaml` does not change which profile Spring Boot selects, so the default lives in `main` instead. `@SpringBootTest` does not call `main`; tests opt into `test` with `@ActiveProfiles`.

## Activate a profile

Use one of these. An explicit profile replaces the default.

Environment variable:

```bash
SPRING_PROFILES_ACTIVE=local
```

Maven:

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

IntelliJ: open the monorepo root, run `BackendApplication`, and set **Active profiles** to `local`, `test`, or `cloud`. The same field can be left empty for day-to-day work because the default is `local`.

## Defaults and secrets

| Kind of value | Where it goes |
| --- | --- |
| Non-secret default | `application.yaml` or the matching `application-<profile>.yaml` |
| Local secret | Process environment variable. Do not commit it. |
| Cloud secret | Managed secret store, later. The cloud profile only names what must be present. |

`.env` and `.env.*` are gitignored. `.env.example` is the tracked list of names. Spring Boot reads the process environment. It does not read a `.env` file unless a later task adds that on purpose.

Do not add a second local secrets file pattern. If a value is secret, it is an environment variable documented in this file.

## Local workflow

From `backend/`:

```bash
./mvnw spring-boot:run
```

That command uses the `local` profile. `application-local.yaml` contains no cloud secrets. It includes Azurite's
public emulator account and key; those values grant access only to the local emulator and are never reused in cloud.

When a later task needs something like a database URL on your machine, export it in the shell or set it on the IntelliJ run configuration. Copy names from `.env.example` if you keep a private `.env` for your own tools. Do not commit that private file.

## Local PostgreSQL and Azurite

The root `compose.yaml` runs PostgreSQL and the Azure Blob emulator for local development. Both use named volumes, so
ordinary stop/start cycles preserve database rows and uploaded blobs.

```bash
docker compose up -d postgres azurite
```

`application-local.yaml` connects to PostgreSQL with these variables. Each already has a default matching
`compose.yaml`, so the local profile and `docker compose up -d postgres azurite` work together with no environment
variables set:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_HOST` | `localhost` | Host running the Postgres container |
| `DB_PORT` | `5432` | Host port mapped to the container's `5432` |
| `DB_NAME` | `researchhub` | Database name |
| `DB_USER` | `researchhub` | Database role |
| `DB_PASSWORD` | `researchhub` | Password for that role |

Set one to override its default, for example `DB_PORT` when `5432` is already in use. Docker Compose and Spring Boot read the same variable, so exporting it in the shell, or placing it in a private root `.env` (gitignored, loaded automatically by `docker compose`), keeps both in sync.

These are local-only, throwaway defaults, not secrets, and they are unrelated to the cloud profile's `DB_URL`: `DB_URL` is one full JDBC URL required only when the cloud profile is active, while `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` are discrete local values the local profile assembles into its own URL. Neither is reused for the other.

They are also deliberately not named `RESEARCHHUB_*`: see Frontend below for why that prefix is reserved for values that are safe to expose in the browser bundle.

Flyway migrations live in `backend/src/main/resources/db/migration`. The local profile runs them on startup (`spring.flyway.enabled: true`) before JPA uses the schema. Hibernate does not create or update tables: `spring.jpa.hibernate.ddl-auto` is `validate`. Open-session-in-view is off. SQL is not logged unless you opt in.

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.arguments="--researchhub.debug.sql=true"
```

`RESEARCHHUB_DEBUG_SQL=true` is the same switch. It sets `org.hibernate.SQL` to DEBUG for the local profile only. The test and cloud profiles do not turn it on.

If Postgres is stopped or the host, port, or credentials are wrong, startup fails. HikariCP reports that it could not obtain a connection, and the process exits non-zero. It does not start HTTP on a database it cannot reach.

The test and cloud profiles exclude JDBC, Flyway, and JPA auto-configuration, so a test on the `test` profile does not open a database. `./mvnw test` still needs Docker: `FlywayMigrationIntegrationTest` starts its own PostgreSQL 17 container and runs the same `db/migration` files. It does not use the Compose database. Cloud still checks that `DB_URL` is present and does not open a JDBC connection yet. When that connection is added, `ddl-auto` stays `none` or `validate`. Schema changes stay in Flyway. New migration files use `V<version>__<description>.sql` with no leading zeros. `V1__baseline.sql` is immutable.

Persistence rules: [persistence.md](persistence.md). Health probes: [health.md](health.md).

Stop the container, keeping its data:

```bash
docker compose stop postgres
```

Reset it, deleting the named volume and all local data:

```bash
docker compose down -v
```

Azurite runs only the Blob service on host port `10000`, uses image
`mcr.microsoft.com/azure-storage/azurite:3.37.0`, and persists under the named `azurite-data` volume. The backend uses
container `researchhub-sources` and creates it automatically on the first blob operation.

```bash
docker compose stop azurite       # stop, keep uploaded blobs
docker compose start azurite      # the same blobs are available again
docker compose down -v            # intentional reset: removes database and blob volumes
```

The defaults need no environment variables. If port 10000 is occupied, set `AZURITE_BLOB_PORT` for Compose and set
`AZURITE_BLOB_ENDPOINT` to the matching host URL, including `/devstoreaccount1`. The account name, public emulator
key, and container can also be overridden with `AZURITE_ACCOUNT_NAME`, `AZURITE_ACCOUNT_KEY`, and
`AZURITE_CONTAINER_NAME`. None of these local values is read by the cloud profile.

## Test profile

`BackendApplicationTests` is annotated with `@ActiveProfiles("test")`. It loads `application-test.yaml` and does not load the cloud profile.

The test profile has no database, object storage, or API credentials. `./mvnw test` must pass without `DB_URL`, `BLOB_ENDPOINT`, or any other secret in the environment.

## Cloud profile

The cloud profile is a placeholder for deployment. It does not provision Azure or any other host.

Startup fails when a mandatory value is missing or blank. The current mandatory variables are:

| Variable | Purpose |
| --- | --- |
| `DB_URL` | JDBC URL for the primary database |
| `BLOB_ENDPOINT` | Object storage endpoint for source binaries |

`application-cloud.yaml` maps those variables with no default. `CloudEnvironmentProperties` rejects a blank value. Add further mandatory cloud settings to this table and to that properties class in the same change. Do not introduce a one-off secret name in a feature task.

Check the failure locally:

```bash
cd backend
SPRING_PROFILES_ACTIVE=cloud ./mvnw spring-boot:run \
  -Dspring-boot.run.jvmArguments="-Dspring.devtools.restart.enabled=false" \
  -Dspring-boot.run.arguments="--spring.main.web-application-type=none"
```

Maven exits with code 1. The log contains `DB_URL must be set when the cloud profile is active`. The process does not keep serving HTTP. Devtools restart is disabled in this command so a failed start is not reported as a successful Maven build.

Cloud hosts are expected to inject the same variable names from a managed secret store. Azure Key Vault is the likely store later. This repository does not connect to it yet.

## Frontend

Public build-time values use the prefix `RESEARCHHUB_`. `frontend/webpack.config.cjs` injects them with Webpack's `DefinePlugin`, reading them from the environment of the `npm run build` or `npm start` process. Anything with that prefix can end up in the browser bundle.

Never put backend or Azure secrets in frontend configuration. `DB_URL`, `BLOB_ENDPOINT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, storage keys, and API credentials are not `RESEARCHHUB_*` variables.

Variables the frontend build reads today:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESEARCHHUB_API_BASE_URL` | empty string | Origin the API client prefixes onto request paths. Empty means same-origin relative requests. Ends up in the bundle. |
| `RESEARCHHUB_DEV_API_TARGET` | `http://localhost:8080` | Backend the dev server proxies `/api` and `/actuator` to. Build-time only, never in the bundle. |

The default for `RESEARCHHUB_API_BASE_URL` is deliberately empty. The Webpack dev server proxies `/api` and `/actuator` to the backend, so in development the browser calls its own origin on port 3000, the request is forwarded to port 8080, and CORS never comes into play. This stays the default path. Set the variable only when the API really is on another origin, which also means the backend has to allow that origin — see below.

### CORS

The backend also carries an explicit cross-origin policy, for the case where the SPA calls the API origin directly instead of through the proxy. It is a stated rule rather than whatever default happens to apply.

| Setting | Value |
| --- | --- |
| Allowed origins | `researchhub.auth.cors.allowed-origins`, default `http://localhost:3000` |
| Allowed methods | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` |
| Allowed headers | `Content-Type`, `Accept`, `X-XSRF-TOKEN` |
| Credentials | Allowed |
| Paths | `/api/**` and the public health probes |

Defined in `dev.researchhub.auth.infrastructure.SecurityConfiguration`. Two rules are not negotiable:

- **Origins are listed exactly. Never `*`.** A wildcard origin combined with credentialed requests would let any site make authenticated calls with the user's session cookie and read the replies. Browsers reject that pairing, and the configuration fails at startup if `*` appears, because a clear boot failure beats a confusing preflight error later.
- **`X-XSRF-TOKEN` must stay in the allowed headers.** Without it the browser blocks the CSRF header before the request leaves, so every mutating cross-origin call fails.

Add a deployed origin by setting the property, comma-separated. A frontend served from the API's own origin needs no entry at all, which remains the simpler arrangement.

This is additional to the dev proxy, not a replacement for it, and the frontend's credentials mode stays `same-origin` (see [frontend-api.md](frontend-api.md)).

`RESEARCHHUB_DEBUG_SQL` is a backend switch despite the prefix and is not read by the frontend build. Details: [frontend-api.md](frontend-api.md).

## Names for later

Environment variables use uppercase snake case. Concrete variables are added here when a task starts reading them. Examples already reserved for the cloud profile: `DB_URL`, `BLOB_ENDPOINT`. Examples already reserved for local PostgreSQL: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

### Document history

| Setting | Value |
| --- | --- |
| Autosave checkpoint interval | `researchhub.documents.history.autosave-checkpoint-interval`, ISO-8601 duration, default `PT10M` |

How old a document's newest restore point must be before an autosave records another one. A manual save always
records one. Read by `dev.researchhub.document.application.CheckpointPolicy`; `PT0S` records a version on every
autosave, and a negative value fails startup. See [persistence.md](persistence.md#document-versions).

### Sources

| Setting | Value |
| --- | --- |
| Largest source | `researchhub.sources.max-size-bytes`, bytes, default `52428800` (50 MiB). Must be between 1 and 1 GiB, or startup fails. |
| Storage adapter | `researchhub.sources.storage.adapter`; local default `azure-blob`. |
| Blob endpoint | `researchhub.sources.storage.azure-blob.endpoint`; local default `http://127.0.0.1:10000/devstoreaccount1`. |
| Blob account | `researchhub.sources.storage.azure-blob.account-name`; local Azurite default `devstoreaccount1`. |
| Blob container | `researchhub.sources.storage.azure-blob.container-name`; local default `researchhub-sources`, created automatically. |

The adapter also has `account-key`; the committed default is Azurite's public development key, never a cloud key.
Container names, paths, and credentials belong to the chosen adapter's own settings, never to the source module. See
[sources.md](sources.md#storage).
