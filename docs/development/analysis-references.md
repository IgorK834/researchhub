# Analysis references and computed evidence (RH-155, RH-156, RH-305)

The implementation extends the existing analysis records, report editor, grounded model gateway and
conversation flow. Spring remains a modular monolith and owns workspace authorization and persistence;
the Python worker handles model context only. No additional runtime, plotting package or infrastructure
is introduced. Existing scientific computations still run through the separately pinned sandbox.

## Report blocks

Insert result selects a destination report, a successful saved output, caption and insertion position.
The existing PATCH API checks the destination's revision. A conflict requires explicitly reloading the
destination; retrying does not overwrite someone else's report. Each inserted atom has a stable UUID
block ID and stores only `analysisId`, `executionId`, the execution-scoped output name and render mode
CHART/TABLE/SUMMARY, plus an inert caption. The [versioned block contract](../../contracts/analysis/document-block/v1/README.md)
defines bounds and validation. SUMMARY shows persisted text and performs no new summarization.

The server validates these references on creation, revision saves, AI acceptance and version restore.
It requires a successful persisted output, matching mode, exact attributes and authorized workspace/source
versions. Client URLs, inline code, malformed nodes, duplicate block IDs and foreign executions are rejected.
The document JSON and existing version snapshots retain the reference; no new document table is needed.

The editor NodeView loads the exact historical record and authenticated image. It displays input versions,
code hash and execution identity and opens provenance details. A newer source produces an informational
freshness warning; a rerun never silently changes an existing report block. Update reference opens an
explicit saved-execution/output picker, then uses the normal revision-checked autosave. Earlier document
versions keep their old references. Permission changes refresh these controls without editing or saving
the report; the selection callback also checks current editability. Viewer and archived reports remain
read-only. The source sidebar, history preview and diff preserve the same historical identity.

## Source and computed evidence

Questions and conversation messages accept up to six explicit saved-output references. The default is
none; the UI never chooses a latest execution. The gateway resolves each successful output using the
existing computation-provenance service. Tables contain exact bounded rows/columns, total row count and
a truncation flag; text is persisted output text; charts provide validated metadata rather than inferred
numeric points. Python code, stdout/stderr and image bytes are excluded from model context.

The existing model request envelope stays at version 2.0. Context builder 2.0 provides independent S/A
keys: S1 identifies a textual source excerpt, A1 a persisted execution output. Java and Python validate
framing, hashes, evidence mappings and shared budgets; the combined evidence list is bounded to 12 items.
Source-only builder 1.0 and question-template v1 audits remain readable. The immutable
`workspace-question:2` template forbids new calculations, invented experimental results, deriving missing
statistics from truncated data and unsupported claims of agreement with theory.

Responses retain source `citations` and add `analysisCitations`; generation audits retain every selected
computed evidence item with exact input versions, execution/code hashes, timestamp and runtime. Flyway
V24 adds bounded JSON metadata to generation audits and the computed scope to conversation user messages.
Conversation idempotency includes that scope. Authorization and evidence identity are rechecked after
inference. An insufficient response has no source or analysis citations and keeps its audit metadata.

React displays source citations and computed evidence separately. S opens the source fragment/page path;
A opens exact historical analysis provenance. The UI explains that answering did not run a calculation.
The [shared v2 fixtures](../../contracts/ai/questions/v2/README.md) are read by Java, Python and TypeScript tests.
Scope/identity enforcement does not prove semantic entailment: evaluating agreement with theory remains
the configured production model's evaluation concern. The deterministic provider is an extractive offline
fixture, used to verify transport and provenance without a paid cloud call.

## Presentational component boundary

RH-305 exports seven typed primitives in `AnalysisWidgets.tsx`: status chip, pipeline cards, read-only
line-numbered code panel, paginated result table, chart frame, freshness banner and analysis list item.
They take presentation values and callbacks only and import neither APIs/routes nor planner/sandbox
contracts. Code and every supplied string render as inert text. The caller explicitly identifies a
calculated column; the table does not infer one. ChartFrame has no plotting layer. Integration adapters
handle saved contracts, fetching and navigation outside the primitives.

The implementation follows `Analysis_studio.pdf` pages 1/3, `Results,provenance&insert.pdf` pages 1/3 and
`Components&states.pdf` page 2, using existing typography, spacing and yellow computation provenance.
Details panels and selectors wrap long output metadata and analysis names in narrow layouts.

## Verification on 2026-10-05

- Full backend `ANALYSIS_SANDBOX_TESTS=true ./mvnw -q verify`: 722 tests passed, zero failures/errors/skips,
  including actual PostgreSQL, Python worker and Docker computation E2E. Three additional context-contract
  tests passed separately. After the final insufficiency-message change, `WorkspaceQuestionServiceTest`
  passed again and `./mvnw -q -DskipTests verify` rebuilt the JAR and passed all coverage gates.
  The accumulated report contains 725 passing tests and no skipped tests.
- Java Analysis: 99.18% line / 83.23% branch coverage. Java AI: 98.46% line / 80.51% branch coverage.
  Context: 100% line / 91.30% branch coverage. Maven enforces the existing 80% line gates.
- Frontend: 91 suites / 926 tests passed with coverage. Analysis: 98.81% lines / 92.97% branches;
  Documents: 99.60% lines / 93.65% branches; AI: 99.12% lines / 95.75% branches. Each feature's
  80% statement/branch/function/line gate passed. The seven pure presentation components have 100%
  coverage on all four metrics. Critical insertion/reference/evidence components have individual gates.
  Typecheck, lint, formatting and the production Webpack build passed; existing bundle-size warnings remain.
- Full Python worker: 365 tests passed; overall statement/branch coverage 97.20%, AI 97%, context 99%.
  Its module gates remain at 80%; runtime and dependency versions are unchanged.
- Actual CSV E2E replaces the input source, reruns original and latest inputs, saves/reloads a chart
  report block and verifies its exact execution/version identity. A mixed question through the actual
  worker returns S1 from indexed source metadata and A1 from the persisted numerical table.
  Separate HTTP tests verify explicit reference updates, restore/history, CSRF, permissions, foreign
  references, optimistic conflicts, failed outputs, fabricated evidence and conversation replay scope.
- React tests use the real Tiptap schema/NodeView for rendering, explicit output replacement and
  permission transitions without content updates. Visual QA uses the production build and actual
  saved E2E record, PNG, report and mixed response through a temporary read-only preview API.
  It checks chart/source/code provenance, the update picker and desktop/narrow layouts; preview
  writes are disabled, so persistence evidence comes from authenticated HTTP and editor tests.

Reproduce frontend validation with `npm run test:coverage -- --runInBand`, `npm run lint`,
`npm run build` and `npm run format:check`. Backend full verification needs a running Docker daemon
and the pinned `researchhub-sandbox:1.1.1` image. Worker verification uses `sh scripts/check.sh`.
