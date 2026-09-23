# ResearchHub

ResearchHub is a collaborative AI workspace for students and researchers. A group shares source materials, writes a report in the same workspace, and uses AI that stays grounded in those sources. Charts, tables, calculations, and generated claims should keep provenance back to the source file, source fragment, dataset, or executed analysis.

This repository is in active development and is not production-ready.

Architecture and product context: [docs/context.md](docs/context.md).

Profiles, environment variables, and where secrets must not go: [docs/development/configuration.md](docs/development/configuration.md).

Backend module rules: [docs/development/backend-architecture.md](docs/development/backend-architecture.md). REST error contract: [docs/development/api-errors.md](docs/development/api-errors.md). Request validation rules and shared length limits: [docs/development/validation.md](docs/development/validation.md). Health probes: [docs/development/health.md](docs/development/health.md).

## Stack

- Backend: Java 25, Spring Boot 4.1.1, Maven
- Frontend: React, TypeScript, Webpack, npm

Python AI and data workloads are planned under `ai-worker/` and are not in the repository yet.

## Directory structure

```text
researchhub/
├── backend/       Spring Boot application (dev.researchhub)
├── frontend/      React + TypeScript application
├── docs/          Project context and development docs
├── compose.yaml   Local PostgreSQL for backend development
├── .editorconfig
├── .gitignore
├── .env.example
└── README.md
```

`ai-worker/` (Python) is future work and is not implemented.

## Prerequisites

- JDK 25 (`JAVA_HOME` or `java` on `PATH`)
- Node.js and npm
- Docker and Docker Compose, for local PostgreSQL
- Python, when `ai-worker/` exists

## Local PostgreSQL

The backend's `local` profile connects to PostgreSQL, started from the root `compose.yaml`:

```bash
docker compose up -d postgres
```

That starts service `postgres` (container `researchhub-postgres`, image `postgres:17`) on `localhost:5432`, database `researchhub`, with a named volume (`postgres-data`) so data survives container restarts. `docker compose ps` shows `healthy` once `pg_isready` succeeds.

```bash
docker compose stop postgres     # stop, keep data
docker compose down -v           # stop and delete the named volume: this removes local data
```

Override the host, port, database name, user, or password with the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` environment variables; `docker compose` and the backend's `local` profile read the same names. Details, defaults, and how this differs from the cloud profile's `DB_URL`: [docs/development/configuration.md](docs/development/configuration.md).

## Backend

From `backend/`:

```bash
cd backend
./mvnw test
./mvnw spring-boot:run
```

`./mvnw test` needs Docker. The persistence test starts a PostgreSQL 17 container with Testcontainers and does not use the Compose database above. Other tests do not open a database. `./mvnw spring-boot:run` still uses Compose.

`./mvnw spring-boot:run` starts `dev.researchhub.BackendApplication` on the `local` profile, which does need the PostgreSQL container above running. No server port is set in `application.yaml`, so Spring Boot serves HTTP on port 8080.

Open this repository from the monorepo root in IntelliJ (not `backend/` alone) and import `backend/pom.xml` as a Maven project so the backend module is available. The root `.editorconfig` sets UTF-8, LF, 4-space Java and Python indentation, and 2-space TypeScript, JSON, and YAML indentation. Recent IntelliJ versions apply that file with the bundled EditorConfig plugin.

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
for unknown paths (`historyApiFallback`), so client-side routes work on direct refresh.

`src/` layout and where new feature code belongs: [docs/development/frontend-structure.md](docs/development/frontend-structure.md).

Routing uses `react-router-dom` (`src/app/AppRouter.tsx`). Current routes, all placeholders:

```text
/login
/register
/app                                                     (layout route, redirects to workspaces)
/app/workspaces
/app/workspaces/:workspaceId
/app/workspaces/:workspaceId/documents/:documentId
*                                                        (Not Found page)
```
