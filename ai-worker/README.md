# ResearchHub AI worker

RH-112 workspace questions reuse the contextual gateway and Foundry adapter with the versioned
`workspace-question:1` policy. The deterministic fixture quotes lexically matching passages or
reports insufficient evidence. Contracts/configuration: [workspace questions](../docs/development/workspace-questions.md).

This dedicated, internal-only Python process is the boundary for document and AI/data workloads. It receives durable
processing jobs from the Spring dispatcher. PostgreSQL in the backend remains the source of truth. The versioned
HTTP contract carries trusted job/workspace/source identity and a short-lived, read-only blob URL—never an end-user
cookie or authorization token.

The first contract is `POST /internal/jobs/source-ingest`. It requires a backend service Bearer token and returns a
strict result with extraction metadata, document structure, chunks, warnings, and a failure object. The production handler downloads the scoped input and extracts PDF, DOCX, CSV and XLSX content through
`parsing/`. The active contract is v4; extraction and provenance stay outside the Java domain, while Spring stores
validated output. Embedding providers now serve the internal `/internal/embeddings` boundary; Spring owns the
pgvector index. See [ADR-002](../docs/adr/ADR-002-retrieval.md).

Embedding metadata/documents/query endpoints, model metadata/structured generation endpoints and the process probe `GET /health` complete the internal surface. This is not a product API. Workspace membership,
authorization, job durability, source metadata, and every product/business endpoint remain in Spring Boot.

## Dependency management

Python is fixed to `3.13.3` in `.python-version` and `pyproject.toml`. The project uses **uv 0.12.20** because one tool
creates the virtual environment, resolves both runtime and PEP 735 development groups, and verifies the universal
`uv.lock`. Direct dependencies are exact pins and the committed lockfile pins their complete transitive graph.

Install the pinned uv release (for example `python -m pip install uv==0.12.20`), then run from this directory:

```bash
uv sync --frozen
AI_WORKER_SERVICE_TOKEN="replace-with-at-least-32-random-characters" uv run --frozen researchhub-worker
```

The worker is now independent of the backend and answers `http://127.0.0.1:8090/health`. It can also be built and
started without installing Python or uv on the host:

```bash
docker compose up --build -d ai-worker
curl --fail http://127.0.0.1:8090/health
```

Run the unit and internal-API tests with:

```bash
uv run --frozen pytest
```

`pytest` enforces at least 80% branch-aware coverage of `researchhub_worker`.

`AI_WORKER_SERVICE_TOKEN` is mandatory when the process starts. Compose supplies a conspicuous localhost-only
default shared with Spring; a deployment must inject the same high-entropy secret into both processes. It must not
be exposed as a frontend variable or written to logs. Missing and invalid credentials receive `401`. The public
`/health` probe performs no work and needs no credential.

## Data and security boundary

The worker has no PostgreSQL driver, receives no product database URL, and must not connect directly to ResearchHub's
product database. Spring owns workspace authorization and durable job state. Future processors may use explicitly
scoped internal contracts or storage access designed for the workload, but they must not bypass that boundary. The
worker also does not execute generated user/AI code; such execution belongs in the separately isolated sandbox.

The canonical v4 examples are in `../contracts/processing/v4/`; both Java and Python contract tests consume those
same files. See `../docs/development/source-extraction.md` for the compatibility and limit policy.

Parser behavior, cloud OCR evaluation, limits, Compose blob networking and E2E checks are documented in
[Source extraction](../docs/development/source-extraction.md).

RH-092 [CSV data assets](../docs/development/csv-data-assets.md) provide delimiter/UTF-8 validation,
bounded primitive-type and missing-value profiles, and schema-only retrieval. Original cell values remain
strings in previews. Existing row/column/sample limits apply; `sh scripts/check.sh` also enforces a dedicated
80% CSV/profile coverage gate.

Retrieval chunk schema, versioning and structure-aware chunking: [source-retrieval.md](../docs/development/source-retrieval.md).

RH-110 adds `ai/`, the central model gateway with deterministic and Foundry adapters. The model receives
explicit text/evidence only, without parser/storage access or tools. Templates and parameters come from
Spring feature configuration. Contracts and configuration: [model-gateway.md](../docs/development/model-gateway.md).
`sh scripts/check.sh` runs all tests and enforces a separate 80% coverage gate for the Python AI package.

RH-111 adds `ai/context.py`: strict validation of application-built v2 context and local citation-key
translation before exposing a grounded response. The original v1 internal contract remains supported.
The check script enforces a separate context-module coverage gate. [Grounded context](../docs/development/grounded-context.md).
