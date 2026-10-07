# Configuration

How ResearchHub separates local development, automated tests, and a future cloud deployment. Follow this document instead of inventing a new place for secrets.

Generation provider settings, versioned feature templates and model parameters (RH-110):
[model-gateway.md](model-gateway.md). Foundry credentials belong only to the worker; the frontend
uses the authenticated Spring gateway. `.env.example` and Compose contain all setting names.

RH-111 adds server feature budgets for total context reservation and packed UTF-8 size, plus exact
text sharing. Defaults, ranges and overflow behavior: [grounded-context.md](grounded-context.md).

RH-112 adds question retrieval limits, temperature and completion limits under
`researchhub.ai.features.workspace-question`: [workspace-questions.md](workspace-questions.md).

RH-113–RH-115 add bounded SSE concurrency, timeout and heartbeat under
`researchhub.ai.conversations.stream`: [research-conversations.md](research-conversations.md).

RH-092 CSV profiles reuse `AI_WORKER_XLSX_ROWS`, `AI_WORKER_XLSX_COLUMNS`,
`AI_WORKER_XLSX_SAMPLES` and `AI_WORKER_PREVIEW_ROWS`; no new runtime setting or package is required.
Count/completeness and schema-only indexing policy: [csv-data-assets.md](csv-data-assets.md).

Security rules in [docs/context.md](../context.md) still apply, including “Never commit secrets” (section 32).

## Profiles

| Profile | When it is used | Secrets |
| --- | --- | --- |
| `local` | Developer machine. This is the default when no profile is set. | Not in Git. Use environment variables when a later task needs a secret. |
| `test` | `./mvnw test` and other automated tests. | None. Tests must start on a clean machine. |
| `demo` | Runnable local product graph, with PostgreSQL-backed sessions for replica demonstrations. | Existing local defaults; inject values for a hosted demo. |
| `azure` | Same product graph with JDBC sessions and the deployed HTTPS browser policy. No infrastructure is provisioned. | Required `DB_URL`, `DB_USER`, `DB_PASSWORD`; inject storage/worker/scrape credentials through the existing settings. |
| `cloud` | A deployed environment, later. | A managed store such as Azure Key Vault. Not wired up yet. |

Shared non-secret defaults live in `backend/src/main/resources/application.yaml`. Each profile adds `application-local.yaml`, `application-test.yaml`, or `application-cloud.yaml` next to that file. Files use the `.yaml` extension.

`demo` and `azure` are profile groups including `local`, so existing product services and Flyway/JPA
remain available without changing their module boundaries. Their session overlay selects JDBC.
The final Azure-only document in `application-local.yaml` overrides local browser settings with
`Secure=true`, the configured `SESSION_COOKIE_SAME_SITE` (default `lax`), no CORS origins by default,
and `DB_URL`/`DB_USER`/`DB_PASSWORD` without development defaults. The original `cloud` profile
remains a configuration scaffold; do not combine it with `demo`/`azure` because it excludes persistence.

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

IntelliJ: open the monorepo root, run `BackendApplication`, and set **Active profiles** to `local`, `test`, `demo`, `azure`, or `cloud`. The same field can be left empty for day-to-day work because the default is `local`.

## Browser sessions (RH-307 / RH-308)

ADR-001's browser contract is unchanged: `JSESSIONID` is the opaque HttpOnly credential,
`BrowserSession` saves the security context through `HttpSessionSecurityContextRepository`,
login rotates an existing session ID, and logout invalidates the session. Workspace permissions
and the account's current database status are checked on the server for each request.
The CSRF repository stays `CookieCsrfTokenRepository`: the SPA reads `XSRF-TOKEN` and echoes it
in `X-XSRF-TOKEN`, including when the next request is handled by another instance.

| Setting | Explicit value / default | Effect |
| --- | --- | --- |
| `researchhub.auth.session-store` / `AUTH_SESSION_STORE` | `servlet` for local/test/cloud scaffold; `jdbc` for demo/azure | The single store selector. Only `jdbc` and `servlet` are accepted. JDBC without a JDBC session repository fails startup. |
| `server.servlet.session.timeout` / `SESSION_TIMEOUT` | `30m` | Idle lifetime. Requests update last access; expired sessions cannot authenticate even before physical cleanup. |
| `spring.session.jdbc.initialize-schema` | `never` | Only Flyway creates or changes the session tables. |
| `spring.session.jdbc.cleanup-cron` / `SESSION_CLEANUP_CRON` | `0 * * * * *` | Six-field Spring cron: cleanup at second zero each minute on each JDBC instance. Deletes expired rows and cascades attributes. |
| `spring.session.jdbc.flush-mode` | `on-save` | Persist session changes when Spring Session saves at response commit. A completed login is visible to another replica. |
| `spring.session.jdbc.save-mode` | `on-set-attribute` | Save attributes explicitly set, avoiding rewriting unchanged attributes on reads. |
| `server.servlet.session.cookie.name` | `JSESSIONID` | Preserve the existing browser/frontend contract instead of Spring Session's default `SESSION`. |
| Session cookie flags | `HttpOnly=true`, `SameSite=lax`, `Secure=true` outside local/demo/test | Azure follows the existing deployment cookie/CORS settings; CSRF cookies remain readable. |

`spring-boot-starter-session-jdbc` and Spring Session versions come from the Spring Boot 4.1.1 BOM.
V36 copies `org/springframework/session/jdbc/schema-postgresql.sql` from its JDBC jar, including
the unique session-ID index, expiry/principal-name indexes, and cascading attribute foreign key.
PostgreSQL folds these unquoted `SPRING_SESSION` / `SPRING_SESSION_ATTRIBUTES` identifiers to lowercase.
Hibernate remains `validate`; Boot's schema initializer is disabled. No separate session datasource,
schema, Redis service or sticky routing is required.

Default JDK serialization stores a `UsernamePasswordAuthenticationToken` with a String user UUID,
null credentials and no authorities. It does not snapshot the user record or workspace roles.
The database remains trusted application state; application releases must keep the stored Spring
Security class format compatible. Existing servlet sessions are not migrated when switching stores:
users sign in again once. JDBC sessions survive compatible application restarts and replica changes.

For a local replica demonstration, start two processes against the same PostgreSQL:

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo -Dspring-boot.run.arguments="--server.port=8080"
# In a second terminal, from backend/:
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo -Dspring-boot.run.arguments="--server.port=8081"
```

Cookie scope uses the hostname and path, so use `localhost` consistently for both ports.
For a hosted demo, enable Secure cookies and inject the deployed browser/CORS policy as documented
in [browser deployment](browser-and-ai-security.md). The `azure` profile already applies that policy.
Shared sessions remove the authentication blocker; the existing local quota adapter, processing,
storage and deployment infrastructure still have their own scaling requirements.

`SharedJdbcSessionIntegrationTest` starts one PostgreSQL Testcontainer and independent applications
on random ports. Its shared `HttpClient`/`CookieManager` proves login A → `/api/me` B, logout B →
captured cookie rejected A, fresh disabled-user checks on both, A-issued CSRF token → mutation B,
and stopping A → continued access B. It also stops both instances and proves the same cookie works
after a full restart, reads persisted bytes through `ObjectInputStream`, checks fixation protection,
deployed cookie flags, scheduled expiry cleanup and cascading deletion. A servlet negative control
asserts that the very same cross-replica identity assertion fails with 401.
`FlywayMigrationIntegrationTest` checks the shipped schema, indexes, keys and cascade.

Run all checks with Docker available:

```bash
cd backend
./mvnw verify
```

JaCoCo enforces at least 80% line and branch coverage for the complete `auth` module and writes
`backend/target/site/jacoco-auth/index.html`. The existing authentication/CSRF tests stay unchanged.
Framework references: [Boot Spring Session](https://docs.spring.io/spring-boot/4.1/reference/web/spring-session.html),
[JDBC repository](https://docs.spring.io/spring-session/reference/api/java/org/springframework/session/jdbc/JdbcIndexedSessionRepository.html).

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

## Local PostgreSQL, Azurite, and processing worker

The root `compose.yaml` runs PostgreSQL, the Azure Blob emulator, and the internal Python worker for local development.
PostgreSQL and Azurite use named volumes, so
ordinary stop/start cycles preserve database rows and uploaded blobs.

```bash
docker compose up -d postgres azurite ai-worker
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

The worker listens on `localhost:${AI_WORKER_PORT:-8090}`. Spring targets
`AI_WORKER_BASE_URL` (default `http://127.0.0.1:8090`) and creates fresh internal requests without end-user
credentials. It authenticates with `AI_WORKER_SERVICE_TOKEN`; Compose and the local Spring profile share an explicit
localhost-only default, while deployments must inject a high-entropy value from secret configuration.
`AI_WORKER_REQUEST_TIMEOUT` defaults to `PT30S`. Dispatcher variables and failure semantics are listed
in [processing.md](processing.md). If the published port changes, set the base URL to match. Stopping `ai-worker` is
safe: committed jobs remain in PostgreSQL and are retried.

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

RH-243 external web discovery is optional and separate from uploaded evidence. The backend local
profile accepts `EXTERNAL_SEARCH_ENABLED=false`, `BRAVE_SEARCH_API_KEY` (required when enabled),
and `EXTERNAL_SEARCH_TIMEOUT=PT8S` (positive, at most 30 seconds). Keep the provider key out of
frontend build variables. Users must explicitly enable discovery for every search; existing AI
and report source contracts remain workspace-only. See [source-search-and-external-evidence.md](source-search-and-external-evidence.md).

### Durable processing

| Setting | Value |
| --- | --- |
| Dispatcher enabled | `researchhub.processing.dispatcher.enabled`; `PROCESSING_DISPATCHER_ENABLED`, default `true`. |
| Poll delay | `researchhub.processing.dispatcher.fixed-delay`; `PROCESSING_FIXED_DELAY`, default `PT1S`. |
| Batch size | `researchhub.processing.dispatcher.batch-size`; `PROCESSING_BATCH_SIZE`, default `4`, range 1–100. |
| Attempt limit | `researchhub.processing.dispatcher.max-attempts`; `PROCESSING_MAX_ATTEMPTS`, default `5`, range 1–100. |
| Retry delay | `initial-backoff` / `max-backoff`; `PROCESSING_INITIAL_BACKOFF` / `PROCESSING_MAX_BACKOFF`, defaults `PT2S` / `PT1M`. |
| Stale lease | `researchhub.processing.dispatcher.stale-timeout`; `PROCESSING_STALE_TIMEOUT`, default `PT5M`. |
| Worker URL | `researchhub.processing.worker.base-url`; `AI_WORKER_BASE_URL`, default `http://127.0.0.1:8090`. |
| Worker published port | Compose-only `AI_WORKER_PORT`, default `8090`; keep the worker URL in sync. |
| Worker timeout | `researchhub.processing.worker.request-timeout`; `AI_WORKER_REQUEST_TIMEOUT`, default `PT30S`. |
| Signed source lifetime | `researchhub.processing.worker.source-access-ttl`; `AI_WORKER_SOURCE_ACCESS_TTL`, default `PT5M`, maximum `PT15M`. |
| Worker credential | `researchhub.processing.worker.service-token`; `AI_WORKER_SERVICE_TOKEN`, minimum 32 characters. |

Durations are ISO-8601 and must be positive. The full state, retry, and internal contract reference is
[processing.md](processing.md).


Retrieval now requires pgvector, enabled through Flyway V14. Local Compose/Testcontainers
use `pgvector/pgvector:0.8.2-pg17-bookworm`. The default worker embedding provider is
`AI_WORKER_EMBEDDING_PROVIDER=deterministic`; `azure` requires endpoint, API key,
deployment, model name, immutable model version and dimension via `AZURE_EMBEDDING_*`.
These are worker-only server secrets/configuration, never frontend values. Full bounds
and migration/rebuild instructions: [source-retrieval.md](source-retrieval.md).


### Source comparison and potential differences (RH-124–125)

The existing AI worker/provider handles these features. Server-owned output/token/context settings
are `AI_SOURCE_ANALYSIS_MAX_OUTPUT_TOKENS` (6144), `AI_SOURCE_ANALYSIS_TEMPERATURE` (0 or `none`),
`AI_SOURCE_ANALYSIS_CONTEXT_MAX_TOKENS` (98304) and `AI_SOURCE_ANALYSIS_CONTEXT_MAX_BYTES` (65536).
[Source analysis](source-analysis.md) describes bounds, contracts and the offline/Foundry provider distinction.
