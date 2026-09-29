# ResearchHub AI worker

This dedicated, internal-only Python process is the boundary for document and AI/data workloads. It receives durable
processing jobs from the Spring dispatcher. PostgreSQL in the backend remains the source of truth; the HTTP contract
carries only job/workspace/resource identifiers and an attempt number—never an end-user cookie or authorization
token.

The first contract is `POST /internal/jobs/source-ingest`. The current handler establishes validation,
idempotency, retries, and the process boundary; extraction/indexing is added behind
`IdempotentSourceIngestProcessor` without moving those concerns into the Java domain.

The only other route is the process probe `GET /health`. This is not a product API. Workspace membership,
authorization, job durability, source metadata, and every product/business endpoint remain in Spring Boot.

## Dependency management

Python is fixed to `3.13.3` in `.python-version` and `pyproject.toml`. The project uses **uv 0.12.20** because one tool
creates the virtual environment, resolves both runtime and PEP 735 development groups, and verifies the universal
`uv.lock`. Direct dependencies are exact pins and the committed lockfile pins their complete transitive graph.

Install the pinned uv release (for example `python -m pip install uv==0.12.20`), then run from this directory:

```bash
uv sync --frozen
uv run --frozen researchhub-worker
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

## Data and security boundary

The worker has no PostgreSQL driver, receives no product database URL, and must not connect directly to ResearchHub's
product database. Spring owns workspace authorization and durable job state. Future processors may use explicitly
scoped internal contracts or storage access designed for the workload, but they must not bypass that boundary. The
worker also does not execute generated user/AI code; such execution belongs in the separately isolated sandbox.
