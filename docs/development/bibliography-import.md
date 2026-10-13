# Bibliography file migration

Status: implemented for Tasks 35.2 and 35.3. Export instructions verified **2026-10-13**.

ResearchHub imports bibliographic metadata from local UTF-8 files. It does not connect to a Zotero or Mendeley
account, retain an API key, synchronize changes, read an attachment path, or download an attachment URL. The
base demo therefore needs no credentials, subscription, or service beyond the existing application stack.

## Supported files

| File | Supported subset |
|---|---|
| BibTeX `.bib` | `article`, `book`/`booklet`, `inbook`/`incollection`, `inproceedings`/`conference`, thesis, report, online/webpage, misc/unpublished/manual; braced or quoted values, nested/escaped braces, ordered `and` authors, corporate braced authors, year/date, DOI, venue, URL, citation key, keywords and collection fields |
| RIS `.ris` | `JOUR`/`JFULL`/`EJOUR`, `BOOK`, `CHAP`, `CONF`/`CPAPER`, `THES`, `RPRT`, `ELEC`/`WEB`, `GEN`/`UNPB`; repeated authors/keywords, title, date, DOI, venue, URL, ID citation key, and `C1` collections |
| CSL-JSON `.json` | An item array or `{ "items": [...] }`; supported CSL types, literal or family/given authors, `issued.date-parts`, DOI, container title, URL, citation key/id, categories/keywords, and optional collection arrays |

The hard limits are 2 MiB and 1000 records. A malformed UTF-8 file is rejected. An invalid individual record is
shown with its number and line/item location while the remaining records stay in preview. Unsupported types and
duplicate citation keys are explicit preview rows. LaTeX commands and HTML remain inert text; no parser feature
executes them.

The existing `SourceBibliography` model represents dates as a publication **year** (1–9999), not a full calendar
date. A supplied date maps its year; an absent date stays null. Other CSL fields (for example volume, pages,
publisher, abstract, and notes) are outside this subset. Notes/abstracts are explicitly reported as ignored in
CSL imports. BibTeX string macros, concatenation and cross-reference expansion are not supported; unsupported
syntax is reported rather than evaluated. The parser has no new third-party runtime dependency. CSL mapping is
shared with the existing citeproc-java 3.5.1 / CSL 26.8 export adapter; a citation formatter does not parse imports.

`file`, `attachment`, CSL attachment objects, and RIS `L1`/`L2`/`L4` are ignored with a warning. `URL` is only
stored as bibliographic metadata. Import never opens it. A future attachment migration must use a separate,
explicit normal source upload and all ordinary source admission/size rules.

## Zotero export

In Zotero desktop, right-click a library or collection and choose **Export Library…** or **Export Collection…**;
for selected items use **Export Items…**. Choose **CSL JSON** or **BibTeX**, save the file, then choose **Import
bibliography → Zotero export** in ResearchHub. Do not enable file export for this migration. Zotero documents the
menu entry and scope choices in [How do I export my Zotero library?](https://www.zotero.org/support/kb/exporting),
and lists CSL-JSON and BibTeX as import/export formats in [Bibliographic Data Formats](https://www.zotero.org/support/dev/data_formats).

Standard CSL-JSON/BibTeX cannot faithfully carry every Zotero collection, note, or attachment relationship.
ResearchHub preserves supported tag/collection fields when the exporter supplies them and reports ignored
attachments. It does not claim to be a Zotero backup or a live sync adapter.

## Mendeley Reference Manager export

In the desktop Mendeley Reference Manager choose **File → Export All**, select **BibTeX** or **RIS**, choose a local
filename, and save. The web application does not currently expose this export. Then choose **Import bibliography →
Mendeley export** in ResearchHub. These steps and the metadata-only limitation are documented by Mendeley in
[Exporting references](https://static.mendeley.com/md-stitch/releases/live/08-exporting-references.cb27d2e0.html).

## Preview, deduplication, and confirmation

`POST /api/workspaces/{workspaceId}/bibliography/imports` accepts multipart `file`, optional `format`, and `origin`.
It authorizes an active workspace editor before reading a bounded file, hashes the exact bytes, parses locally, and
returns a no-store preview. Exact re-upload of an active/confirmed file returns the same import identity.
Admission uses the existing workspace authorization, CSRF, `UploadInspector` and configured malware scanner,
plus a separate atomic `BIBLIOGRAPHY_IMPORT` budget (10/user/minute, 30/workspace/minute by default). Local default
scanning does not need a paid service; a configured scanner failure fails closed. The scanner receives staged
bytes, never a filesystem path from the bibliography. Limit overruns return 413 or the standard 429 contract.

Deduplication first compares normalized DOI. When no DOI match exists, it compares a stable normalized fingerprint
of title, publication year, and authors. Preview identifies exact duplicates and field-level conflicts against both
uploaded sources and bibliographic-only entries. Confirm decisions are `CREATE`, `LINK_SOURCE`, `REPLACE_SOURCE`,
`REPLACE_ITEM` or `SKIP`. A conflict defaults to `SKIP`; existing values change only after an explicit replacement
decision. `acceptedBibliography` is an optional explicitly accepted version of metadata; it is required to create
a separate item from a conflict (for example after changing a duplicate citation key). Citation keys must be unique
across sources and bibliographic-only items in the workspace. `mergeOrganization: true` explicitly adds imported
tags/collections to existing labels with normalization/deduplication; otherwise existing organization is preserved.
Preview exposes differing metadata and organization fields and existing labels. Replacement rejects stale preview
metadata/labels with 409, and concurrent confirmations are serialized per workspace.

`POST /{importId}/confirm` is transactionally idempotent for the same decisions. Reusing the confirmed identity with
different decisions returns 409. `DELETE /{importId}` cancels a preview and stores no accepted metadata. Every
accepted metadata version, file hash, origin, record number, action, outcome, and destination is retained as frozen
provenance.

`GET /{importId}` reloads the preview; `GET /{importId}/result` retrieves the immutable confirmed summary.
`GET /api/workspaces/{workspaceId}/bibliography/items?offset=0` lists bibliographic-only references (50/page).
`PUT /bibliography/items/{id}` accepts bibliography, tags, collections and `expectedUpdatedAt` for optimistic
concurrency. The source library's **Show bibliography** section displays these items and allows explicit editing.
Editing an item never changes the frozen accepted import record or a previously confirmed import's result.

Bibliographic-only rows have no `SourceType`, byte object, extraction, or retrieval chunks. Linking metadata to an
existing source does not create evidence. Only a separately uploaded and processed source can become Gemini/RAG
evidence.

Flyway V49 owns import state, bibliographic-only items and immutable accepted records; V50 adds the existing
account-erasure authority for those tables. Account export includes the caller's accepted bibliography records;
the personal-data inventory and erasure tests cover new workspace-scoped data. Cancellation retains an audit
preview/hash but creates no accepted metadata or bibliography items.

## Verification

Synthetic fixtures cover generic BibTeX, Zotero CSL-JSON/BibTeX and Mendeley RIS; unit/API tests cover the shared
BibTeX parser for Mendeley, Unicode, escaped/nested braces, corporate/multiple authors, missing dates/fields,
unsupported types, duplicate keys, normalization, partial errors, changed destinations, cancelled previews,
idempotent confirmation, user edits/re-import and foreign/revoked membership. A counted local HTTP trap and
synthetic private path prove that malicious LaTeX/HTML and attachment references cause no request or file read.
The production-browser source-search test also checks import preview/labels, cancellation, confirmation and replay.

Run `./mvnw verify` in `backend` and `npm run test:coverage -- --runInBand`, `npm run lint`, `npm run build` in
`frontend`. Both line and branch coverage have separate 80% gates for the import module and new UI. After building
the frontend, enable the real browser flow with
`SOURCE_SEARCH_BROWSER_TESTS=true ./mvnw -Dtest=SourceExtractionEndToEndTest test` (Docker, pinned worker environment
and Chrome/Playwright required). Search performance/authorization details: [workspace search](workspace-search.md).

For all existing repository coverage gates, use the CI sandbox setting `ANALYSIS_SANDBOX_TESTS=true`; build the
pinned local image first (`docker build -t researchhub-sandbox:1.2.0 sandbox` from the root). These real computation
tests use the deterministic local worker, not Gemini. A complete run for this task is
`ANALYSIS_SANDBOX_TESTS=true SOURCE_SEARCH_BROWSER_TESTS=true ./mvnw clean verify` in `backend`, after building the
frontend and preparing the existing worker environment. Other unrelated browser integrations remain separately opt-in.

Synthetic contract fixtures live in [`contracts/bibliography/fixtures`](../../contracts/bibliography/fixtures).
