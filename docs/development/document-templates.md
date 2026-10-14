# Bundled document structures

Task 35.8, reviewed 2026-10-14. Four structures ship in English and Polish: laboratory report, literature review, thesis chapter and statistical report. Each resource is normal TipTap JSON using the existing editor/export model, not another document format.

## Creation and provenance

The create dialog starts with a blank-document option. Selecting a bundled structure loads a reader-authorized catalog, shows its description, sections and required TODO guidance, and allows an explicit template language. Preview/cancel writes nothing. The scrollable preview is keyboard-focusable; the existing modal traps and restores focus. During a submitted creation, dismissal is disabled. Failed requests retain the title and retry identity.

The server requires an active workspace editor and CSRF. It serializes **all** blank/template creation paths on the workspace row and enforces `researchhub.documents.max-active-per-workspace` (default 100, allowed 1–10000). Archived documents do not consume this capacity. Exceeding it returns the stable `DOCUMENT_LIMIT_REACHED` code with `documentLimit`; an existing accepted retry is resolved before consuming capacity. This free, local operation makes no Gemini call and does not spend an AI quota.

Workspace, caller and `clientRequestId` identify a creation. The same selection returns the same document, including subsequent author edits. Reusing the identity with different title/id/version/locale returns `CONFLICT`. Two concurrent identical requests serialize instead of creating two documents. A different template version requires a fresh identity. Template catalog updates never rewrite existing documents; old accepted retries work even after the catalog stops serving that version.

Migration V51 stores the accepted template id/version/locale, exact resource SHA-256, initial document SHA-256 and UTC creation time. Append-only `TEMPLATE_APPLIED` / `IMPORTED` operations distinguish bundled structure from AI-generated text. Normal edits can change/remove/reorder sections and receive normal human provenance; the initial origin remains immutable. The receipt is included in account-data inventory/export and deleted through the existing private-workspace erasure workflow, not retained as an unclassified personal-data table.

## Safety and exports

TODO prompts ask for the author's verified measurements, sources, assumptions and interpretation. They are not facts, generated results, publication metadata or citations. Bundled structures have no `researchCitation`, `analysisResult`, remote image/file reference, template-engine execution, attachment reader or AI draft. Existing AI drafting is a separate explicit action with the existing admission/budget checks.

The regular saved-document pipeline freezes a report and renders DOCX, PDF or UTF-8 LaTeX sources. Every one of the eight resources has an HTTP smoke/golden-structure test asserting heading structure, TODO prompts, Unicode, zero fabricated bibliography and retained template origin. The tests parse actual OOXML/PDF/ZIP output, not only successful status codes. Export language and citation style are explicit independent choices; changing them never translates authored paragraphs, source titles, quotations, scientific values or stored timestamps.

## Verification

```sh
node scripts/i18n/validate.cjs
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test:coverage -- --runInBand
npm --prefix frontend run build
cd backend
ANALYSIS_SANDBOX_TESTS=true DOCUMENT_TEMPLATE_BROWSER_TESTS=true ./mvnw verify
```

Docker and the repository's pinned `researchhub-sandbox:1.2.0` image are needed for existing sandbox coverage gates. The new browser test uses the production frontend, local Spring/PostgreSQL, synthetic account data and Chromium; it makes no Gemini calls. CI enables it alongside existing browser suites. Screenshots, DOCX downloads and a machine-readable summary are written to `backend/target/templates-browser/`.

JaCoCo gates both lines and branches at 80% for the template application/catalog/persistence/controller/admission module. Jest gates the template API/create/preview and shared localization modules at the same threshold. No dependencies or paid services were added.
