# Academic report export — RH-230, RH-231, RH-232

The `export` module owns conversion of stored document nodes to a frozen, versioned report, and generation of DOCX/PDF files. It remains part of the Spring modular monolith. Rendering runs entirely in Java, without a browser, Tiptap, Python worker, LibreOffice process, or external rendering service. The existing document/citation nodes (Task 12.4) and saved analysis references (Task 15.6) supply the inputs.

## User flow and design references

Open a document, select **Export**, choose Word or PDF, then **Generate export** and **Download**. Export is available to every workspace content reader, including viewers and readers of archived documents/workspaces. Generation is disabled while local edits are unsaved, the collaborative editor is disconnected, an AI change is pending, or a history preview is open. A stale server revision produces the existing `409 CONFLICT` response with `currentRevision`; the user reloads the latest document.

The dialog uses the existing Button/Dialog primitives and design tokens. Document_editor.pdf p.1 and DESIGN_SPEC.md describe the serif paper, heading hierarchy, tables and numbered evidence; Results,provenance&insert.pdf p.3 describes chart/table captions and analysis/source references. No export-specific report dialog was supplied in those references, so the feature adds a small dialog in the document action bar. Existing report and editor structure is preserved.

Closing the dialog leaves rendering active; reopening it in the same mounted editor recovers the job. Navigating away does not cancel server work. Generated artifacts expire after the configured retention period (seven days by default). Expiration releases the large snapshot/artifact bytes; the job's revision, format, checksum, size, requester, timestamps and terminal status remain. Users keep downloaded files independently.

## Explicit HTTP contract

All routes use the normal session/CSRF policy and `WorkspaceAuthorizationService.requireContentReader`. Resource lookup includes **workspace ID, document ID and job ID**. A non-member or substituted document/workspace returns `404`; anonymous requests return `401`. Expired snapshot/download requests are rejected from the timestamp even before background cleanup runs. Status, snapshot and download responses use `Cache-Control: no-store`.

Base path: `/api/workspaces/{workspaceId}/documents/{documentId}/exports`.

| Route | Input | Response |
| --- | --- | --- |
| `POST /exports` | `{"format":"DOCX" or "PDF","revision":positive integer}` | `202`, `Location` pointing to the job, `ExportJob` JSON |
| `GET /exports/{jobId}` | None | `200`, job metadata |
| `GET /exports/{jobId}/representation` | None | `200`, frozen report schema `1.0`; `409` when expired |
| `GET /exports/{jobId}/download` | None | `200`, bytes with explicit media type, UTF-8 attachment filename and content length; `409` until successful or after expiration |

`ExportJob`: `id`, `workspaceId`, `documentId`, `requestedBy`, `revision`, `format`, `status`, `filename`, `warnings`, `createdAt`, nullable `startedAt`/`finishedAt`, `expiresAt`, nullable `failureCode`/`sha256`, `sizeBytes`. Times are ISO-8601 UTC instants. States: `QUEUED → RUNNING → SUCCEEDED | FAILED`; any retained state may become `EXPIRED`. Checksums are lowercase SHA-256 over the downloadable bytes. The artifact's actual format and revision come from the job, even if the editor has changed since it was generated.

Safe failure codes: `RENDER_FAILED`, `OUTPUT_TOO_LARGE`, `ACCESS_REVOKED`, `RENDER_INTERRUPTED`. Details from library exceptions, document contents and storage paths are never exposed as failure text. Unsupported nodes/marks, malformed references, invalid merged tables and unsupported image URLs return `400 VALIDATION_FAILED` before a job is created. Structural/asset/snapshot limits return `413 PAYLOAD_TOO_LARGE`; a full workspace queue returns `409 CONFLICT`.

## Stable intermediate representation

The public Java contract is `export.domain.Report`. Its JSON discriminators are explicit `kind` values; it contains no ProseMirror/Tiptap types. `EditorReportAdapter` is the only converter of editor node names. Both renderers consume the report, so a later LaTeX writer can use the same contract without knowing the editor's schema. Schema `1.0` snapshots are serialized and tested through a full JSON round trip.

A report has `schemaVersion`, `workspaceId`, `documentId`, `revision`, `title`, `capturedAt`, `blocks`, `bibliography`, `origins`, `warnings`.

| Block kind | Payload |
| --- | --- |
| `paragraph` | Inline `content`; `caption` identifies captions |
| `heading` | Level 1–6 and inline `content` |
| `list` | `ordered`, positive `start`, `items` containing block arrays (nested lists supported) |
| `table` | Row arrays of cells with `header`, `colspan`, `rowspan`, `blocks`; `caption`, optional analysis `provenance` |
| `image` | Embedded `pngBase64`, pixel `width`/`height`, `alt`, `caption`, optional analysis `provenance` |
| `container` | Nested `blocks`, `quote` (also used for figure containers) |
| `code`, `rule` | Source text / structural divider |
| `equation` | Reserved `notation` and `source`; renderers show the source notation, pending future math typesetting/editor support |

Inline `text` stores its text and a set of `BOLD`, `ITALIC`, `UNDERLINE`, `STRIKE`, `CODE` styles. Inline `citation` stores a numeric bibliography label and a full `SourceReference`. Hard breaks become newline text; comment anchors are review metadata and do not appear in report prose. Unknown content is rejected explicitly rather than dropped.

`SourceReference` keeps source/version IDs, server-owned version number/title/upload SHA-256, stored processing version, chunk ID, cited content hash, inclusive page range, section and spans (`unitId`, `characterStart`, `characterEnd`). Source/version ownership is checked through the source module; a stored citation's locator is preserved, not reinterpreted as a new retrieval result. Legacy citations without an immutable source version bind to the active version at capture time and produce a visible export warning.

The MVP citation style is numeric in first-source-occurrence order, deduplicated by `(sourceId, sourceVersionId)`. Each occurrence retains its own locator, e.g. `[1, p. 3-4]`. References include the title, immutable source version ID/number and full upload checksum. Authors, dates, journal names and DOIs are not fabricated; richer bibliographic metadata belongs to its own backlog task.

Analysis nodes resolve the exact `(analysisId, executionId, outputId, renderMode)` through `ExecutionService`. Only successful saved outputs are accepted. Tables use saved columns/rows; charts use checksum-verified saved PNG/SVG bytes, normalized to embedded PNG. The document's specified caption remains. Visible source/analysis notes retain input file versions, analysis/execution/output IDs and code SHA-256. The IR also retains the trusted latest operation for each tracked block: category, actor, operation IDs, revision, timestamp and its original metadata JSON. Client `originIntent` attributes never manufacture export provenance.

## Runtime and persistence

`V32__report_exports.sql` adds a workspace-owned queue with a composite document foreign key, state/size/schema checks and a trigger protecting snapshot identity and state transitions. No existing content is rewritten. Enqueue reads the document and block provenance in a repeatable-read transaction. The store commits the immutable snapshot in a separate short read-committed transaction, locking the workspace before checking its pending-job count; this serializes concurrent requests without holding a snapshot transaction open during rendering.

Claim uses `FOR UPDATE SKIP LOCKED`. The dedicated one-thread `exportScheduler` renders off HTTP and other module dispatchers. Membership is rechecked before and after rendering; every public read/download also authorizes the current caller. A claim older than ten minutes fails with `RENDER_INTERRUPTED`; a late worker cannot overwrite a terminal result. A restart preserves queued jobs. No generated code or URLs are executed or fetched.

| Setting | Default | Purpose |
| --- | --- | --- |
| `researchhub.export.retention` / `EXPORT_RETENTION` | `PT168H` | Positive duration, at most 30 days |
| `researchhub.export.dispatcher.enabled` / `EXPORT_DISPATCHER_ENABLED` | `true` | Disable automatic dispatch for deterministic tests |
| `researchhub.export.dispatcher.fixed-delay` / `EXPORT_FIXED_DELAY` | `PT1S` | Poll delay on the dedicated scheduler |

Fixed MVP limits: four queued/running exports per workspace; nesting 64; 50,000 nodes; 20,000 total table cells; at most 20 logical columns per table; 8 MiB per image; 16 million raster pixels; 24 MiB serialized snapshot; 32 MiB output. Wide/malformed tables fail explicitly rather than generating clipped artifacts. SVGs reject scripts, external entities, external links/styles and resource URLs, and rasterize with external resource execution disabled. PDF rendering permits only generated embedded PNG resources. Filenames normalize Unicode, remove path/control characters, handle Windows device names, and bound the stem to 100 characters.

DOCX uses real OOXML heading styles, paragraphs, numbering, cell spans, repeating header rows and embedded drawings via [Apache POI](https://poi.apache.org/components/document/quick-guide-xwpf.html). PDF uses [OpenHTMLToPDF](https://github.com/openhtmltopdf/openhtmltopdf), A4 pages, repeated table headers, wrapping, widow/orphan controls, and embedded DejaVu fonts (license included alongside the fonts). POI, OpenHTMLToPDF and Batik are explicitly pinned because the Spring Boot BOM does not manage these components; their managed transitive dependencies continue to use the Boot BOM. No frontend dependency was added; `package-lock.json` stays authoritative.

## Verification

Run from `backend/`: `./mvnw verify`. The `export-coverage` JaCoCo execution enforces at least 80% line coverage for the complete `dev.researchhub.export` module, including API and persistence. Focused tests: `./mvnw -Dtest='*Export*,EditorReportAdapterTest,ReportRenderingTest' test`.

Run from `frontend/`: `npm run lint`, `npm run build`, `npm run test:coverage -- --runInBand`. The export feature has separate 80% gates for lines, statements, functions and branches.

Browser E2E after building the frontend: from `backend/`, `EXPORT_BROWSER_TESTS=true ./mvnw -Dtest=ExportApiIntegrationTest test`. The test starts an isolated PostgreSQL container, runs real Chrome against the production bundle and Spring API, generates both formats and verifies downloads. It uses installed Chrome by default or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Screenshots, downloaded binaries and test-generated reports are in ignored `backend/target/export-qa/`.

Tests cover frozen revision/source-version provenance, numeric citations with distinct locations, nested/merged tables, PNG/SVG charts, UTF-8 filenames/text, office reopening, PDF text/image extraction, long-document pagination, stale saves, viewers, cross-workspace/document isolation, CSRF, queue capacity, interrupted claims and expiration. Visual QA renders generated DOCX through bundled LibreOffice and PDF through Poppler; neither is required by the product runtime.

Verified on 2026-10-07: full backend `EXPORT_BROWSER_TESTS=true ./mvnw verify` succeeded (858 tests, zero failures/errors, seven skipped); all 18 export tests ran, including the browser test. Export JaCoCo coverage was 583/595 lines (97.98%) and 384/472 branches (81.36%). Frontend lint, formatting, production build and all 1,046 tests in 110 suites passed; export coverage was 95% lines, 100% branches and 90% functions. Visual checks included opening DOCX in LibreOffice, both downloaded formats, and all pages of a 16-page PDF with a 150-row table and repeated headers.

LaTeX generation, equation typesetting, custom citation styles, source bibliographic metadata editing, unrelated storage providers and collaboration changes are outside these three tasks.
