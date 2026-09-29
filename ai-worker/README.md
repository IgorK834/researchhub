# ResearchHub AI worker

This internal-only Python process receives durable processing jobs from the Spring dispatcher. PostgreSQL in the
backend remains the source of truth; the HTTP contract carries only job/workspace/resource identifiers and an
attempt number—never an end-user cookie or authorization token.

The first contract is `POST /internal/jobs/source-ingest`. The current handler establishes validation,
idempotency, retries, and the process boundary; extraction/indexing is added behind
`IdempotentSourceIngestProcessor` without moving those concerns into the Java domain.

Run locally from this directory:

```bash
PYTHONPATH=src python -m researchhub_worker
python -m pytest
```

The runtime is pinned by `.python-version` and `pyproject.toml`; test tooling is pinned in the `test` optional
dependency. `pytest` enforces at least 80% branch-aware coverage of `researchhub_worker`.
