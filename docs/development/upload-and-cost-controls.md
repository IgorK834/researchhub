# Upload and costly-request controls (RH-180 / RH-181)

The security module is part of the Spring modular monolith. It supplies public upload inspection/scanning and quota contracts; Python document parsing stays in the worker. There are no new runtime libraries, database tables, or infrastructure services.

## Upload boundary

The servlet rejects files over **50 MiB** and multipart requests over **51 MiB**. `researchhub.sources.max-size-bytes` can lower the per-file limit but cannot exceed the 50 MiB hard ceiling. The metered stream enforces the actual byte count even when the declared size is missing or false. Multipart and staging use disk rather than retaining the entire upload in Java memory.

Workspace editor authorization runs before reading the upload. Filenames are metadata: discard directory segments, normalize Unicode to NFC, strip control/format/surrogate/line-separator characters, replace reserved filename characters, and reject empty/dot names or more than 255 UTF-16 units. Both the factory and record constructor enforce these invariants. Storage keys and private temporary paths are generated independently of the filename.

Before creating a blob, source/version row, audit event, or ingestion job, uploads are staged in a random temporary file, inspected, then passed through any registered `UploadScanner` adapters. Staging files are deleted on success or failure; blob storage failures retain the existing compensation behavior. A scanner rejection/unavailability must fail closed. No scanner is configured in the local MVP, and these checks do not claim malware detection.

Detection combines allowlisted extension, declared MIME, a byte signature, and validation of staged content:

- PDF requires `%PDF-`; structural validity, encryption and extraction are checked by the isolated worker. A malformed PDF becomes a durable, safe `FAILED` ingestion result.
- DOCX/XLSX require a real ZIP directory, `[Content_Types].xml`, `_rels/.rels`, the correct main part and its exact OOXML content type. A workbook renamed `.docx`, generic/truncated ZIP, macros/ActiveX, unsafe/duplicate entry names, excessive expansion, and XML external entities/DTDs are rejected. No archive entry is extracted to a filesystem path.
- TXT/CSV must be UTF-8 throughout the file, with permitted text controls only. Recognizable archives, executables and PDFs renamed as text are rejected. CSV delimiter/schema errors remain safe worker failures.
- Standalone archives/compressed files and macro-enabled Office extensions remain unsupported (`415 UNSUPPORTED_FILE_TYPE`). Content failures also return this stable code. Oversize input returns `413 PAYLOAD_TOO_LARGE`.

Office limits: 10,000 entries, 100 MiB total declared uncompressed size, expansion ratio at most 200 for parts over 1 MiB, and 64 KiB content-type metadata. Worker checks additionally reject encrypted ZIP entries and symlinks. XML metadata parsing forbids DTD/entity expansion. Office parsers inspect data; they execute neither macros nor spreadsheet formulas.

## Killable parser boundary

`IdempotentSourceIngestProcessor` uses `IsolatedSourceParser` by default. Each extraction runs in a fresh subprocess, not an API thread. The parent terminates and reaps the process group on deadline; subsequent work can continue. The child receives only parser/chunking/local blob-origin settings, not provider credentials or the worker service token. Download failures remain retryable and uncached; bounded parser failures are terminal/idempotent results.

| Environment setting | Default | Accepted range |
| --- | --- | --- |
| `AI_WORKER_PARSE_TIMEOUT_SECONDS` | 20 seconds wall time, including download | 1–25 |
| `AI_WORKER_PARSE_CPU_SECONDS` | 15 CPU seconds | 1–20 |
| `AI_WORKER_PARSE_MEMORY_MIB` | 512 MiB address space | 128–1024 |

The Linux worker child enforces CPU, address-space, output-file and zero-core-dump limits before importing parsers. Host macOS development enforces CPU/time/output limits; reliable address-space enforcement is supplied by the Linux container. Compose runs the worker as its existing non-root user with a read-only root filesystem, 128 MiB temporary filesystem, 1 GiB container memory, 64 PIDs, dropped capabilities and no new privileges.

Extraction remains bounded to 500,000 characters, 10,000 units and a 4 MiB serialized result, plus existing page/sheet/row/column/chunk limits. Child stdout/stderr are temporary files bounded by a 4 MiB + 64 KiB file limit; only up to 4 MiB of validated output enters the API process. Safe failure codes include `EXTRACTION_TIMEOUT`, `EXTRACTION_RESOURCE_LIMIT_EXCEEDED`, `EXTRACTION_LIMIT_EXCEEDED`, and `DOCUMENT_PARSE_FAILED`. No raw parser diagnostics or signed source URLs are published.

## Costly request admission

`@CostlyOperation` explicitly marks endpoints; admission runs after authentication/CSRF and workspace authorization, before controller arguments/services/provider calls. Servlet async/SSE redispatch consumes the original admission only once. Domain services retain their resource-level and publication-time authorization checks.

Both budgets are global for a category: a user across all workspaces, and a workspace across all users. `CostQuotaStore.admit` must check/consume both atomically; refusal consumes neither.

| Category | User / minute | Workspace / minute | Endpoints |
| --- | ---: | ---: | --- |
| `LLM` | 20 | 60 | Generation, workspace questions, authoring suggestions, source comparisons/disagreements, conversation messages (including streaming), comment AI evidence |
| `ANALYSIS` | 10 | 30 | Plan, execute, rerun; covers bounded internal planning attempts as one public request |
| `RETRIEVAL` | 60 | 180 | Semantic retrieval search, which can invoke query embeddings |

Ordinary traffic (workspace/document/source reads, conversation history, suggestion acceptance, analysis drafts/status/artifacts) consumes none of these budgets. Query embeddings inside an already admitted LLM operation are covered by that request. Authentication/workspace authorization failures consume no budget. Authenticated admitted requests consume budget even if body validation, resource lookup, idempotency or the provider later fails; this is a **request limit, not token billing**. The client never automatically retries quota failures.

Settings live under `researchhub.security.quotas`: `window` (1 second–1 day), `llm.user/workspace`, `analysis.user/workspace`, `retrieval.user/workspace`, and `max-buckets` (default 100,000). Invalid policies fail startup. In-memory state is bounded and expired windows release capacity; exhaustion fails closed with the same error contract.

The configured adapter exists only on the **local single-instance profile**. Budgets reset on restart and fixed windows can allow bursts across a boundary. Multi-instance/external deployment must provide an atomic shared `CostQuotaStore` adapter; splitting these budgets across instances is unsupported. The abstraction avoids requiring Redis or another infrastructure service for the portfolio MVP.

Rejection contract: HTTP `429`, `application/problem+json`, `code: RATE_LIMIT_EXCEEDED`, `quotaCategory: LLM | ANALYSIS | RETRIEVAL`, positive `retryAfterSeconds`, `Retry-After` header with that same delay and `Cache-Control: private, no-store`. No provider call, generation run or analysis execution is created on refusal. The frontend preserves input and displays a clear delay through its shared error formatter.

## Verification

`./mvnw verify` enforces 80% line and branch coverage for `dev/researchhub/security/**`. HTTP integration tests cover oversize, spoofed Office packages, unsupported archives, path-like filenames, atomic shared quotas, unauthorized callers and denial before provider/planner/execution. Existing Spring → Python → source publication E2E tests cover malformed PDFs and valid document extraction.

`ai-worker/scripts/check.sh` runs the worker suite and an explicit 80% gate for process/Office security. Tests kill real timed-out/CPU-limited/output-limited children, verify credential isolation, and run the actual parser on malformed PDF followed by valid Unicode text. Frontend coverage tests verify quota decoding, safe delay bounds, preserved research input and no automatic retry; source upload copy follows the failure pattern in `design-reference/DESIGN_SPEC.md` and `Sources.pdf`.

Design/security references: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) and [Python resource limits](https://docs.python.org/3/library/resource.html).

For the real production-frontend/Chrome → Spring flow, first build the frontend with `npm run build`, then run `SECURITY_BROWSER_TESTS=true ./mvnw verify` in `backend`. The browser test checks the rejected forged DOCX, the actual SSE endpoint's 429 response, preserved input, no automatic retry and no published blob/job/model work. Screenshots and the runner log are written under `backend/target/security-*`.

Verified locally on 2026-10-06:

- Full backend verify: 800 tests, zero failures/errors, 5 optional Docker-sandbox/realtime-browser tests skipped; security Chrome E2E enabled and passed. Final Office/upload/worker/Chrome regression: 76 tests passed.
- Security JaCoCo: 100% lines and 86.30% branches, with both 80% gates enforced.
- Worker: 381 tests passed; total coverage 97.14%, parser/Office security coverage 97.22% (including branches).
- Frontend: 1007 tests in 104 suites passed; shared quota/error code and upload UI retain 100% line coverage. Production Webpack build, TypeScript, lint and formatting passed; existing bundle-size warnings remain.
- Docker worker image built; Linux checks verified real RAM/CPU/time termination, uid 10001, 1 GiB container memory, 64 PIDs and read-only root filesystem.
