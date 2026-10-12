# Canvas export, recovery and evaluation — CAI-16–18

Date: 2026-10-11. Local macOS arm64 validation; the exact platform, Python, CPU count,
model revision and content hashes are recorded in each benchmark manifest.

## Delivered behavior

The report contract adds frozen v2 inline/display mathematics, an accessible expression,
controlled AST, local PNG and verification reference. Native solution exports retain the
analysis/execution/step identities, original and SI inputs, units, input/problem/plan hashes,
image/runtime identity, code hashes, precision/domain and the verifier receipt.
Arithmetic `CHECKED` and physical interpretation `NOT_CHECKED` remain separate.
Existing v1 snapshots and DATASET references remain readable.

DOCX contains editable native Office Math fractions, powers, subscripts and radicals.
PDF uses JLaTeXMath 1.0.7 in headless Java with embedded local fonts, an AST-only input and
pre-allocation limits of 1600×512 pixels. The GPL-2-or-later linking exception and font notices
are included under `backend/src/main/resources/export/jlatexmath/`; see
[the licensing decision](report-export.md#controlled-mathematical-solutions-cai-16).
LaTeX is generated from the same closed AST and returned as editable sources; the backend
does not execute TeX. Oversized or unsupported notation preserves literal text/source and a
visible warning. Frozen export jobs require no new model or sandbox execution, including
after reproduction, human edits and undo.
Oversized integer exponents are rejected before narrowing, including the signed 64-bit
minimum that could otherwise overflow an absolute-value range check.

Canvas stage admission happens at the actual locked model/retrieval/analysis stage.
Replayed reservations and terminal history do not send a second provider call.
A contextual operation shares one three-transport budget across gateway retries, schema
fallback and bounded output repair. A paid-model marker plus lease fences prevents automatic
repetition after an uncertain crash and prevents late publication after cancellation.
Saved failures retain the prompt. Polish recovery text distinguishes throttling, provider
unavailability, invalid output and revoked access; restoring the prompt only fills the composer.
Polling backs off from 2 to 16 seconds and stops on terminal states/errors.

Queue, routing, retrieval, model, sandbox and insertion durations use closed stage/outcome
labels. IDs go into the append-only product audit; prompt and output text do not.
Existing token/cost telemetry accumulates native response usage, including bounded repair.
Export scheduler shutdown cancels future dispatcher ticks while draining active renders;
two lifecycle tests cover prompt termination and preservation of an already running task.
See [configuration](configuration.md#contextual-canvas-budgets-and-recovery-cai-17) and
[diagnostics](ai-diagnostics.md).

## Reproduce the verification

Install the existing project dependencies: Java 25; Node/npm and both npm trees;
Python 3.13.3 with `ai-worker/.venv` and `sandbox/.venv` from their pinned locks;
Docker with a local Unix socket; Chrome or Playwright Chromium. `uv` is supported but the
worker check also accepts its installed `.venv` when `uv` is absent.

```bash
python3 scripts/demo/canvas-suite.py --output .demo/canvas-suite
python3 scripts/demo/canvas-suite.py --live --output .demo/canvas-suite-live
```

The second command explicitly opts into paid native Gemini calls and reads the private root
`.env` through the same worker-only demo configuration. The ordinary stages strip worker
settings; no key is forwarded to Spring, the frontend, collaboration or the sandbox.
Both sandbox phases are tested before any paid request. An owned local image reference holds
the exact inspected image ID throughout the run and is removed at the end.
The runner executes security review, frontend lint/coverage and both production builds,
collaboration build/coverage, sandbox build, worker coverage, sandbox coverage, demo tests,
full backend verification with all required browser/runtime flags, and the offline benchmark.
It emits private logs and `suite.json`. `--live` only runs after all 24 matrix proofs pass.

`canvas-suite.py` maps every [backlog matrix requirement](canvas-ai-backlog.md#macierz-weryfikacji-końcowej)
to concrete JUnit methods; skipped or missing required tests fail. These include actual Chrome,
Spring, PostgreSQL, worker, Docker, two simultaneous Yjs clients and process restart.
Case 23 additionally requires the real constrained-container timeout/memory recovery test.
The offline benchmark cannot replace browser/API proof or native Gemini quality evidence.
CI requires the same matrix, browser flags, fixed offline benchmark and artifacts in
[ci.yml](../../.github/workflows/ci.yml). Remote CI execution has not been observed here.

## Fixed benchmark and independent scoring

The versioned [43-case dataset](../../ai-worker/src/researchhub_worker/evaluation/fixtures/canvas-suite.json)
contains 25 supported calculations, four missing-input clarifications, two safe failures and
12 contextual/grounded/adversarial text cases. Clarifications use the production input guard
and make no provider request. Native mode therefore has 39 planned provider operations;
each operation can use at most three actual HTTP transports.

Trusted compute and a fresh verifier run in separate networkless/read-only, non-root Docker
containers with bounded CPU, memory, processes and temporary storage. Their input files are
hash-bound. Infrastructure errors fail arithmetic coverage and cannot pass a safe-error case.
An independent standard-library Fraction/quadratic-residual oracle checks results, both roots,
both elimination equations and all plot points; it never uses the runtime CAS.
The two-variable case uses the supplied expressions x=(sum+difference)/2 and
 y=(sum−difference)/2. This does not establish a general multivariable symbolic solver.

Citation membership is scored separately from semantic support. Curated full-statement rules
check claims against the exact cited synthetic protocol, including units and rejection of
negations/new numbers/unrelated qualitative claims. They do not prove entailment for arbitrary
sources. Native reports retain validated normalized DTOs for these public synthetic fixtures;
raw provider responses, private prompts and keys are excluded.

The manifest records dataset, prompt, contract, scorer, runtime and image hashes, model/version,
hardware, timestamp and skip count. The fixed release gates are 99% valid schemas, 95%
arithmetic accuracy and answer coverage, 100% reference/injection/refusal integrity, 90%
grounded support and p95 targets of 15 seconds for short text and 60 seconds for small problems.
Cost uses the committed model matrix price version, not an invoice. Unknown billing for failed
HTTP transports remains unknown and is distinguished from measured successful-response usage.

## Recorded verification

The final all-layer suite is being finalized. The complete production-prompt measurement
completed 43 cases with zero skips, 39 model operations and 66 actual HTTP transports
(27 schema rejections followed by the bounded fallback). Contextual transport admission
is capped at three per operation and is verified by the shared-budget tests.
The 25 arithmetic results and answer coverage, schemas, references and injection checks
scored 100%. Seven expected refusals passed: four local missing-input guards and three native
no-evidence refusals. Native short text p50/p95: 2.879/4.072 seconds; small problems including
both containers p50/p95: 7.633/8.556 seconds. Input/output tokens: 70,506/24,353.
Known-response cost at the configured matrix rate: USD 0.14420325. Failed HTTP transport
billing is unknown; this is a partial usage-based estimate, not a complete invoice.

Native grounded support initially scored 50% because two direct quotations with neutral
reporting headers fell outside the finite grammar. The [original result](../evaluation/results/canvas-ai-2026-10-11/live-original.json)
and [measured dataset](../evaluation/results/canvas-ai-2026-10-11/dataset-measured.json) remain
unchanged. Review added grammatical alternatives for reporting the same cited 25 °C/12 V facts;
negative tests reject changed numbers/units, negations and added qualitative claims.
Version `2026-10-11.3` scores the archived validated answers at 100% support, with all nine gates
passing. The [reviewed report](../evaluation/results/canvas-ai-2026-10-11/live.json) retains
original scores/gates and measurement hashes plus distinct rescoring metadata. This is a
reviewed rescore of the same measurement, not a second independent native sample.
Inputs, arithmetic evidence, thresholds, latency, tokens and provider calls remain unchanged.

Reproduce the review without a key, Docker or paid calls:

```bash
cd ai-worker
.venv/bin/python -m researchhub_worker.evaluation.canvas \
  --rescore-from ../docs/evaluation/results/canvas-ai-2026-10-11/live-original.json \
  --measured-dataset ../docs/evaluation/results/canvas-ai-2026-10-11/dataset-measured.json \
  --output /tmp/canvas-live-reviewed.json
```

The rescorer verifies the measured dataset hash, unchanged inputs/identities/thresholds,
and normalized answer/reference contracts. Changes to problem inputs or the arithmetic oracle
are rejected. [Native Markdown results](../evaluation/results/canvas-ai-2026-10-11/live.md),
[offline results](../evaluation/results/canvas-ai-2026-10-11/offline.md).

## Existing demo installation

`scripts/demo/up.sh` was exercised against the existing local installation without resetting
the database. The sandbox build stamp matches its Dockerfile, lock and runtime; the image
is pinned to `researchhub-sandbox:1.2.0`. Chrome verified two secure sessions, same-origin
WebSockets, the demo banner/model fixture chip and closed registration. Container settings
were checked in memory: only the worker receives `GEMINI_API_KEY`, and the Spring environment
excludes it. Repeating `up.sh` preserves the saved accounts and seed manifest byte for byte.
The [demo proof](../evaluation/results/canvas-ai-2026-10-11/demo.json) records observed timings
with warm dependencies and images. It contains no account credentials or environment values.

## Visual export checks

`MathReportRenderingTest` produces a 30-step mathematical solution and a long/hostile-notation
fallback in `backend/target/export-qa/`, plus PDF page PNGs. The DOCX was independently opened
and converted with LibreOffice 26.8 and inspected: inline and block fractions, superscript,
subscript and square root were visible and editable in the source DOCX. Native Java PDF
first/last pages preserve all steps and warnings. The long fallback wraps, keeps source and
warning text, and does not activate literal URL/HTML/TeX commands.
Native PROBLEM integration and both browser editor modes download DOCX, PDF and LaTeX ZIP,
including the frozen plot and receipt metadata. These generated binary QA files remain ignored;
CI publishes them as artifacts rather than adding binary outputs to the repository.

## Earlier measurements and practical limits

Earlier native attempts are retained with failed gates: `live-initial` exposed Gemini's
rejection of the heterogeneous AST response schema; the adapter now has one local-validation
JSON fallback. `live-fallback` recorded image lookup failures when a mutable Docker tag was
rebuilt during evaluation. `live-platform-failed` demonstrated that Docker's platform/config
ID was not locally executable by digest in this containerd store. The owned reference and
preflight now prevent these failures from consuming a paid benchmark. These failed reports
are diagnostic history and are not release evidence. A further diagnostic measurement found a
truncated benchmark prompt at a Java string semicolon; the loader now consumes complete string
literals and has an explicit regression test against the production instruction tail.

This run uses warm dependency/image caches on one local machine. It does not establish cold
startup timing, arbitrary source entailment, unsupported mathematics, an independent physical
proof, cloud sandbox readiness or remote CI execution.
