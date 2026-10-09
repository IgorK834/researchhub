# Configuration

Production build/runtime contracts: [containers](containers.md). For the synthetic local demo,
shared environment-based state and replica identifiers, see [two-replica demo](../../scripts/demo/README.md).
`INSTANCE_ID` / `researchhub.instance-id` selects a bounded diagnostic hostname/replica identifier;
the default is the hostname resolved before logging starts. Every backend response carries
`X-Replica-Id`, and structured application logs include `replicaId`.

How ResearchHub separates local development, automated tests, and Azure deployment. Follow this document instead of inventing a new place for secrets.

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

Profiles select infrastructure adapters and connection/security settings. Product services, controllers,
repositories, dispatchers and policies are unconditional; an incomplete runtime fails startup instead of serving a partial application.

| Profile | Source bytes | Sessions | Cost quotas | Sandbox runner | Model/planner/embedding provider | Database |
| --- | --- | --- | --- | --- | --- | --- |
| `local` (default in `main`) | Azure Blob SDK with public Azurite defaults | Servlet memory (JDBC can be selected explicitly) | Memory (PostgreSQL can be selected explicitly) | Local Docker, disabled unless explicitly enabled | HTTP Python worker, localhost default | Local PostgreSQL defaults; Flyway + JPA validation |
| `demo` | Same local adapters (`demo` includes `local`) | JDBC | PostgreSQL | Local Docker, disabled by default | HTTP Python worker | Same local PostgreSQL; shared replica state |
| `azure` | Azure Blob SDK, required HTTPS `BLOB_ENDPOINT`, externally provisioned container | JDBC, required | PostgreSQL, required | Unavailable; no Docker runner bean | HTTP Python worker, required URL/token | Managed PostgreSQL, required credentials; Flyway + JPA validation |
| `cloud` (deprecated) | Identical to `azure`; profile group alias for one release | JDBC | PostgreSQL | Unavailable | HTTP Python worker | Identical to `azure` |
| `test` | Explicit test fixtures only | Servlet in HTTP slices | Explicit fixtures when needed | Explicit fixtures when needed | Explicit fixtures when needed | No JDBC/JPA in infrastructure slices; persistence/full product tests explicitly start Testcontainers |

`azure` does **not** activate `local` and cannot be combined with `local` or `test`. `cloud` maps to
`azure` in `application.yaml`; existing deployment commands can keep the old name for this release,
then must switch `SPRING_PROFILES_ACTIVE` to `azure`. Shared product policies live in `application.yaml`;
`application-local.yaml` supplies development adapters and `application-azure.yaml` is the deployment contract.
No Azure resources are provisioned by these profiles.

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
| `researchhub.auth.session-store` / `AUTH_SESSION_STORE` | `servlet` for local/test slices; `jdbc` for demo/azure/cloud | The single store selector. Only `jdbc` and `servlet` are accepted. JDBC without a JDBC session repository fails startup. |
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

These are local-only, throwaway defaults. Local assembles its URL from `DB_HOST`/`DB_PORT`/`DB_NAME`;
Azure/cloud require the full `DB_URL` and explicitly supplied `DB_USER`/`DB_PASSWORD`, without local fallbacks.

They are also deliberately not named `RESEARCHHUB_*`: see Frontend below for why that prefix is reserved for values that are safe to expose in the browser bundle.

Flyway migrations live in `backend/src/main/resources/db/migration`. The local profile runs them on startup (`spring.flyway.enabled: true`) before JPA uses the schema. Hibernate does not create or update tables: `spring.jpa.hibernate.ddl-auto` is `validate`. Open-session-in-view is off. SQL is not logged unless you opt in.

```bash
cd backend
./mvnw spring-boot:run -Dspring-boot.run.arguments="--researchhub.debug.sql=true"
```

`RESEARCHHUB_DEBUG_SQL=true` is the same switch. It sets `org.hibernate.SQL` to DEBUG for the local profile only. The test and cloud profiles do not turn it on.

If Postgres is stopped or the host, port, or credentials are wrong, startup fails. HikariCP reports that it could not obtain a connection, and the process exits non-zero. It does not start HTTP on a database it cannot reach.

Only the `test` profile excludes JDBC, Flyway and JPA auto-configuration. Tests using it load explicit infrastructure slices, without scanning the full product graph. `./mvnw test` still needs Docker: persistence and full-profile tests start PostgreSQL Testcontainers and run `db/migration`; they never use the Compose database. Azure/cloud enable all persistence auto-configuration, run Flyway and validate entity mappings. New migration files use `V<version>__<description>.sql` with no leading zeros. `V1__baseline.sql` is immutable.

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
`AI_WORKER_REQUEST_TIMEOUT` defaults to `PT120S`. Dispatcher variables and failure semantics are listed
in [processing.md](processing.md). If the published port changes, set the base URL to match. Stopping `ai-worker` is
safe: committed jobs remain in PostgreSQL and are retried.

## Test profile

`BackendApplicationTests`, browser security and actuator tests load the explicit
`HttpSecurityTestApplication` infrastructure slice on `test`; they do not use profile guards to remove
product services. Database tests use `local` plus Testcontainers, and `AzureProfileStartupIntegrationTest`
boots the actual `azure` application against PostgreSQL and HTTPS Azurite. No deployment secrets are needed.
`LocalProfileBeanGraphTests` checks a fixed product bean list and proves that deleting a required bean fails the assertion.

## Azure deployment contract (RH-311 / RH-312)

`CloudEnvironmentConfiguration` validates settings after ConfigData and **before bean creation**, including
when the deprecated `cloud` alias is selected. Missing or blank values fail with the variable name;
secret values are never included in this validation error.

| Required variable | Purpose |
| --- | --- |
| `DB_URL` | Managed PostgreSQL JDBC URL, including deployment TLS settings (for example `sslmode=verify-full` with the trusted CA) |
| `DB_USER`, `DB_PASSWORD` | Database credentials; no local fallback |
| `BLOB_ENDPOINT` | HTTPS Blob service endpoint without embedded credentials, query or fragment |
| `BLOB_CONNECTION_STRING` | Key-based credential required for the current `BLOB_AUTH=connection-string` adapter; the configured endpoint remains authoritative |
| `AI_WORKER_BASE_URL` | Internal HTTP(S) Python worker URL; no localhost fallback |
| `AI_WORKER_SERVICE_TOKEN` | Worker service credential, at least 32 characters, no surrounding whitespace |
| `METRICS_SCRAPE_TOKEN` | Separate metrics bearer credential with the same minimum length |

`BLOB_CONTAINER_NAME` defaults to `researchhub-sources`; infrastructure must provision it. Startup and
uploads cannot create a container in Azure. The existing managed-identity seam remains reserved for Task
21.17; selecting it currently fails explicitly rather than falling back to a key or an emulator.
Provider credentials remain in the Python worker. Do not inject Foundry credentials into Java or the frontend.

Azure fixes `researchhub.auth.session-store=jdbc`, `researchhub.security.quotas.store=postgres` and
`researchhub.sources.storage.adapter=azure-blob`. Changing these to local stores fails startup.
`ANALYSIS_SANDBOX_ENABLED` defaults to `false` and setting it to `true` fails until an Azure runner exists.
There is no `DockerSandboxRunner` bean under Azure. Planning and inspection remain available; execution
is recorded as `FAILED` with the existing API `failureCode=SANDBOX_UNAVAILABLE`, preserving the request and provenance.

Flyway is enabled and is the only schema writer; JPA uses `ddl-auto=validate`, open-in-view is disabled,
and Spring Session uses `initialize-schema=never`. Azure/cloud exclude no datasource, Flyway or JPA auto-configuration.
The provisioned database must permit the existing Flyway migrations, including the `vector` extension for V14;
configure the managed server extension allowlist/privileges in Epic 21 before rollout.
Session cookies are Secure/HttpOnly, with `SESSION_COOKIE_SAME_SITE=lax` by default. CORS defaults to same-origin;
use exact HTTPS `CORS_ALLOWED_ORIGINS` if needed. `FORWARD_HEADERS_STRATEGY=none` trusts no forwarding headers by
default. Set `framework` or `native` only behind an ingress that strips untrusted client forwarding headers
and supplies authoritative values. Azure resources/ingress are the deployment task's responsibility.

Only health and Prometheus are exposed by actuator. Health details stay hidden; readiness includes PostgreSQL.
`/actuator/prometheus` requires `Authorization: Bearer <METRICS_SCRAPE_TOKEN>` and never uses browser authentication.

Check missing configuration locally:

```bash
cd backend
SPRING_PROFILES_ACTIVE=azure ./mvnw spring-boot:run \
  -Dspring-boot.run.jvmArguments="-Dspring.devtools.restart.enabled=false"
```

Without the required environment Maven exits nonzero and names `DB_URL` before opening infrastructure connections.
`cloud` has the same failure contract. Deployment injects these variable names from its secret configuration.

### Per-replica database pool (RH-314)

| Hikari property | Variable | Default (milliseconds for time values) |
| --- | --- | --- |
| `maximum-pool-size` | `DB_POOL_MAX_SIZE` | `8` |
| `minimum-idle` | `DB_POOL_MIN_IDLE` | `2` |
| `connection-timeout` | `DB_POOL_CONNECTION_TIMEOUT_MS` | `3000` |
| `max-lifetime` | `DB_POOL_MAX_LIFETIME_MS` | `240000` |
| `leak-detection-threshold` | `DB_POOL_LEAK_DETECTION_THRESHOLD_MS` | `0`; staging sets `20000` |

The infrastructure contract requires a server/network idle cutoff **greater than 240 seconds**, normally
at least 300 seconds. If a shorter cutoff is selected, lower `DB_POOL_MAX_LIFETIME_MS` below it. Check the actual
PostgreSQL/network/PgBouncer policy; Hikari's own idle timeout is a separate setting. Leak detection reports
suspected long checkouts; it does not reclaim connections.

Replica capacity, scheduler sharing, the smallest-tier worked example, Bicep validation and the Task 21.15
alert contract are in [the connection budget](persistence.md#connection-budget-and-autoscaling-rh-314).

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
| Blob container | `researchhub.sources.storage.azure-blob.container-name`; default `researchhub-sources`; cloud container is provisioned by infrastructure. |
| Cloud endpoint | `BLOB_ENDPOINT` required on `azure`, HTTPS without credentials; no Azurite defaults. |
| Cloud auth | `researchhub.sources.storage.azure.auth` / `BLOB_AUTH`: `connection-string` or `managed-identity`. |
| Connection string | `researchhub.sources.storage.azure.connection-string` / `BLOB_CONNECTION_STRING`: required for `azure` key-based auth; inject as a secret. |
| Container provisioning | `azure-blob.create-container=true` locally; `create-container-on-startup=false` unless `BLOB_CREATE_CONTAINER_ON_STARTUP=true`. Both are disabled on `azure`. |

The adapter also has `account-key`; the committed default is Azurite's public development key, never a cloud key.
Container names, paths, and credentials belong to the chosen adapter's own settings, never to the source module. See
[sources.md](sources.md#storage).

RH-243 external web discovery is optional and separate from uploaded evidence. Every runtime profile accepts `EXTERNAL_SEARCH_ENABLED=false`, `BRAVE_SEARCH_API_KEY` (required when enabled),
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
| Worker URL | `researchhub.processing.worker.base-url`; `AI_WORKER_BASE_URL`, local/demo default `http://127.0.0.1:8090`; required in Azure/cloud. |
| Worker published port | Compose-only `AI_WORKER_PORT`, default `8090`; keep the worker URL in sync. |
| Worker timeout | `researchhub.processing.worker.request-timeout`; `AI_WORKER_REQUEST_TIMEOUT`, default `PT120S`. |
| Signed source lifetime | `researchhub.processing.worker.source-access-ttl`; `AI_WORKER_SOURCE_ACCESS_TTL`, default `PT5M`, maximum `PT15M`. |
| Worker credential | `researchhub.processing.worker.service-token`; `AI_WORKER_SERVICE_TOKEN`, minimum 32 characters. |

Durations are ISO-8601 and must be positive. The full state, retry, and internal contract reference is
[processing.md](processing.md).


Retrieval now requires pgvector, enabled through Flyway V14. Local Compose/Testcontainers
use `pgvector/pgvector:0.8.2-pg17-bookworm`. An empty `AI_WORKER_EMBEDDING_PROVIDER`
auto-selects Gemini when `GEMINI_API_KEY` is present,
otherwise deterministic; explicit `deterministic` overrides that choice. `azure` requires endpoint, API key,
deployment, model name, immutable model version and dimension via `AZURE_EMBEDDING_*`.
These are worker-only server secrets/configuration, never frontend values. Full bounds
and migration/rebuild instructions: [source-retrieval.md](source-retrieval.md).


### Source comparison and potential differences (RH-124–125)

The existing AI worker/provider handles these features. Server-owned output/token/context settings
are `AI_SOURCE_ANALYSIS_MAX_OUTPUT_TOKENS` (6144), `AI_SOURCE_ANALYSIS_TEMPERATURE` (0 or `none`),
`AI_SOURCE_ANALYSIS_CONTEXT_MAX_TOKENS` (98304) and `AI_SOURCE_ANALYSIS_CONTEXT_MAX_BYTES` (65536).
[Source analysis](source-analysis.md) describes bounds, contracts and the offline/Foundry provider distinction.

### Shared costly-operation quotas (RH-309 / RH-310)

`COST_QUOTA_STORE=memory|postgres` selects the adapter under `researchhub.security.quotas.store`. Local defaults to
memory; demo defaults to PostgreSQL and azure/cloud require PostgreSQL. All replicas must use identical quota policies and synchronized UTC clocks.
Flyway V37 owns `cost_quota_bucket`; no Hibernate schema generation or Redis is involved. PostgreSQL history retention
is `COST_QUOTA_RETENTION=P7D` (must cover the configured window), retries are bounded by `COST_QUOTA_MAX_ATTEMPTS=3`
(total attempts, 1–10), and `COST_QUOTA_CLEANUP_CRON=0 0 * * * *` runs hourly (`-` disables cleanup). The existing
20/60 LLM, 10/30 analysis and 60/180 retrieval limits per minute are unchanged. Full contract and contention evidence:
[upload-and-cost-controls.md](upload-and-cost-controls.md).

### OpenAI-compatible worker providers (RH-318)

Chat and embeddings are independently selected with `AI_WORKER_MODEL_PROVIDER=openai-compatible`
and `AI_WORKER_EMBEDDING_PROVIDER=openai-compatible`. Empty selectors auto-select Gemini with its key,
otherwise deterministic; production
may keep `foundry` chat and `azure` embeddings. Main/demo Compose pass credentials only to the worker.

| Variable | Required when | Value |
| --- | --- | --- |
| `OPENAI_COMPAT_BASE_URL` | Either compatible adapter | HTTPS API base; no credentials/query/fragment/traversal. Vendor API prefix allowed; bare origin gets `/v1`. |
| `OPENAI_COMPAT_API_KEY` | Either compatible adapter | Secret Bearer key, no whitespace. **Worker only.** |
| `OPENAI_COMPAT_MODEL` | Compatible chat | Exact requested/returned model name. |
| `OPENAI_COMPAT_MODEL_VERSION` | Compatible chat | Pinned release/deployment revision recorded in provenance. |
| `OPENAI_COMPAT_EMBEDDING_MODEL` | Compatible embeddings | Exact requested/returned embedding model. |
| `OPENAI_COMPAT_EMBEDDING_VERSION` | Compatible embeddings | Immutable vector-space revision; changes require source reprocessing. |
| `OPENAI_COMPAT_EMBEDDING_DIMENSION` | Compatible embeddings | Integer 1–4,096; validated per vector and stored with model metadata. |

Timeout, caps, no redirects, fallback/repair and embedding rebuild semantics are specified in
[model gateway](model-gateway.md#openai-compatible-chat-and-embeddings-rh-318). Secrets must never be
frontend variables or Java domain configuration. Python runtime/packages remain pinned; no schema or
runtime dependency is added. `SSL_CERT_FILE` is the standard Python trust-store override for private
CAs; never disable certificate verification. The optional evaluation helper uses `RH_LOCAL_MODEL_KEY`
as a temporary loopback-only test Bearer value and optional hosted keys inherited from the environment;
it does not expose production credentials. [Demo evaluation](ai-evaluation.md) documents candidates,
thresholds, pricing, current public-demo terms and the single rerun command.

### Native Gemini worker provider

An empty/unset generation or embedding provider selector chooses `gemini` when
`GEMINI_API_KEY` is nonempty, otherwise `deterministic`. Explicit selectors take precedence.
Foundry/Azure and optional compatible providers remain supported. Main/demo Compose deliver
the following settings exclusively to the worker. The demo helper reads only provider settings
from the ignored root `.env`; process environment overrides them. It excludes provider settings
and credentials from Spring and frontend build processes.

| Variable | Default | Contract |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Only required setting; private worker secret sent in `x-goog-api-key`, never in a URL. |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | HTTPS API prefix without credentials/query/fragment/traversal; an origin gets `/v1beta`. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Native model ID, without `models/`. |
| `GEMINI_MODEL_VERSION` | `gemini-3.8-flash-ga-native-v2` | Provenance/profile revision. This GA alias and application policy are not an immutable vendor weight snapshot. Re-evaluate after changes. |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Native text embedding model with task-aware batch embedding support. |
| `GEMINI_EMBEDDING_VERSION` | `gemini-embedding-001-retrieval-l2-v1` | Persisted vector-space revision, including task-aware retrieval and L2 normalization. |
| `GEMINI_EMBEDDING_DIMENSION` | `768` | Integer 128–3072, validated per vector; recommend 768/1536/3072. Changes require reprocessing. |
| `GEMINI_THINKING_LEVEL` | `low` | `low`, `medium`, `high`; private reasoning is not requested or exposed. |
| `GEMINI_PLANNING_THINKING_LEVEL` | `medium` | Separate thinking level for generating scientific programs. |
| `GEMINI_REQUEST_TIMEOUT_SECONDS` | `30` | Finite 1–60 seconds per transport request. |
| `GEMINI_OPERATION_TIMEOUT_SECONDS` | `90` | Finite value at least the request timeout, at most 90; shared across retries/fallback/repair or an embedding batch operation. |

Empty optional variables also use these defaults. Spring's worker read timeout is `PT120S`,
SSE lifetime is `PT180S`, and workspace/grounded answer output reservation is 4096 tokens to
accommodate thinking plus validated JSON. Existing feature-specific overrides remain supported.
Standard `SSL_CERT_FILE` / `SSL_CERT_DIR` overrides retain certificate verification; a Python
installation missing its default CA bundle can use the OS CA bundle automatically.

The helper explicitly reprocesses demo sources via authenticated HTTPS when embedding identity
changes. Checkpoints make it resumable; the old vector space is never relabeled. Other workspaces
must use their existing authorized source **Reprocess** action. No schema migration is needed.
