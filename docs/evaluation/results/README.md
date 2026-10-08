# Recorded evaluation evidence

Generated on **2026-10-08** with the pinned runtime and suite version 1. These files are
synthetic test evidence, not a benchmark of a production language model or deployment capacity.

| Run | Span Recall@K | Answer correctness | Infrastructure/provider failures |
| --- | ---: | ---: | ---: |
| [Offline baseline](offline-baseline.md) | 100% | 90.91% | 0 / 33 |
| [Smaller chunks and top-K](offline-small-chunks.md) | 92.86% | 84.85% | 0 / 33 |
| [Real Spring/pgvector baseline](spring-baseline.md) | 100% | 90.91% | 0 / 33 |

The [paired comparison](offline-comparison.md) deliberately fails the quality gate for the
smaller-context candidate. The baseline extractive fixture misses complete method comparison,
answers a secret-calibration question with unrelated code-provenance text, and quotes an untrusted
source instruction instead of declining it. These are recorded quality failures, not hidden or
fixed by modifying gold labels. The conservative support signal can still recognize those quotes
as present in source text; expected answer status and fact coverage expose their failure to answer
the actual question.

The Spring run uses real sessions, uploads, durable ingestion, the Python worker and pgvector
ranking. Its **generation model is still the deterministic extractive fixture**. Runtime source
identities/versions, normalized chunks, provided context, ranking scores and embedding namespaces
are retained in [the JSON report](spring-baseline.json). The test database is disposable.

[Validation results](validation.json): 527 worker tests passed; evaluation coverage is 99.24%
including branches (99.64% lines, 97.86% branches). `./mvnw verify` succeeded with 1,181 tests,
zero failures/errors and 11 existing optional tests skipped. Final real Spring evaluation E2E
also passed independently against the completed adapter. The wheel includes the CLI and corpus
and runs all 33 cases outside the checkout. All dedicated coverage gates and the frozen lockfile
check passed. The full backend run took 14m52s, including slow shutdown of existing test contexts.

Latency is captured wall time and varies with the machine/load. Token usage from the fixture is
marked estimated. Cost is unavailable because no pricing is configured; no paid model call was
made. Rerun the [documented workflow](../README.md) for the intended model/prompt/index configuration.
