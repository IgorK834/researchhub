# ResearchHub

ResearchHub is a collaborative AI workspace for students and researchers. A group shares source materials, writes a report in the same workspace, and uses AI that stays grounded in those sources. Charts, tables, calculations, and generated claims should keep provenance back to the source file, source fragment, dataset, or executed analysis.

This repository is in active development and is not production-ready.

Architecture and product context: [docs/context.md](docs/context.md).

## Stack

- Backend: Java 25, Spring Boot 4.1.1, Maven
- Frontend: React, TypeScript, Webpack, npm

Python AI and data workloads are planned under `ai-worker/` and are not in the repository yet.

## Directory structure

```text
researchhub/
├── backend/     Spring Boot application (dev.researchhub)
├── frontend/    React + TypeScript application
├── docs/        Project context
├── .gitignore
└── README.md
```

`ai-worker/` (Python) is future work and is not implemented.

## Prerequisites

- JDK 25 (`JAVA_HOME` or `java` on `PATH`)
- Node.js and npm
- Docker, when containerized services are introduced
- Python, when `ai-worker/` exists

## Backend

From `backend/`:

```bash
cd backend
./mvnw test
./mvnw spring-boot:run
```

`./mvnw spring-boot:run` starts `dev.researchhub.BackendApplication`. No server port is set in `application.yaml`, so Spring Boot serves HTTP on port 8080.

Open this repository from the monorepo root in IntelliJ (not `backend/` alone) and import `backend/pom.xml` as a Maven project so the backend module is available.

## Frontend

From `frontend/`:

```bash
cd frontend
npm ci
```

`npm install` is an alternative when you are not installing from the lockfile.

The UI scaffold is not wired yet. `frontend/public/` and `frontend/src/` are empty, there is no Webpack configuration, and `package.json` has no `start` or `dev` script. Webpack, `webpack-cli`, and `webpack-dev-server` are already devDependencies. After a config and an application entry exist, the intended local command is a webpack-dev-server script, for example `npm run dev`.
