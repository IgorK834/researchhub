# ResearchHub — Project Context

> Central project context for development, architecture decisions, AI coding assistants, and future contributors.

## 1. Project summary

**ResearchHub** is a collaborative AI workspace for students and researchers.

The core workflow is:

1. A group receives source materials such as PDFs, DOCX, presentations, scientific papers, XLSX/CSV datasets, and images.
2. Everyone works inside the same shared workspace.
3. The group collaboratively writes a report, paper, laboratory report, or research document.
4. AI can answer questions using workspace sources, generate sections, rewrite fragments, find evidence, suggest citations, compare sources, summarize documents, detect contradictions, and support data analysis.
5. Spreadsheet/data files can be analyzed through executable Python code.
6. Charts, tables, calculations, and AI-generated claims should preserve provenance back to the source file, source fragment, dataset, or executed analysis.

Long-term vision:

> **From sources and raw data to a reproducible collaborative report.**

ResearchHub is not intended to be only a “chat with PDF” app, generic LLM wrapper, Notion clone, or programmer-only notebook. It should combine collaborative writing, shared research sources, grounded AI, executable data analysis, citations, reproducibility, and provenance.

---

## 2. Primary users

### 2.1 Students

Example input:

```text
lab_03/
├── instructions.pdf
├── lecture_01.pdf
├── lecture_02.pdf
├── theory.docx
├── measurements.xlsx
└── sample_data.csv
```

Expected output:

```text
Laboratory Report

1. Objective
2. Theory
3. Methodology
4. Results
5. Analysis
6. Conclusions
```

The team should be able to use one shared source library, edit the report together, generate draft sections from selected sources, improve manually written text, ask questions about lectures, analyze measurement files, create charts, and insert results directly into the report.

### 2.2 Researchers

Possible workflows:

- literature reviews,
- shared paper writing,
- experimental data analysis,
- paper comparison,
- evidence extraction,
- source-grounded drafting,
- reproducible research notes,
- collaborative review.

---

## 3. Core product principles

### 3.1 Source-grounded by default

AI-generated research content should be based on explicit workspace sources whenever possible.

Example:

```text
Generate section: "Theoretical Background"

Sources:
[x] lecture_03.pdf
[x] laboratory_instructions.pdf
[x] smith_2025.pdf
[ ] internet

Length:
~700 words

Citations:
required
```

### 3.2 Human remains in control

AI suggestions should normally be proposed rather than silently modifying the document.

Typical actions:

```text
Improve writing
Expand
Shorten
Explain
Find supporting evidence
Check claim
Add citation
```

Suggested changes should be presented as:

```text
[Accept] [Reject] [Edit]
```

### 3.3 Reproducibility

A chart should not be only an image. An analysis result should be tied to:

- source dataset,
- sheet and columns,
- generated/executed code,
- parameters,
- execution timestamp,
- output data,
- resulting chart/table.

This allows analyses to be re-run when data changes.

### 3.4 Provenance

ResearchHub should distinguish between:

- human-written content,
- AI-generated content,
- AI-rewritten content,
- imported content,
- source-derived claims,
- analysis-derived claims.

Example:

```text
This paragraph uses:

lecture_03.pdf — page 12
instructions.pdf — page 5
analysis #17 — measurements.xlsx
```

### 3.5 Security before convenience

AI-generated Python code must never execute inside the Spring Boot application process or the main AI worker process.

Code execution must happen in a separate isolated sandbox with CPU/memory/time limits, restricted filesystem, no secrets, restricted networking, controlled input files, and controlled outputs.

---

## 4. Current repository state

The Git repository root is the monorepo root. There is no nested Git repository under `backend/` or `frontend/`.

```text
researchhub/
├── backend/
│   ├── .mvn/
│   ├── src/
│   ├── pom.xml
│   ├── mvnw
│   └── mvnw.cmd
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   ├── webpack.config.cjs
│   ├── babel.config.cjs
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   └── jest.config.cjs
│
├── docs/
│   ├── context.md
│   └── development/
│       ├── configuration.md
│       ├── backend-architecture.md
│       ├── api-errors.md
│       ├── persistence.md
│       ├── health.md
│       ├── validation.md
│       ├── frontend-structure.md
│       ├── frontend-api.md
│       └── frontend-tooling.md
│
├── .editorconfig
├── .env.example
├── .gitignore
└── README.md
```

The frontend is scaffolded: Webpack, Babel, strict TypeScript, React Router, a shared API client, and TanStack Query at the app root. Behind those routes, registration, login, the workspace list and create form, the workspace detail page with its member list and owner-only member management, settings, and archive control, and document authoring (a title and a textarea over the stored JSON, with revision-checked save) are implemented. Layout: [development/frontend-structure.md](development/frontend-structure.md). API layer: [development/frontend-api.md](development/frontend-api.md). Checks: [development/frontend-tooling.md](development/frontend-tooling.md). `ai-worker/` is not in the repository yet.

Local-only paths are ignored and must not be committed:

```text
.idea/                 # including nested backend/.idea/
*.iml
out/
backend/target/
frontend/node_modules/
frontend/dist/
.env and .env.*          # .env.example may be tracked
```

The project has left pure scaffolding. Implemented so far: accounts with session authentication, workspaces with membership roles enforced on the backend, and workspace documents with revision-checked saves. Everything else in this document — sources, RAG, AI writing, analysis, and realtime collaborative editing — is still a plan, not code. Check [development/backend-architecture.md](development/backend-architecture.md) and [development/persistence.md](development/persistence.md) for what actually exists before assuming a feature is available.

---

## 5. Current technology decisions

### 5.1 Backend

Current backend:

```text
Java 25
Spring Boot 4.1.1
Maven
Jar packaging
```

Base package:

```text
dev.researchhub
```

Spring Boot is the main domain/application backend.

Responsibilities:

- users,
- authentication,
- authorization,
- workspaces,
- memberships,
- documents,
- source metadata,
- comments,
- citations,
- analysis metadata,
- AI request orchestration,
- audit events,
- API,
- persistence,
- business rules.

Start as a **modular monolith**. Do not introduce microservices without a concrete architectural reason.

### 5.2 Frontend

Current frontend direction:

```text
React
TypeScript
Node.js / npm
Webpack
Babel
```

The project intentionally does not use Vite.

Expected frontend responsibilities:

- workspace UI,
- collaborative editor,
- source browser,
- PDF/source viewer,
- AI sidebar,
- comments,
- analysis blocks,
- charts and tables,
- presence indicators,
- API integration.

In use now:

```text
React Router      client-side routing
TanStack Query    server state and caching
Jest              unit tests
ESLint + Prettier lint and formatting
```

Likely later libraries:

```text
Tiptap / ProseMirror
Yjs
```

No large UI framework has been selected yet.

### 5.3 Python

Python is planned but not yet added to the repository.

Future directory:

```text
ai-worker/
```

Responsibilities:

- document preprocessing,
- chunking,
- embeddings,
- retrieval support,
- AI/data orchestration helpers,
- spreadsheet processing,
- scientific/data ecosystem integration,
- generated analysis code preparation,
- result post-processing.

Likely libraries later:

```text
pandas
numpy
scipy
matplotlib
openpyxl
pydantic
```

Core domain logic stays in Spring Boot.

---

## 6. Target repository structure

```text
researchhub/
│
├── backend/
│   └── Spring Boot domain/API application
│
├── frontend/
│   └── React + TypeScript application
│
├── ai-worker/
│   └── Python AI/data processing
│
├── collaboration/
│   └── optional Yjs/Hocuspocus service if required
│
├── sandbox/
│   └── isolated analysis execution environment
│
├── infrastructure/
│   └── Azure / Docker / IaC configuration
│
├── docs/
│   ├── context.md
│   ├── architecture/
│   └── adr/
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

Do not create every directory immediately. Add parts only when implementation reaches them.

---

## 7. High-level domain model

```text
User
  |
  +-- WorkspaceMember
        |
        v
    Workspace
        |
        +-- Documents
        +-- Sources
        +-- Analyses
        +-- AI Conversations
        +-- Audit Events
```

---

## 8. Workspace

A workspace is the main collaboration and security boundary.

Example:

```text
Workspace: Electronics Lab — Team 4

Members:
- Adam — OWNER
- Kasia — EDITOR
- Michał — EDITOR

Sources:
- instructions.pdf
- lecture_05.pdf
- measurements.xlsx

Documents:
- final_report
- notes
```

Initial roles:

```text
OWNER
EDITOR
VIEWER
```

These three are implemented and enforced on the backend. `OWNER` manages workspace metadata and members and edits content; `EDITOR` creates and edits content but cannot manage members or the workspace; `VIEWER` reads only. The capability matrix and where it lives: [development/backend-architecture.md](development/backend-architecture.md).

Every workspace-owned entity should carry a workspace relationship, e.g. `workspace_id`.

---

## 9. Collaborative document editor

Long-term document capabilities:

- rich text,
- headings,
- lists,
- tables,
- equations,
- comments,
- citations,
- AI suggestions,
- analysis blocks,
- charts,
- simultaneous editing,
- presence,
- version/history metadata.

Likely stack:

```text
React
  |
Tiptap / ProseMirror
  |
Yjs CRDT
  |
WebSocket / realtime service
```

Potential realtime backend: Hocuspocus.

Do not implement CRDT from scratch.

**Implemented so far: persistence, not collaboration.** A document is stored per workspace with a title, a JSON body, and a revision; it is created, read, saved, and soft-archived through `/api/workspaces/{workspaceId}/documents`. The stored format is already a ProseMirror document node, so introducing Tiptap later needs no data migration. The editor today is a textarea over the paragraph text inside that JSON.

None of Tiptap, Yjs, Hocuspocus, a websocket, presence, or `document_versions` exists yet. Concurrent edits are handled by the revision: a save carrying a stale revision is refused with `409` and the second writer is told, rather than merged or silently dropped. That is the honest single-writer answer, and it is what a CRDT would eventually replace. Routes and error codes: [development/backend-architecture.md](development/backend-architecture.md).

---

## 10. Source library

Eventually supported:

```text
PDF
DOCX
PPTX
XLSX
CSV
TXT
images
scientific papers
```

Conceptual source entity:

```text
Source

id
workspace_id
name
type
storage_key
status
uploaded_by
created_at
updated_at
```

Processing states:

```text
UPLOADED
PROCESSING
READY
FAILED
```

Binary files go to object storage; metadata goes to PostgreSQL; processed chunks are indexed for retrieval.

---

## 11. Source ingestion pipeline

```text
User uploads source
      |
      v
Spring Boot
      |
      +--> Blob/Object Storage
      |
      +--> PostgreSQL metadata
      |
      +--> processing event/job
                |
                v
          Python AI Worker
                |
         parse / extract
                |
             clean
                |
            chunk
                |
          embeddings
                |
         search index
```

Candidate Azure services later:

```text
Azure Blob Storage
Azure Service Bus
Azure AI Search
Azure Document Intelligence
Microsoft Foundry
```

Local development should avoid unnecessary cloud dependency.

---

## 12. RAG architecture

```text
User question
     |
     v
Spring Boot authorization
     |
     v
AI request
     |
     v
query embedding / search
     |
     v
hybrid retrieval
     |
     v
workspace permission filter
     |
     v
reranking
     |
     v
context assembly
     |
     v
LLM
     |
     v
structured answer + citations
```

Critical rule:

> Retrieval must always be restricted by workspace and user permissions.

The LLM is never the security boundary.

---

## 13. Planned AI features

### Ask Workspace

Ask questions over all permitted workspace sources.

### Ask Source

Ask questions using one explicitly selected source.

### Generate Section

Generate an entire document section from selected sources with citations.

### Rewrite Selection

Improve, shorten, expand, explain, or clarify selected text.

### Find Evidence

Find source fragments supporting a selected claim.

### Compare Sources

Compare papers/documents using structured output.

### Contradiction Detection

Surface sources that make conflicting claims instead of hiding uncertainty.

---

## 14. Data analysis

This is a major differentiator.

Example input:

```text
measurements.xlsx

frequency | voltage | current
100       | 4.81    | 0.12
200       | 4.63    | 0.19
300       | 4.21    | 0.31
```

User request:

```text
Calculate impedance for each measurement
and create a chart of impedance vs frequency.
```

Pipeline:

```text
Natural language request
       |
       v
AI planner
       |
       v
generated Python
       |
       v
isolated sandbox
       |
       v
pandas / numpy / scipy
       |
       +--> result table
       +--> chart
       +--> execution metadata
```

---

## 15. Analysis Artifact

An analysis is a first-class domain object.

Conceptual model:

```text
AnalysisArtifact

id
workspace_id
created_by
source_files
source_version_ids
user_request
generated_code
parameters
execution_status
execution_started_at
execution_finished_at
result_data
result_metadata
chart_definition
chart_file
created_at
```

UI example:

```text
Analysis

Source:
measurements.xlsx

Sheet:
measurement_01

Operation:
Z = U / I

[Show code]
[Re-run]
[Insert table]
[Insert chart]
```

---

## 16. Analysis blocks in documents

The editor should eventually support semantic blocks:

```text
+ Text
+ Heading
+ Table
+ Equation
+ Citation
+ Chart
+ Analysis
```

This is conceptually closer to **Google Docs + NotebookLM + Jupyter** than a normal editor.

---

## 17. Analysis sandbox

Generated code is untrusted.

```text
Spring Boot / AI Worker
          |
          v
      Job request
          |
          v
 isolated execution sandbox
          |
          +--> input dataset copy
          +--> generated Python
          +--> temporary output
          |
          v
      result artifact
```

Requirements:

- no production credentials,
- no database credentials,
- no unrestricted host filesystem,
- no Docker socket,
- strict timeout,
- CPU/memory limits,
- output size limits,
- restricted networking,
- package allowlist if installation is ever supported.

Do not execute generated analysis with `exec(...)` in the main AI worker.

---

## 18. Backend architecture

Use a modular monolith.

Suggested modules:

```text
dev.researchhub

├── auth
├── user
├── workspace
├── document
├── collaboration
├── source
├── citation
├── comment
├── analysis
├── ai
├── audit
└── shared
```

Prefer domain-oriented modules over one global `controllers/services/repositories` hierarchy.

Within a module, layers may exist:

```text
workspace/
├── api/
├── application/
├── domain/
└── infrastructure/
```

Avoid premature base classes and generic abstractions.

Module boundaries, dependency direction, and which packages exist in code today: [development/backend-architecture.md](development/backend-architecture.md). REST error responses: [development/api-errors.md](development/api-errors.md).

---

## 19. Persistence

Primary database:

```text
PostgreSQL
```

Planned usage:

- users,
- workspaces,
- memberships,
- documents,
- comments,
- source metadata,
- analysis metadata,
- audit events,
- AI conversation metadata,
- job metadata.

Schema migrations:

```text
Flyway
```

Do not rely on Hibernate auto-creating production schema.

---

## 20. Preliminary entities

Not final schema. `users`, `workspaces`, `workspace_members`, and `documents` now exist as Flyway migrations; the columns and constraints they actually have are documented in [development/persistence.md](development/persistence.md), which is the source of truth for anything already built. The rest of this list is still a sketch. `document_versions` is not a table.

```text
users
workspaces
workspace_members

documents
document_versions

sources
source_versions
source_chunks

comments
citations

analysis_artifacts
analysis_executions

ai_conversations
ai_messages

processing_jobs
audit_events
```

---

## 21. Authentication and authorization

Registration, login, and logout are implemented: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/me` (canonical identity read, with `GET /api/auth/me` as a compatible alias), with the session in an HttpOnly cookie. Every other route requires a session by default, and the SPA holds `/app` behind a guard that waits for that check before rendering. OAuth providers and password reset are not implemented.

Authorization is implemented for the workspace boundary. `workspace_members` grants a user access to one workspace with one role, `OWNER`, `EDITOR`, or `VIEWER`; `dev.researchhub.workspace.domain.WorkspaceRole` maps each role to the capabilities it carries, and `WorkspaceAuthorizationService` is the single place every workspace route asks. A non-member is answered `404`, not `403`, so a response never confirms that another team's workspace exists. Details, including the capability matrix: [development/backend-architecture.md](development/backend-architecture.md).

Those roles are enforced for workspace metadata today: editing a workspace's name or description, and archiving it, require `MANAGE_WORKSPACE` and so are owner-only. An editor or viewer is refused with `403`, and a non-member with the same `404` as a workspace that does not exist. Archiving is soft — it sets `archived_at` and `archived_by`, removes no row and no file, and leaves every membership intact — so an archived workspace drops out of `GET /api/workspaces` while staying readable by its members. Editing one is `409`.

Document access follows the same boundary. Reading a workspace's documents needs `VIEW_CONTENT`, so any member including a viewer; creating, saving, and archiving need `EDIT_CONTENT`, so an editor or owner, and a viewer is refused with `403`. A document belongs to exactly one workspace, and reaching it through a different workspace id is `404` even for somebody who belongs to both — the same answer as a document that does not exist.

Membership management is implemented on the same footing. An owner adds an existing, registered user by their exact email address as `EDITOR` or `VIEWER`, changes a member's role, or removes a member; all three require `MANAGE_MEMBERS`. Reading the roster requires only membership, so an editor or viewer can see who else is in the workspace. A workspace always keeps at least one owner, so demoting or removing the last one is `409` — a transfer is a promotion followed by a demotion. Removing a member deletes one membership row and nothing else: their account, their session, and every record of what they did survive. Roles are read from the database per request, so a change takes effect on the affected user's next request without them signing in again.

There is no email delivery, no pending-invite table, and no endpoint that lists or searches users. An address with no active account is `404` with one stable detail, identical for an unknown address and a disabled account, so adding a member cannot be used to find out who has an account here.

Documents use that same capability check: `VIEW_CONTENT` to read, `EDIT_CONTENT` to create, save, and archive. What is not implemented yet: per-resource checks for entities that do not exist yet — sources, analyses, AI conversations. Each of those hangs off a workspace and will reuse the same capability check rather than inventing its own. Until a resource exists, there is no rule to write for it. There is also no hard delete, by design: see the archive and authorship rules in [development/persistence.md](development/persistence.md).

Initial mechanism:

```text
email + password
server-side session in an HttpOnly cookie
```

The browser authentication mechanism is decided in [adr/ADR-001-authentication.md](adr/ADR-001-authentication.md): a Spring Security server-side session, with the session id in an `HttpOnly`, `Secure`, `SameSite` cookie, and no token in `localStorage` or `sessionStorage`. Later auth tasks follow that ADR and do not add a second mechanism. Passwords are stored as BCrypt hashes; `auth` owns the filter chain and the endpoints, `user` owns the record and the hash. REST error codes for these flows: [development/api-errors.md](development/api-errors.md).

Future possibilities:

```text
GitHub login
Google login
Microsoft login
university SSO
```

Authorization is more important than authentication mechanics.

Every API operation must enforce resource access on the backend.

---

## 22. API style

Primary API style:

```text
REST
```

Conceptual routes, with the implemented ones marked. Implemented routes are specified in [development/backend-architecture.md](development/backend-architecture.md); the rest are still a sketch.

```text
POST   /api/auth/register                      implemented
POST   /api/auth/login                         implemented

GET    /api/workspaces                         implemented
POST   /api/workspaces                         implemented
GET    /api/workspaces/{workspaceId}           implemented
PATCH  /api/workspaces/{workspaceId}           implemented, owner-only
POST   /api/workspaces/{workspaceId}/archive   implemented, owner-only, soft

GET    /api/workspaces/{workspaceId}/members            implemented, any member
POST   /api/workspaces/{workspaceId}/members            implemented, owner-only
PATCH  /api/workspaces/{workspaceId}/members/{userId}   implemented, owner-only
DELETE /api/workspaces/{workspaceId}/members/{userId}   implemented, owner-only

GET    /api/workspaces/{workspaceId}/documents              implemented, any member
POST   /api/workspaces/{workspaceId}/documents              implemented, editors and owners
GET    /api/workspaces/{workspaceId}/documents/{documentId} implemented, any member
PATCH  /api/workspaces/{workspaceId}/documents/{documentId} implemented, revision-checked
DELETE /api/workspaces/{workspaceId}/documents/{documentId} implemented, soft archive

GET    /api/workspaces/{workspaceId}/sources
POST   /api/workspaces/{workspaceId}/sources

POST   /api/workspaces/{workspaceId}/ai/query
POST   /api/workspaces/{workspaceId}/analyses
```

Do not freeze API design before MVP stories are defined.

---

## 23. Async/event-driven work

Likely asynchronous operations:

```text
source upload processing
document parsing
embedding generation
search indexing
large analysis execution
chart generation
notification delivery
```

Pattern:

```text
request
   |
   v
create job
   |
   v
202 Accepted
   |
   v
worker processes
   |
   v
job status updates
```

Potential cloud messaging later: Azure Service Bus.

Do not introduce Kafka merely for portfolio value.

---

## 24. Transactional outbox

Use a transactional outbox when reliable domain-event publication becomes necessary.

Do not implement it before there is an actual event-delivery problem to solve.

---

## 25. Realtime collaboration

Long-term:

```text
User A ----\
User B -----+--> Yjs realtime sync
User C ----/
```

Features:

- simultaneous editing,
- user presence,
- cursors,
- reconnect,
- offline/local updates,
- conflict-free synchronization.

Likely tools:

```text
Yjs
Hocuspocus
WebSocket
```

Azure Web PubSub may be evaluated later.

---

## 26. Azure target architecture

```text
                    Internet
                       |
                       v
                 React frontend
                       |
                       v
                Spring Boot API
                       |
       +---------------+----------------+
       |               |                |
       v               v                v
 PostgreSQL       Blob Storage      Service Bus
                                         |
                                         v
                                  Python AI Worker
                                         |
                     +-------------------+------------------+
                     |                   |                  |
                     v                   v                  v
              Document processing   AI Search          Foundry models

Separate:
analysis execution sandbox/jobs
```

Candidate services:

```text
Azure Container Apps
Azure Container Apps Jobs
Azure Database for PostgreSQL
Azure Blob Storage
Azure Service Bus
Azure AI Search
Azure Document Intelligence
Microsoft Foundry
Application Insights
```

Azure should be introduced incrementally to avoid wasting student credits.

---

## 27. Local development strategy

Local-first development.

Expected later stack:

```text
Spring Boot
React
Python worker
PostgreSQL
Azurite or local object storage
optional Redis
optional collaboration server
```

During early development:

- run Spring Boot directly from IntelliJ,
- run React through npm,
- run PostgreSQL in Docker.

Do not Dockerize everything immediately.

Configuration profiles and secret handling: [development/configuration.md](development/configuration.md).

---

## 28. Observability

Later:

```text
Spring Boot Actuator
structured logs
metrics
tracing
Application Insights / OpenTelemetry
```

AI request telemetry should eventually include:

- model,
- latency,
- token usage,
- retrieval timing,
- retrieved chunks,
- prompt/template version,
- cost estimate where practical.

Analysis telemetry should include:

- execution duration,
- exit status,
- resource usage,
- input versions,
- code hash.

---

## 29. AI debugger

Developer-only screen showing:

```text
Question
Retrieved chunks + scores
Reranked order
Context token count
Model
LLM latency
Retrieval latency
Estimated cost
Prompt/template version
```

This supports debugging and demonstrates AI engineering depth.

---

## 30. AI evaluation

Create evaluation datasets later.

Example:

```text
Question:
What dataset did Smith use?

Expected answer:
SWaT

Expected source:
smith_2024.pdf, page 8
```

Compare:

```text
chunk size
overlap
vector-only vs hybrid search
top-k
reranker
models
prompt versions
```

Track:

```text
retrieval accuracy
citation accuracy
answer correctness
latency
token usage
cost
```

---

## 31. Testing strategy

### Backend

Planned:

```text
JUnit
Spring Boot Test
Testcontainers
```

Prefer integration tests for important domain flows.

### Frontend

Later choose between:

```text
Vitest or Jest
React Testing Library
Playwright
```

### Python

```text
pytest
```

---

## 32. Development rules

1. Keep the architecture understandable.
2. Do not add technology only because it looks good on a CV.
3. Prefer modular monolith over premature microservices.
4. Use Java/Spring for domain/application backend logic.
5. Use Python where the AI/data ecosystem provides real value.
6. Never execute generated code in the main application process.
7. Authorization must be enforced server-side.
8. AI is not a trusted security boundary.
9. Preserve source provenance for AI-generated claims.
10. Preserve analysis provenance for computed results.
11. Prefer explicit, maintainable code over clever abstractions.
12. Use migrations for persistent schema changes.
13. Never commit secrets.
14. Never commit `node_modules`, `.idea`, build outputs, or local virtual environments.
15. Every significant feature should have clear user value.

---

## 33. Rules for AI coding assistants

AI coding assistants should:

- respect the modular-monolith design,
- keep core business logic in Spring Boot,
- use Python only for AI/data responsibilities,
- preserve workspace authorization boundaries,
- write clear code suitable for learning Java/Spring,
- explain non-obvious Spring concepts when introducing them,
- prefer small incremental tasks,
- add tests for domain-critical behavior,
- justify new dependencies.

They should not:

- convert the backend to FastAPI,
- introduce microservices by default,
- add Kafka just because it is popular,
- add Kubernetes early,
- hide important Java concepts behind Lombok everywhere,
- execute arbitrary generated Python in the AI worker,
- let the frontend enforce security,
- bypass workspace permission checks,
- replace grounded answers with unsupported model knowledge,
- create large generic base-service frameworks prematurely.

---

## 34. MVP philosophy

The MVP should prove this flow:

```text
create workspace
      |
      v
collaborate
      |
      v
upload shared sources
      |
      v
create/write report
      |
      v
ask AI about sources
      |
      v
generate/edit source-grounded text
      |
      v
upload spreadsheet
      |
      v
perform analysis
      |
      v
insert result into report
```

The MVP does not need every long-term feature.

---

## 35. Proposed MVP scope

### A. Accounts and workspaces

- registration/login,
- create workspace,
- list workspaces,
- add/invite member,
- owner/editor/viewer permissions.

### B. Basic document authoring

- create document/report,
- basic rich-text editor,
- save document,
- reopen document.

Realtime collaboration can come after persistence is stable.

### C. Shared source library

- upload PDF,
- upload DOCX,
- upload XLSX/CSV,
- list workspace sources,
- processing status.

### D. Initial RAG

- extract source text,
- chunk,
- embed/index,
- Ask Workspace,
- citations to source/page/section.

### E. AI writing

- generate section from selected sources,
- rewrite selected text,
- find evidence for a claim.

### F. Initial data analysis

- choose spreadsheet,
- describe analysis in natural language,
- generate code,
- execute in isolated environment,
- return table/chart,
- save AnalysisArtifact.

### G. Document integration

- insert AI suggestion,
- insert table,
- insert chart,
- retain provenance links.

---

## 36. Suggested implementation order

```text
Phase 1  — Repository + local development foundations
Phase 2  — Users + workspaces + permissions
Phase 3  — Documents without realtime collaboration
Phase 4  — Source upload + object storage + metadata
Phase 5  — PDF/text ingestion + basic RAG
Phase 6  — AI writing/editing
Phase 7  — Spreadsheet ingestion + safe analysis execution
Phase 8  — Analysis blocks and document integration
Phase 9  — Realtime collaboration with Yjs
Phase 10 — Azure deployment and observability
```

This intentionally delays the hardest realtime/cloud pieces until the product core exists.

---

## 37. Decisions intentionally left open

Do not lock these prematurely:

- JWT vs cookie/session auth,
- exact React state-management approach,
- UI component library,
- Tiptap vs alternative editor,
- Hocuspocus vs other Yjs server approach,
- Azure Web PubSub usage,
- pgvector vs Azure AI Search for early/local RAG,
- embedding model,
- LLM model,
- reranker,
- document parsing strategy per file type,
- Terraform vs Bicep,
- sandbox implementation,
- Redis usage,
- notifications,
- billing,
- internet search integration.

---

## 38. Immediate next step

Stop adding infrastructure for now.

Next planning step: convert the MVP into epics and small GitHub Issues.

Proposed epics:

```text
Epic 1  — Local development foundations
Epic 2  — Authentication and users
Epic 3  — Workspaces and permissions
Epic 4  — Documents
Epic 5  — Source library
Epic 6  — RAG / source-grounded AI
Epic 7  — AI writing tools
Epic 8  — Spreadsheet analysis
Epic 9  — Analysis artifacts
Epic 10 — Realtime collaboration
Epic 11 — Azure deployment
```

---

## 39. One-sentence architecture summary

> ResearchHub is a React + Spring Boot collaborative research workspace where Java owns the core domain and security, Python handles AI/data workloads, workspace sources are indexed for grounded RAG, spreadsheet analysis executes in a separate sandbox, and every generated claim or result should preserve provenance back to its source or computation.
