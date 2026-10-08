# ADR-012: Asynchronous report export pipeline

- Status: Accepted
- Date: 2026-10-08
- Tasks: RH-349, RH-230, RH-231, RH-232, RH-233, RH-311, RH-312

## Context

A document export must be reproducible from the committed revision and carry its citations and analysis provenance.
Rendering can be expensive and must survive the browser closing its dialog. The design references show a paper-oriented
editor and chart/table provenance; neither the browser editor nor the Python AI worker should become the report renderer.
ResearchHub needs DOCX, PDF and editable LaTeX sources within the existing Spring modular monolith.

## Decision

Use the `export` module to build a browser-independent, versioned `Report` representation from the committed document.
The request includes the expected revision. A REPEATABLE READ application transaction authorizes the workspace content
reader, verifies the revision, freezes bibliography/source-version references and saved analysis outputs, and stores
that snapshot with a QUEUED export job. Stale revisions use the existing 409 conflict contract. The snapshot remains
stable if the document, source organization or bibliography later changes.

Return 202 and a job location; expose scoped status, frozen representation and download routes. Every operation binds
workspace, document and job identity and checks server authorization. Rendering checks current access before and after
work so a revoked requester cannot publish a completed artifact. All responses use `Cache-Control: no-store`.

`ExportDispatcher` claims one PostgreSQL job at a time with transactional `SKIP LOCKED`; the claim transaction ends
before rendering. Use the existing renderer facade and format-specific Java renderers: Apache POI for DOCX, OpenHTMLtoPDF
for PDF, and generated `.tex`/figure/provenance ZIP sources for LaTeX. Core Java never runs TeX, LibreOffice, a browser or
Python to render reports. DOCX/PDF include the frozen content, reference metadata, tables, captions and supported images;
LaTeX includes editable source and the frozen JSON representation. Escaping and bounded trusted image handling prevent
report content from causing remote resource fetches or command execution.

Store artifacts in the existing PostgreSQL export store with SHA-256, media type, size, timestamps and safe failure codes.
The configured retention defaults to seven days and is capped at 30 days. Expiration clears the large snapshot and bytes,
retaining job metadata. Reads enforce expiration by timestamp even before cleanup. A renderer failure becomes FAILED;
a RUNNING job older than ten minutes becomes `RENDER_INTERRUPTED`. No automatic source-style retry is added; users can
request another export. Dispatch and retention maintenance run with the existing scheduler and shared capped datasource.

## Consequences

The browser can close/reopen the export workflow without cancelling server work. The report reflects the committed
revision, never pending browser edits; collaborative clients must wait for durable save acknowledgement before exporting.
Stable provenance supports later comparison of exported results. The Java renderer pipeline can be tested without an AI
provider or a browser process, while actual document formats still require content/layout verification.

Frozen report JSON and artifact bytes increase PostgreSQL storage and backup cost; retention is explicit rather than a
side effect of workspace archival. Large exports need bounded inputs and observability. Revisit blob-backed artifacts or
dedicated rendering workers only when measured retention/storage/latency demands require them. Connection usage follows
the [shared pool budget](../development/persistence.md#connection-budget-and-autoscaling-rh-314).

## Alternatives considered

- **Browser/Tiptap HTML or print-to-PDF:** depends on unsaved client state and browser execution, and cannot provide the
  same report contract for DOCX/LaTeX or durable background processing.
- **Synchronous rendering in the request:** couples expensive work to an HTTP timeout and browser lifetime.
- **External rendering service or Python worker:** adds an independent deployment boundary to a Java document pipeline.
- **Compile LaTeX server-side:** expands runtime and untrusted typesetting risk; editable source ZIP is the agreed contract.
- **Blob artifacts and a message broker now:** possible at larger scale, but unrelated infrastructure expansion for the
  existing bounded pipeline; retain the module's storage/renderer ports for a later deliberate decision.

## Implementation and verification

- [Report contract](../../backend/src/main/java/dev/researchhub/export/domain/Report.java),
  [editor adaptation](../../backend/src/main/java/dev/researchhub/export/application/EditorReportAdapter.java),
  [freeze/authorization/render lifecycle](../../backend/src/main/java/dev/researchhub/export/application/ExportService.java),
  [dispatch](../../backend/src/main/java/dev/researchhub/export/application/ExportDispatcher.java),
  [claims/retention](../../backend/src/main/java/dev/researchhub/export/infrastructure/PostgresExportStore.java),
  [renderer facade](../../backend/src/main/java/dev/researchhub/export/infrastructure/AcademicReportRenderer.java).
- [DOCX renderer](../../backend/src/main/java/dev/researchhub/export/infrastructure/DocxReportRenderer.java),
  [PDF renderer](../../backend/src/main/java/dev/researchhub/export/infrastructure/PdfReportRenderer.java),
  [LaTeX renderer](../../backend/src/main/java/dev/researchhub/export/infrastructure/LatexReportRenderer.java).
- [Export API/Flyway/provenance/retention integration](../../backend/src/test/java/dev/researchhub/export/ExportApiIntegrationTest.java),
  [service access and failures](../../backend/src/test/java/dev/researchhub/export/ExportServiceTest.java),
  [report adaptation](../../backend/src/test/java/dev/researchhub/export/EditorReportAdapterTest.java),
  [DOCX/PDF rendering](../../backend/src/test/java/dev/researchhub/export/ReportRenderingTest.java),
  [LaTeX bundle/render checks](../../backend/src/test/java/dev/researchhub/export/LatexReportRenderingTest.java).
- [HTTP contracts, report limits and browser E2E](../development/report-export.md).

This ADR does not modify ADR-008's sandbox boundary (Task 14.3) or the ADR-010/013/014/015 work owned by Task 26.6.
