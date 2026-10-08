# ResearchHub

Local portfolio demo (Java 25, Node/npm, Python 3.13 and Docker installed):
`scripts/demo/up.sh`. See [demo deployment](docs/deployment/demo.md) for generated logins,
local HTTPS, reset and end-to-end checks.

Browser deployment and prompt-injection protection (RH-182/RH-183), including environment settings,
CSP hosting requirements and evaluation commands: [browser and AI security](docs/development/browser-and-ai-security.md).
Repository scans, blocking findings and warning policy: [repository security](docs/development/repository-security.md).

ResearchHub is a collaborative AI workspace for students and researchers. A group shares source materials, writes a report in the same workspace, and uses AI that stays grounded in those sources. Charts, tables, calculations, and generated claims should keep provenance back to the source file, source fragment, dataset, or executed analysis.

This repository is in active development and is not production-ready.

Architecture and product context: [docs/context.md](docs/context.md).

RH-112 adds source-grounded questions on the workspace page, authorized selected-source retrieval,
traceable citations and explicit no-evidence results. API/configuration/testing:
[Workspace questions](docs/development/workspace-questions.md).

RH-113–RH-115 add durable workspace research conversations, a panel beside the document editor,
versioned citation links and SSE progress with complete-answer persistence:
[Research conversations](docs/development/research-conversations.md).

RH-120–RH-122 add source-grounded draft sections, selected-fragment rewrite suggestions and evidence
for human-written claims, with explicit approval, idempotent insertion and AI-origin provenance:
[AI-assisted authoring](docs/development/ai-authoring.md).

Public landing page, pricing copy and how its screenshots are regenerated: [docs/development/landing-page.md](docs/development/landing-page.md).

Profiles, environment variables, and where secrets must not go: [docs/development/configuration.md](docs/development/configuration.md).

Production image contracts: [containers](docs/development/containers.md).
Synthetic RC fixtures, real sandbox seeding and two replicas: [demo](scripts/demo/README.md).
Repeatable k6 scenarios and evidence: [performance](performance/README.md) and
[scalability](docs/architecture/scalability.md).
Recorded local validation: [2026-10-08 two-instance report](performance/results/2026-10-08-local-two-instance/README.md).

Upload hardening and costly-operation quotas: [docs/development/upload-and-cost-controls.md](docs/development/upload-and-cost-controls.md).

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
├── ai-worker/     Internal Python processing and planning worker
├── sandbox/       Pinned, isolated scientific Python runtime
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

`./mvnw test` needs Docker and the pinned AI-worker environment. Build `researchhub-sandbox:1.1.1` first with
`docker build -t researchhub-sandbox:1.1.1 sandbox` from the repository root for the real computation E2E tests.
Integration tests start PostgreSQL 17 and Azurite containers with Testcontainers and do not use the Compose services above. `./mvnw verify` enforces at least 80% line coverage independently for the source
processing, AI/retrieval and analysis modules. `ANALYSIS_SANDBOX_TESTS=true ./mvnw verify` additionally enables
the real Docker runner attack/cleanup tests.
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

RH-090–RH-093: PDF/DOCX/CSV/XLSX extraction is implemented end to end. See
[Source extraction](docs/development/source-extraction.md) for provenance, parser limits, cloud OCR evaluation and verification.

RH-092 [CSV data assets](docs/development/csv-data-assets.md) add encoding/delimiter handling,
inferred types, bounded samples, row-count completeness and missing-value summaries. CSV RAG indexes
only schema metadata; older CSV sources need authorized reprocessing to adopt the new profile/index.

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


RH-123–RH-125: [Structured citations and source analysis](docs/development/source-analysis.md)
add stable editor references with dynamic numbering, selected-source comparison tables and cited,
AI-assisted interpretations of potential differences. Results preserve provenance and do not
change documents automatically; missing research fields stay missing.

RH-130: [immutable source versions](docs/development/source-versions.md). Replacing a spreadsheet or paper adds a new
version instead of changing bytes: older versions and their blobs stay downloadable, processing is pinned to the version
a job was created for, and every analysis records the exact versions it consumed. A follow-up uses the original versions
unless the user explicitly chooses the latest. See [ADR-005](docs/adr/ADR-005-immutable-source-versions.md).

RH-131–RH-132: [dataset inspection](docs/development/dataset-inspection.md). A bounded, formula-inert preview of a CSV/XLSX
version (sheets, dimensions, header, inferred types, missing values, sample rows, explicit truncation warnings) is served
by the Spring API from the worker's stored profile and shown on the source page with an **Analyze this data** action.
Shared Java/Python contract and fixtures: [`contracts/analysis/dataset-preview/v1`](contracts/analysis/dataset-preview/v1/README.md).
Existing databases are upgraded by Flyway V19 (existing sources become version 1; no blobs move).


RH-142: [ADR-008](docs/adr/ADR-008-analysis-execution-boundary.md) and the
[threat model](docs/security/analysis-execution-threat-model.md) define the reviewed local security boundary.
The committed, hash-bound review is required before generated-code execution checks; the dedicated analysis
security workflow enforces it. Cloud execution remains deferred until deployment parity is demonstrated.

RH-143–RH-145: [isolated scientific computations](docs/development/analysis-execution.md) add a pinned scientific
Python image, a trusted Docker runner with filesystem/network/resource limits, durable authorized execution attempts,
computed table/chart results and immutable provenance. The real CSV/XLSX impedance example runs against source-version
bytes; every retry keeps earlier evidence. Build `researchhub-sandbox:1.1.1` and explicitly enable the local runner as
described in [sandbox/README.md](sandbox/README.md).

RH-150–RH-151 add [durable execution records](contracts/analysis/record/v1/README.md) and
[structured charts](contracts/analysis/execution/v2/README.md), including backfilled historical attempts.
The Analyses screen exposes saved results, exact input versions, plan/code/runtime provenance and run history.
Results remain inspectable after restart without executing Python again.

RH-152–RH-154 complete result/plan/warning/code inspection and safe failure messages, add explicit
[original/latest-input reruns](contracts/analysis/rerun/v1/README.md) with preserved history, and provide a
[stable computation citation endpoint](contracts/analysis/provenance/v1/README.md) for document/AI consumers.

RH-155 inserts [semantic analysis blocks](contracts/analysis/document-block/v1/README.md) into reports through
revision-checked saves. Blocks render the exact historical execution and keep its source versions until explicitly
updated. RH-156 adds [mixed source/computed evidence](contracts/ai/questions/v2/README.md) with S/A citations and
persisted conversation scope. RH-305 provides [typed presentation components](frontend/src/features/analysis/components/README.md)
with dedicated coverage gates and no planner, sandbox, fetching or plotting dependencies.
See [analysis references and computed evidence](docs/development/analysis-references.md) for behavior and E2E verification.

RH-160–RH-166: opt-in [realtime document authoring](collaboration/README.md) uses an independent
Hocuspocus/Yjs Node service with short-lived document credentials from Spring. Every accepted edit is committed
before broadcast; the binary CRDT state and editor JSON are stored atomically in PostgreSQL (Flyway V25–V26).
[ADR-007](docs/adr/ADR-007-realtime-document-authoring.md) defines authorization, legacy-save migration,
consistent reads and crash recovery. Install/build `collaboration/` before running backend E2E tests.

RH-170–RH-171: [document comments](docs/development/document-comments.md) add selected-text threads,
replies, resolve/reopen and immutable contribution activity. Structured TipTap/Yjs anchors survive nearby
edits and reload; deleted passages leave preserved orphan threads. Viewer reads; editor/owner writes.
Flyway V27 and independent 80% coverage gates cover the new modules; Chrome E2E checks peer review end to end.

RH-172–RH-173: [comment AI assistance and product audit](docs/development/comment-ai-and-product-audit.md)
add explicitly invoked, AI-attributed evidence suggestions, source links and manual citation insertion through
autosave/Yjs. Workspace `USE_AI` permission is enforced on the server. Safe append-only product events record
workspace/member/source/document actions, AI acceptance and analysis execution/insertion atomically (Flyway V28).

RH-174–RH-175: [block origins and collaborative snapshots](docs/development/document-origins-and-snapshots.md)
record explicit AI approval with citations, clipboard imports, human edits and exact analysis references.
The Provenance inspector reports operations without AI detection or authorship percentages. Named and scheduled
snapshots capture committed editor content and available Yjs state. Restore preserves later history and recent
unsnapshotted content, retires old collaboration replicas and isolates offline buffers by epoch (Flyway V29).

Request correlation, structured logs, authenticated Prometheus metrics and verification: [Observability (RH-185 / RH-186)](docs/development/observability.md).

[AI usage/cost telemetry and protected RAG debugger](docs/development/ai-diagnostics.md) (RH-187 / RH-188).

### Academic report export

Documents can be exported to DOCX, PDF and LaTeX source bundles from the editor's **Export** action. The backend freezes the saved
revision, citations and analysis provenance into a browser-independent report, then renders it asynchronously.
See [report export contracts and verification](docs/development/report-export.md) for API routes, retention,
configuration, limits and real-browser E2E checks (RH-230/RH-231/RH-232/RH-233). LaTeX downloads contain
`report.tex`, chart images and provenance for local typesetting; the main backend generates sources only.

## Architecture decision index

- [ADR-009 — Shared PostgreSQL sessions and atomic cost quotas](docs/adr/ADR-009-shared-session-and-quota-state.md).
- [ADR-011 — Durable processing queue in PostgreSQL](docs/adr/ADR-011-durable-processing-in-postgresql.md).
- [ADR-012 — Asynchronous report export pipeline](docs/adr/ADR-012-report-export-pipeline.md).
- [Runtime profiles and Azure deployment contract](docs/development/configuration.md#azure-deployment-contract-rh-311--rh-312).
- [Per-replica connection budget and Epic 21 validation](docs/development/persistence.md#connection-budget-and-autoscaling-rh-314).
