# Academic report export — RH-230, RH-231, RH-232, RH-233

The `export` module owns conversion of stored document nodes to a frozen, versioned report, and generation of DOCX/PDF files and LaTeX source bundles. It remains part of the Spring modular monolith. Rendering runs entirely in Java, without a browser, Tiptap, Python worker, LibreOffice process, TeX compiler, or external rendering service. The existing document/citation nodes (Task 12.4) and saved analysis references (Task 15.6) supply the inputs.

## User flow and design references

Open a document, select **Export**, choose Word, PDF or **LaTeX sources (.zip)**, then **Generate export** and **Download**. The LaTeX option downloads editable sources with included figures for local typesetting. Export is available to every workspace content reader, including viewers and readers of archived documents/workspaces. Generation is disabled while local edits are unsaved, the collaborative editor is disconnected, an AI change is pending, or a history preview is open. A stale server revision produces the existing `409 CONFLICT` response with `currentRevision`; the user reloads the latest document.

The dialog uses the existing Button/Dialog primitives and design tokens. Document_editor.pdf p.1 and DESIGN_SPEC.md describe the serif paper, heading hierarchy, tables and numbered evidence; Results,provenance&insert.pdf p.3 describes chart/table captions and analysis/source references. No export-specific report dialog was supplied in those references, so the feature adds a small dialog in the document action bar. Existing report and editor structure is preserved.

Closing the dialog leaves rendering active; reopening it in the same mounted editor recovers the job. Navigating away does not cancel server work. Generated artifacts expire after the configured retention period (seven days by default). Expiration releases the large snapshot/artifact bytes; the job's revision, format, checksum, size, requester, timestamps and terminal status remain. Users keep downloaded files independently.

## Explicit HTTP contract

All routes use the normal session/CSRF policy and `WorkspaceAuthorizationService.requireContentReader`. Resource lookup includes **workspace ID, document ID and job ID**. A non-member or substituted document/workspace returns `404`; anonymous requests return `401`. Expired snapshot/download requests are rejected from the timestamp even before background cleanup runs. Status, snapshot and download responses use `Cache-Control: no-store`.

Base path: `/api/workspaces/{workspaceId}/documents/{documentId}/exports`.

| Route | Input | Response |
| --- | --- | --- |
| `POST /exports` | `{"format":"DOCX" or "PDF" or "LATEX","revision":positive integer}` | `202`, `Location` pointing to the job, `ExportJob` JSON |
| `GET /exports/{jobId}` | None | `200`, job metadata |
| `GET /exports/{jobId}/representation` | None | `200`, frozen report schema `1.0`; `409` when expired |
| `GET /exports/{jobId}/download` | None | `200`, bytes with explicit media type, UTF-8 attachment filename and content length; `409` until successful or after expiration |

`ExportJob`: `id`, `workspaceId`, `documentId`, `requestedBy`, `revision`, `format`, `status`, `filename`, `warnings`, `createdAt`, nullable `startedAt`/`finishedAt`, `expiresAt`, nullable `failureCode`/`sha256`, `sizeBytes`. Times are ISO-8601 UTC instants. States: `QUEUED → RUNNING → SUCCEEDED | FAILED`; any retained state may become `EXPIRED`. Checksums are lowercase SHA-256 over the downloadable bytes. The artifact's actual format and revision come from the job, even if the editor has changed since it was generated.

Download media types/extensions are explicit: `DOCX` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.docx`; `PDF` → `application/pdf`, `.pdf`; `LATEX` → `application/zip`, `.zip`. The LaTeX API response is one bundle containing the `.tex` file and every referenced local image.

Safe failure codes: `RENDER_FAILED`, `OUTPUT_TOO_LARGE`, `ACCESS_REVOKED`, `RENDER_INTERRUPTED`. Details from library exceptions, document contents and storage paths are never exposed as failure text. Unsupported nodes/marks, malformed references, invalid merged tables and unsupported image URLs return `400 VALIDATION_FAILED` before a job is created. Structural/asset/snapshot limits return `413 PAYLOAD_TOO_LARGE`; a full workspace queue returns `409 CONFLICT`.

## Stable intermediate representation

The public Java contract is `export.domain.Report`. Its JSON discriminators are explicit `kind` values; it contains no ProseMirror/Tiptap types. `EditorReportAdapter` is the only converter of editor node names. All three renderers consume the same report without knowing the editor's schema. Schema `1.0` snapshots are serialized and tested through a full JSON round trip.

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

The MVP citation style is numeric in first-source-occurrence order, deduplicated by `(sourceId, sourceVersionId)`. Each occurrence retains its own locator, e.g. `[1, p. 3-4]`. References resolve normalized workspace-curated title, ordered authors, year, venue, DOI, URL and citation key when supplied, with the display name as a title fallback. They retain the immutable source version ID/number and full upload checksum; bibliographic metadata is frozen at capture and missing fields stay absent. See [source-library.md](source-library.md).

Analysis nodes resolve the exact `(analysisId, executionId, outputId, renderMode)` through `ExecutionService`. Only successful saved outputs are accepted. Tables use saved columns/rows; charts use checksum-verified saved PNG/SVG bytes, normalized to embedded PNG. The document's specified caption remains. Visible source/analysis notes retain input file versions, analysis/execution/output IDs and code SHA-256. The IR also retains the trusted latest operation for each tracked block: category, actor, operation IDs, revision, timestamp and its original metadata JSON. Client `originIntent` attributes never manufacture export provenance.

## Runtime and persistence

`V32__report_exports.sql` adds a workspace-owned queue with a composite document foreign key, state/size/schema checks and a trigger protecting snapshot identity and state transitions. No existing content is rewritten. Enqueue reads the document and block provenance in a repeatable-read transaction. The store commits the immutable snapshot in a separate short read-committed transaction, locking the workspace before checking its pending-job count; this serializes concurrent requests without holding a snapshot transaction open during rendering.

`V33__latex_report_exports.sql` extends the format constraint to `LATEX` and gives the expanded constraint an explicit name. V32 and previously generated artifacts remain unchanged. LaTeX uses the same asynchronous queue, authorization checks, retention, failure codes and output limits. Source generation and ZIP packaging use existing Jackson and Java's standard library; no runtime or frontend dependency is added.

Claim uses `FOR UPDATE SKIP LOCKED`. The dedicated one-thread `exportScheduler` renders off HTTP and other module dispatchers. Membership is rechecked before and after rendering; every public read/download also authorizes the current caller. A claim older than ten minutes fails with `RENDER_INTERRUPTED`; a late worker cannot overwrite a terminal result. A restart preserves queued jobs. No generated code or URLs are executed or fetched.

| Setting | Default | Purpose |
| --- | --- | --- |
| `researchhub.export.retention` / `EXPORT_RETENTION` | `PT168H` | Positive duration, at most 30 days |
| `researchhub.export.dispatcher.enabled` / `EXPORT_DISPATCHER_ENABLED` | `true` | Disable automatic dispatch for deterministic tests |
| `researchhub.export.dispatcher.fixed-delay` / `EXPORT_FIXED_DELAY` | `PT1S` | Poll delay on the dedicated scheduler |

Fixed MVP limits: four queued/running exports per workspace; nesting 64; 50,000 nodes; 20,000 total table cells; at most 20 logical columns per table; 8 MiB per image; 16 million raster pixels; 24 MiB serialized snapshot; 32 MiB output. Wide/malformed tables fail explicitly rather than generating clipped artifacts. SVGs reject scripts, external entities, external links/styles and resource URLs, and rasterize with external resource execution disabled. PDF rendering permits only generated embedded PNG resources. Filenames normalize Unicode, remove path/control characters, handle Windows device names, and bound the stem to 100 characters.

DOCX uses real OOXML heading styles, paragraphs, numbering, cell spans, repeating header rows and embedded drawings via [Apache POI](https://poi.apache.org/components/document/quick-guide-xwpf.html). PDF uses [OpenHTMLToPDF](https://github.com/openhtmltopdf/openhtmltopdf), A4 pages, repeated table headers, wrapping, widow/orphan controls, and embedded DejaVu fonts (license included alongside the fonts). POI, OpenHTMLToPDF and Batik are explicitly pinned because the Spring Boot BOM does not manage these components; their managed transitive dependencies continue to use the Boot BOM. No frontend dependency was added; `package-lock.json` stays authoritative.

## LaTeX bundle contract (RH-233)

Each UTF-8 ZIP contains:

| Path | Content |
| --- | --- |
| `report.tex` | Editable `article` document, A4 page geometry, Unicode text, headings, styled paragraphs, ordered/unordered nested lists, tables, images, captions, numeric citations, references and export warnings |
| `images/figure-001.png`, etc. | The exact normalized PNG bytes from the frozen IR. Identical images share one generated path; no user-supplied filenames or URLs become asset paths |
| `report.json` | The complete schema `1.0` snapshot, including immutable source locations, analysis inputs/code hashes and trusted block-operation provenance |
| `README.txt` | Extraction, required packages, local compilation instructions and limits |

Extract the complete archive and compile `report.tex` twice with `xelatex -no-shell-escape report.tex` or `lualatex -no-shell-escape report.tex` in a current TeX Live/MiKTeX installation. The generated preamble uses the standard Latin Modern OpenType font files via [fontspec](https://ctan.org/pkg/fontspec), and the packages geometry, graphicx, array, [longtable](https://ctan.org/pkg/longtable), [multirow](https://ctan.org/pkg/multirow), [enumitem](https://ctan.org/pkg/enumitem), and ulem. Fonts and packages are supplied by the user's TeX distribution; ResearchHub does not fetch them. Users can edit the preamble to choose journal templates, fonts and language-specific glyph coverage.

Top-level tables use longtable with repeated leading header rows; nested tables use tabular in cells. Rowspans/colspans preserve the logical grid, and multirow groups inhibit page breaks within the group. As in ordinary LaTeX, an indivisible cell or merged group taller than a page requires manual layout editing. Captions keep the author's existing numbering/text. Equations retain their escaped source notation for subsequent editing; raw math or TeX commands from editor content are never executed by the generator.

Escaping applies to every user/source-derived text context: title, headings, inline marks, citations, bibliography, table cells, captions/alt text, analysis provenance, code, equation notation/source, and warnings. Backslashes, braces, `$`, `%`, `&`, `#`, `_`, `~`, and `^` become literal LaTeX text. Line breaks/tabs are normalized, unsupported control characters are removed, and code uses escaped monospaced text rather than a user-terminable verbatim environment. Images are referenced only through generated relative paths. The renderer performs no process execution, compilation, network access or filesystem writes. ZIP paths and timestamps are deterministic for a frozen snapshot.

## Verification

Run from `backend/`: `./mvnw verify`. The `export-coverage` JaCoCo execution enforces at least 80% line coverage for the complete `dev.researchhub.export` module, including API and persistence. Focused tests: `./mvnw -Dtest='*Export*,EditorReportAdapterTest,*ReportRenderingTest' test`.

Run from `frontend/`: `npm run lint`, `npm run build`, `npm run test:coverage -- --runInBand`. The export feature has separate 80% gates for lines, statements, functions and branches.

Browser E2E after building the frontend: from `backend/`, `EXPORT_BROWSER_TESTS=true ./mvnw -Dtest=ExportApiIntegrationTest test`. The test starts an isolated PostgreSQL container, runs real Chrome against the production bundle and Spring API, generates all three formats and verifies downloads, including the ZIP's TeX and snapshot. It uses installed Chrome by default or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Screenshots, downloaded binaries and test-generated reports are in ignored `backend/target/export-qa/`.

Optional actual LaTeX compilation: `LATEX_TEST_COMPILER=/absolute/path/to/tectonic ./mvnw -Dtest=LatexReportRenderingTest test`. This opt-in test invokes an already installed Tectonic compiler in `--untrusted` mode, compiles representative figures, merged/nested tables, deep lists and hostile text, and reopens the PDFs to check text and embedded images. This is a test-only validation dependency, not a product runtime dependency. Without the environment variable only this compiler check is skipped; ZIP structure, asset integrity/deduplication, text escaping, deterministic output, schema round-trip and all HTTP/UI tests still run normally. Generated sources and validation outputs are in `backend/target/export-qa/latex/`.

Tests cover frozen revision/source-version provenance, numeric citations with distinct locations, nested/merged tables, PNG/SVG charts, UTF-8 filenames/text, office reopening, PDF text/image extraction, long-document pagination, stale saves, viewers, cross-workspace/document isolation, CSRF, queue capacity, interrupted claims and expiration. Visual QA renders generated DOCX through bundled LibreOffice and PDF through Poppler; neither is required by the product runtime.

Verified on 2026-10-07 through RH-233: full backend `EXPORT_BROWSER_TESTS=true LATEX_TEST_COMPILER=/absolute/path/to/tectonic ./mvnw verify` succeeded (863 tests, zero failures/errors, seven skipped). After the final bibliography line-wrapping adjustment, the complete export module's 23 tests and all Maven verification/coverage gates passed again, including actual LaTeX compilation and production-browser downloads. Final export JaCoCo coverage was 746/759 lines (98.29%) and 508/592 branches (85.81%). Frontend lint, formatting, production build and all 1,048 tests in 110 suites passed; export coverage was 41/43 lines (95.35%), 100% branches and 90.47% functions. Visual checks included opening DOCX in LibreOffice, a 16-page PDF with a 150-row table and repeated headers, the LaTeX dialog, and the compiled LaTeX reports with chart assets, merged/nested tables, captions and escaped commands (PDFium rendering).

Equation typesetting, custom citation styles, unrelated storage providers and collaboration changes remain separate backlog tasks. LaTeX compilation remains under the user's control outside the main backend.

Bibliographic metadata is now resolved and frozen with each cited version; see [source-library.md](source-library.md). All three renderers include normalized bibliographic fields alongside immutable provenance.
