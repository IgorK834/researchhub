# AI quality evaluation (RH-220, RH-221, RH-222)

ResearchHub now has a fixed, authored synthetic corpus and an evaluation CLI that produces
per-case evidence, aggregate metrics, tag/difficulty breakdowns and paired comparisons.
Run this suite before adopting chunking, top-K, index, model or prompt changes. The baseline
is evidence about the configured implementation; a passing comparison alone is not adoption approval.

Completed offline and real Spring runs, paired changes and build/coverage proof are recorded in
[results/README.md](results/README.md).

## Scope and architecture

The evaluation package lives in `ai-worker/src/researchhub_worker/evaluation/`. It uses the
existing pinned **Python 3.13.3**, **uv 0.12.20**, worker parsers, hierarchical chunker and model
gateway. It adds no dependency, database schema, search service, product route or Java domain logic.
Spring remains the modular monolith and owns authorization, source versions, index publication,
context packing and public AI calls. See [retrieval ADR](../adr/ADR-002-retrieval.md),
[gateway ADR](../adr/ADR-003-model-gateway.md), [grounded context](../development/grounded-context.md)
and [workspace questions](../development/workspace-questions.md).

The evaluation corresponds to the design's source scope, per-claim citation/provenance checks,
retrieved-versus-provided context distinction and latency/token/cost diagnostics in
[`DESIGN_SPEC.md`](../../design-reference/DESIGN_SPEC.md). This workstream is an internal
measurement tool; it needs no new user-facing screen. It uses the existing RH-100–105 retrieval
substrate and RH-110–112 answer/citation contracts, satisfying the technical prerequisites
represented by backlog tasks 11.3 and 19.3.

## Fixed suite and schema

The package contains [the 33-case suite](../../ai-worker/src/researchhub_worker/evaluation/fixtures/suite.json),
eight original PDF/DOCX/TXT/CSV files and reference/candidate configurations. Cases cover an RC
laboratory, conflicting photovoltaic studies, numerical values and signs, multiple sources/pages,
negative assertions, provenance, Polish/Unicode, explicit source selection, absent evidence,
schema-only tabular retrieval and two separate workspace fixtures. No source contains private or
third-party research. Labels are hand-authored before examining runner results.

Every case declares `id`, `question`, `expectedAnswer`, `expectedStatus`, `expectedFacts`,
`expectedSourceIds`, `workspaceFixtureId`, `selectedSourceIds`, `tags`, `difficulty` and optional
`forbiddenPatterns`. Each fact has an explanation, reviewed answer regexes, complete supported
statement regexes and source locations: source UUID, physical page where known, extraction unit,
half-open Unicode character range and reference chunk IDs. A case with no expected evidence
declares `INSUFFICIENT_EVIDENCE`; no-hit Recall/MRR values are unavailable, not artificial successes.

Original bytes and concatenated extracted text have SHA-256 pins. Startup reparses originals,
checks every gold location and reference chunk, and rejects drift. Paths/symlinks must stay inside
the suite directory. Fixture labels never reach retrieval or the generation provider. Parsing and
chunking use explicit defaults rather than host environment overrides. Rebuild with:

```bash
PYTHONPATH=ai-worker/src ai-worker/.venv/bin/python docs/evaluation/build_fixtures.py
```

The builder fixes PDF bytes and DOCX metadata/ZIP timestamps. Review changes to data, labels,
parsers or scoring; bump the suite/scoring version and generate a new baseline. Never compare
reports with changed suite/corpus/scoring hashes. JSON schemas in [schemas/](schemas/) are generated
from the same strict Pydantic contracts used by the CLI.

## Offline end-to-end run

From `ai-worker/` after `uv sync --frozen`:

```bash
uv run --frozen researchhub-evaluate run --output ../tmp/evaluation/baseline.json
uv run --frozen researchhub-evaluate run \
  --config src/researchhub_worker/evaluation/fixtures/small-chunks.json \
  --output ../tmp/evaluation/small-chunks.json
uv run --frozen researchhub-evaluate compare \
  ../tmp/evaluation/baseline.json ../tmp/evaluation/small-chunks.json \
  --output ../tmp/evaluation/comparison.json
```

Each command writes JSON plus Markdown. Compare exits **1** on deterministic quality regression,
so the intentionally smaller-context example can fail. Exit **0** means a completed run or passing
comparison; exit **1** from `run` means case/provider failures were recorded; exit **2** means invalid
configuration, incompatible inputs, corpus drift or an unavailable authorized API. Provider/credential
exception payloads are never echoed. JSON files are written atomically with mode `0600`.

Offline uses the real parsers, real chunker, existing token-hash embedding fixture and extractive
model gateway. `fixture-hybrid` is a deterministic RRF fixture with a lexical proxy; `fixture-lexical`
and `fixture-vector` isolate those signals. It is explicitly identified as a fixture index. It does
not reproduce PostgreSQL `ts_rank_cd`, nor establish production semantic model quality. Quality
outputs and ties are deterministic; wall-clock latency remains a measurement. `repetitions` can
be 1–20, using the same case order without mixing labels into inference.

`--configured-model` explicitly enables the existing worker provider environment instead of the
offline fake. Use the existing [model configuration](../development/model-gateway.md); the provider
revision, prompt ID/hash, parameters, chunking/index config and revision are recorded in every run.
No provider is called to judge answers by default.

## Real Spring/pgvector evaluation

Use a dedicated test workspace/account on a disposable or staging ResearchHub instance. Seed
creates two named evaluation workspaces and uploads only the eight fixed files through normal
authenticated, CSRF-protected public APIs. Repeating seed verifies existing hashes and identities;
ambiguous names, changed files or extra sources cause failure. It never overwrites research data.
Credentials come only from `RH_EVALUATION_EMAIL` and `RH_EVALUATION_PASSWORD`, not CLI arguments,
bindings or reports. HTTPS is required except for loopback HTTP. Supply `--ca-file` for a local CA;
TLS verification stays enabled and redirects are refused.

```bash
uv run --frozen researchhub-evaluate seed --url https://localhost:8443 \
  --ca-file ../.demo/local/root.crt --output ../tmp/evaluation/bindings.json
# Copy baseline.json and set index to spring-hybrid; use that file below.
uv run --frozen researchhub-evaluate run --mode spring --url https://localhost:8443 \
  --ca-file ../.demo/local/root.crt --bindings ../tmp/evaluation/bindings.json \
  --config ../tmp/evaluation/spring-config.json --output ../tmp/evaluation/spring.json
```

Keep the server's parser limits and chunking settings consistent with the requested run config.
Configure a sufficiently sized existing LLM/retrieval quota on the dedicated evaluation instance:
the default user LLM quota is 20/minute and this suite makes more than 20 calls. Rate-limit errors
are retained as failures; evaluation does not bypass or silently retry them. Prompt/model changes
belong in the existing versioned server configuration, and recorded prompt identities must match
the requested evaluation config.

The live adapter reads and verifies READY state, original/extraction hashes, immutable active
version, original locations and all chunk content/provenance before measuring. Unknown, stale,
duplicate or foreign-workspace hits fail closed. It normalizes runtime UUID/chunk identities to
fixture identities for portable gold comparisons while retaining the actual source versions and
runtime-to-fixture chunk mapping in the manifest. Actual model context comes from the returned
generation audit, not from all search hits. Each response's citations must match that verified
context. Ranked hit scores, vector similarity, lexical score and pinned embedding model namespace
are retained separately from gold metrics. Source/config/model identity is rechecked at the end, so drift during a multi-request run
also invalidates the report. Public GET search top-K controls the retrieval benchmark. Questions independently use
the server-owned question retrieval/context policy; the report records the actual supplied chunks.

For a real index/chunking comparison, change the existing worker chunk config, reprocess the same
immutable fixture inputs and rerun with the matching evaluation config. A new active *file version*
requires explicit reseeding/binding verification; reprocessing unchanged bytes preserves input
identity. Spring remains responsible for authorization on every request; the Python CLI never
connects to the product database or internal service-token routes.

## Metrics and interpretation

| Signal | Definition and denominator |
| --- | --- |
| Source Recall@K | Distinct expected source UUIDs found in top-K / expected sources. |
| Chunk Recall@K | Distinct reference chunk IDs found / expected IDs; only for reference chunking. |
| Span Recall@K | Gold source locations fully covered by retrieved spans / gold locations. Adjacent/overlapping spans may jointly cover a location. Stable across chunking changes. |
| MRR@K | Reciprocal rank of first individual hit fully covering a gold location; zero for a miss. Only answerable cases. |
| Source/page hit rate | Any expected-source hit (binary per case); fraction of distinct expected source/page targets hit. Unknown pages are excluded. |
| Citation validity | Cited chunk references actually supplied to the model / all claim references. Zero citation references have no denominator. |
| Expected source coverage | Distinct gold sources cited with valid references / expected sources. |
| Fact coverage/correctness | Reviewed normalized regex facts present / expected facts; correctness additionally requires expected answer status and absence of forbidden patterns. |
| Unsupported claim rate | Statements without conservative curated support / assessed statements. Checks each sentence, including added claims. |
| Latency | Monotonic wall time of retrieval/answer operation, in ms; mean and nearest-rank p50/p95. Live times include API/context/network overhead. |
| Usage/cost | Provider token counts and estimation flag; estimated cost from explicit per-million rates/currency/revision. No rate or no usage means unavailable, never fabricated zero cost. |

A support rule accepts an exact normalized statement quoted from its **cited** passage, or a
reviewed complete statement whose cited spans cover a gold location. Invalid citations and forbidden
patterns cannot count as support. Curated rules are conservative, can reject valid novel paraphrases,
and do not constitute general semantic entailment or evidence-quality scoring. Inspect individual
claim decisions and source spans before drawing conclusions. Correctness and citation/support
signals are separate; a factually right answer can still have an invalid citation.

Aggregation is macro averaging with explicit eligible counts; no-hit cases are evaluated through
correct status/answer behavior. Every failed case remains in the report and counts as incorrect,
with zero eligible recall/source-coverage metrics. Tag/difficulty groups use the same rules. A
comparison requires identical case IDs/order/repetition counts, suite/corpus/scoring hashes and
pricing. Incompatible/absent metric denominators are shown as `n/a`. Paired per-case correctness
deltas accompany aggregate quality, timing and cost deltas. Timing/cost deltas are descriptive;
the configurable `--max-quality-drop` only tolerates deterministic quality drops.

Optional `--judge-signals file.json` imports explicitly requested, external model-assisted judgments
as supplemental signals. Each `JudgeSignal` has the exact `observationHash` (case, answer and
provided provenance; excluding clock), model revision, rubric version, score, bounded rationale,
and mandatory `imperfectSupplemental: true`. Scores never change deterministic metrics/gates.
Unknown/duplicate cases or stale input hashes invalidate the run. This prevents mixing judgments
from different model/prompt/context runs; the tool does not claim the judge is ground truth.

## Automated verification

```bash
cd ai-worker
sh scripts/check.sh
uv build --wheel --out-dir dist
cd ../backend
./mvnw -Dtest=SourceExtractionEndToEndTest#evaluationCliMeasuresTheFixedCorpusThroughAuthorizedSpringAndRealPython test
```

The worker check enforces a dedicated **80% branch-aware evaluation coverage gate**. Tests cover
metric arithmetic, pages/spans, Unicode, invalid/invented citations, unsupported added sentences,
scope/corpus drift, failures, pricing, deterministic runs, paired reports, hash-bound judge inputs,
seed idempotence, transport/CSRF/TLS restrictions and the CLI.

The Spring integration test uses real HTTP sessions, uploads, durable ingestion, a real Python
worker and PostgreSQL/pgvector. It runs the fixed suite, verifies reseeding and generated reports,
then performs a paired comparison. Its test-only LLM quota accommodates the suite. No paid API call
or frontend change is required. Test reports remain in `backend/target/evaluation-e2e/`.

RH-346 adds [model candidate comparison](../development/ai-evaluation.md) on this unchanged suite,
plus the reviewed prompt-injection contract. Its [matrix schema](schemas/model-matrix.schema.json)
keeps models, versions, USD prices and adoption thresholds explicit. Missing credentials are recorded
as unavailable. [Published measurements](results/demo-models/models.md) retain all threshold misses;
Gemini 3.8 Flash is preferred but remains unmeasured without a worker key.
