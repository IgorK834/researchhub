# ResearchHub

ResearchHub is a collaborative AI workspace for students and researchers. A group shares source materials, writes a report in the same workspace, and uses AI that stays grounded in those sources. Charts, tables, calculations, and generated claims should keep provenance back to the source file, source fragment, dataset, or executed analysis.

This repository is in active development and is not production-ready.

Architecture and product context: [docs/context.md](docs/context.md).

RH-112 adds source-grounded questions on the workspace page, authorized selected-source retrieval,
traceable citations and explicit no-evidence results. API/configuration/testing:
[Workspace questions](docs/development/workspace-questions.md).

RH-113–RH-115 add durable workspace research conversations, a panel beside the document editor,
versioned citation links and SSE progress with complete-answer persistence:
[Research conversations](docs/development/research-conversations.md).

Profiles, environment variables, and where secrets must not go: [docs/development/configuration.md](docs/development/configuration.md).

Backend module rules: [docs/development/backend-architecture.md](docs/development/backend-architecture.md). REST error contract: [docs/development/api-errors.md](docs/development/api-errors.md). Request validation rules and shared length limits: [docs/development/validation.md](docs/development/validation.md). Health probes: [docs/development/health.md](docs/development/health.md).

## Stack

- Backend: Java 25, Spring Boot 4.1.1, Maven
- Frontend: React, TypeScript, Webpack, npm

The first Python AI/data boundary lives under `ai-worker/`: an internal source-ingest worker called by the durable
PostgreSQL-backed dispatcher. Extraction, chunking and provider-neutral embeddings are implemented; Spring transactionally indexes
the resulting chunks in pgvector.

## Directory structure

```text
researchhub/
├── backend/       Spring Boot application (dev.researchhub)
├── frontend/      React + TypeScript application
├── ai-worker/     Internal Python processing worker
├── contracts/     Versioned Java/Python processing fixtures
├── docs/          Project context and development docs
├── compose.yaml   Local PostgreSQL, Azurite, and AI worker
├── .editorconfig
├── .gitignore
├── .env.example
└── README.md
```

## Prerequisites

- JDK 25 (`JAVA_HOME` or `java` on `PATH`)
- Node.js and npm
- Docker and Docker Compose, for local PostgreSQL and Azure Blob emulation
- Python 3.13.3 (pinned in `ai-worker/.python-version`)
- uv 0.12.20 for local AI-worker dependency management (not needed when using Compose)

## Local PostgreSQL and Blob Storage

The backend's `local` profile connects to PostgreSQL, started from the root `compose.yaml`:

```bash
docker compose up -d postgres azurite ai-worker
```

That starts PostgreSQL on `localhost:5432`, Azurite Blob on `localhost:10000`, and the internal Python worker on
`localhost:8090`. Named volumes
`postgres-data` and `azurite-data` preserve database rows and uploaded source files across restarts. The backend creates
the `researchhub-sources` blob container automatically on first use.

```bash
docker compose stop postgres azurite ai-worker  # stop, keep rows and blobs
docker compose down -v                # intentional reset: remove both named volumes
```

Override the host, port, database name, user, or password with the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` environment variables; `docker compose` and the backend's `local` profile read the same names. Details, defaults, and how this differs from the cloud profile's `DB_URL`: [docs/development/configuration.md](docs/development/configuration.md).

## Backend

From `backend/`:

```bash
cd backend
./mvnw test
./mvnw spring-boot:run
```

`./mvnw test` needs Docker. Integration tests start PostgreSQL 17 and Azurite containers with Testcontainers and do
not use the Compose services above. `./mvnw verify` enforces at least 80% line coverage independently for the source
processing and AI/retrieval modules.
`./mvnw spring-boot:run` still uses Compose.

`./mvnw spring-boot:run` starts `dev.researchhub.BackendApplication` on the `local` profile, which does need the PostgreSQL container above running. No server port is set in `application.yaml`, so Spring Boot serves HTTP on port 8080.

Open this repository from the monorepo root in IntelliJ (not `backend/` alone) and import `backend/pom.xml` as a Maven project so the backend module is available. The root `.editorconfig` sets UTF-8, LF, 4-space Java and Python indentation, and 2-space TypeScript, JSON, and YAML indentation. Recent IntelliJ versions apply that file with the bundled EditorConfig plugin.

## AI worker

From `ai-worker/`:

```bash
cd ai-worker
uv sync --frozen
uv run --frozen researchhub-worker
uv run --frozen pytest
```

The worker's process probe is `GET http://127.0.0.1:8090/health`. Its internal execution endpoints accept versioned,
service-token-authenticated source-ingest, embedding and model contracts and carry no browser session or end-user token. It has no product
PostgreSQL dependency or business API routes. Canonical Java/Python fixtures live in `contracts/processing/v4`.
`pytest` enforces at least 80% coverage. Durable state, authorization, retry policy, and idempotent job identity remain
in Spring/PostgreSQL; see [docs/development/processing.md](docs/development/processing.md).

## Frontend

From `frontend/`:

```bash
cd frontend
npm ci
npm start          # webpack-dev-server on http://localhost:3000
npm run build       # type-checks with tsc, then production build to frontend/dist/
```

`npm install` is an alternative to `npm ci` when you are not installing from the lockfile.

The dev server runs on port 3000 (the backend uses 8080, see above) and serves `index.html`
for unknown paths (`historyApiFallback`), so client-side routes work on direct refresh. It also
proxies `/api` and `/actuator` to the backend on port 8080, so the browser stays same-origin and
the backend needs no CORS configuration. Start the backend to see live data; the UI renders a
typed error when it is down.

Checks, all non-interactive and CI-ready:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint, zero warnings allowed
npm run format:check  # prettier --check
npm test              # jest
npm run build         # typecheck + production build
```

`npm run format` fixes formatting. Tool choices and the division of labour between `tsc`, ESLint,
and Prettier: [docs/development/frontend-tooling.md](docs/development/frontend-tooling.md).

`src/` layout and where new feature code belongs: [docs/development/frontend-structure.md](docs/development/frontend-structure.md).
HTTP client, typed API errors, and TanStack Query conventions: [docs/development/frontend-api.md](docs/development/frontend-api.md).

Routing uses `react-router-dom` (`src/app/AppRouter.tsx`). Everything under `/app` is behind a session guard:

```text
/login                                                   implemented
/register                                                implemented
/app                                                     (layout route, shows the workspace list)
/app/workspaces                                          implemented: list and create
/app/workspaces/:workspaceId                             implemented: detail, members, owner settings, archive
/app/workspaces/:workspaceId/documents/:documentId       placeholder
*                                                        (Not Found page)
```

RH-090/RH-091/RH-093: PDF/DOCX/XLSX extraction is implemented end to end. See
[Source extraction](docs/development/source-extraction.md) for provenance, parser limits, cloud OCR evaluation and verification.

Retrieval chunk schema, versioning and structure-aware chunking: [source-retrieval.md](docs/development/source-retrieval.md).


Retrieval (RH-102–RH-105): normal PDF/DOCX/TXT ingestion now embeds and indexes chunks
before READY. [ADR-002](docs/adr/ADR-002-retrieval.md) selects PostgreSQL + pgvector;
[retrieval contracts/API/configuration](docs/development/source-retrieval.md) describe
workspace isolation, hybrid search and model rebuilds. Offline embedding is the default;
Azure model selection is configured solely in the Python worker. Recreate the local
PostgreSQL 17 container with the new Compose image (preserve the named volume) and rebuild
the worker together with the backend. Previously READY sources need explicit reprocessing
before search. No Azure AI Search service is provisioned by this change.

RH-110: the central structured model gateway is implemented with workspace-scoped evidence,
versioned templates, model/usage metadata, Flyway-owned call audit, deterministic test provider
and a selectable Foundry-compatible adapter. [Model gateway](docs/development/model-gateway.md)
documents contracts, configuration and E2E checks; [ADR-003](docs/adr/ADR-003-model-gateway.md)
records the boundary and deferred product workflows.

RH-111: [grounded context](docs/development/grounded-context.md) now assigns local citation keys,
packs escaped source titles/locations/text, shares exact duplicate text and rejects budget overflow
before inference. Its mapping is preserved in audited responses and rendered by the frontend.
