# Source text search and explicit external discovery (RH-306 / RH-243)

These workflows share the source feature but have separate evidence contracts. Uploaded workspace
sources retain immutable source/version/chunk identities. External results are discovery snapshots
in separate tables and are never silently admitted to retrieval, AI context or report citations.
The Java source module orchestrates discovery and persistence; existing Python AI/data boundaries
remain unchanged. No runtime libraries or frontend dependencies were added.

## Workspace source text search

The authorized application shell exposes **Search · Cmd/Ctrl K**, enabled only when its workspace
has been resolved successfully. Both shortcuts open the same modal from any workspace page,
including while editing a document. Existing modals retain their keyboard ownership. Navigation or
a workspace change closes search; Escape closes it and restores the invoking focus.

Results come exclusively from `GET /api/workspaces/{workspaceId}/retrieval/search?query=...&topK=20`.
There are no document, analysis, conversation or workspace result groups, filename-search fallback,
web results, source filters or undefined Cite action. Titles use the shell's already-authorized
source metadata. Original retrieval ranking and complete provenance are retained; a response with
a mismatched workspace fails closed in the frontend as well as the backend's SQL scope.

Typing debounces for 250ms; cancellation, loading, error/retry and empty states are explicit.
The input uses the combobox/listbox active-descendant pattern, keeps keyboard focus and announces
result counts through a polite live region. Up/Down wraps selection and updates the passage preview;
Enter opens the version-aware reader at the first span/page. Cmd/Ctrl Enter opens a validated passage
in the existing slide-over beside the current page, preserving editor state. That read checks the
chunk, workspace, source/version, processing version and content hash; unavailable/changed content
cannot be replaced silently with a newer passage. `Open page` uses the same reader link.

Matched terms are escaped literal regex terms and rendered as React text/`mark` nodes, preserving
inert source markup. A no-results view offers **Search sources only** (refocus; the sole scope is
already sources) and **Clear search**. Nearest-neighbor retrieval results are passages to inspect,
not an assertion that they support a research claim.

Design references: `Search,settings&internal_tools.pdf` p.1, `Components&states.pdf` p.4 and
`DESIGN_SPEC.md` Screen 10. The implementation reuses tokens, icons, empty-state artwork, dialog
focus/inertness/scroll ownership and the keyboard hint bar. The palette has Sources and Preview
columns at desktop widths and a stacked layout below 900px.

## External web discovery

The Sources library links to **External web references** at
`/app/workspaces/{workspaceId}/external-sources`. Every discovered and recorded reference is marked
**External web**. Uploaded sources stay in the separate library and remain the only source evidence
accepted by existing AI question, generation, authoring and report contracts.

Discovery is off on every page load. An editor must explicitly select **Enable external search**,
which explains that their query is sent to Brave Search and uploaded text is not sent. A search
requires explicit `externalSearchEnabled: true` in each request. Turning discovery off cancels
the request and clears discoveries; it does not delete previously recorded references.
Viewers and archived-workspace members can read recorded references but cannot discover or record.

The server-side `ExternalSearchProvider` adapter uses the fixed [Brave web search endpoint](https://api-dashboard.search.brave.com/app/documentation/web-search/codes).
It sends only the query and fixed result/display parameters, uses the server credential header,
disables redirects and never downloads discovered URLs. Response size is bounded to 512 KiB,
results to ten, request timeout to a positive duration of at most 30 seconds (default eight). Unsafe credential-bearing or
non-HTTP(S) links, invalid fields and duplicate normalized URLs are excluded. Provider markup is
stripped/unescaped before plain-text display. Provider failures expose a safe generic error.
There is no fallback to unsupported model internet knowledge or an unconfigured search provider.

After discovery, **Record reference** preserves the original provider result and provenance.
The client submits only server-issued search/result IDs; it cannot substitute a title, URL or
snippet. The snapshot includes query, provider, searched/recorded actor and time, original discovery
IDs and SHA-256. Repeating the action returns the first record, including under concurrent requests.
Snapshots are immutable at the database boundary. A recorded snippet is a reference to inspect,
not imported page content or verified report evidence. The UI explains that users should upload
the original material and review its extraction before citing it as workspace evidence.

## Explicit API, authorization and configuration

All endpoints are below `/api/workspaces/{workspaceId}/external-sources` and return
`Cache-Control: private, no-store`:

| Endpoint | Request / response |
| --- | --- |
| `GET /availability` | `{available, provider}`; requires content-reader membership. |
| `POST /search` | `{query, externalSearchEnabled: true}` → `{id, workspaceId, evidenceType: "EXTERNAL_WEB", provider, query, searchedBy, searchedAt, results: [{id, title, url, snippet}]}`. |
| `POST /` | `{searchId, resultId}` → immutable recorded reference including provenance and `snapshotSha256`. |
| `GET /?page=0&size=30` | `{items, totalElements, page, size, hasNext}`; zero-based page, size 1–100, page 0–1,000,000. |

Search query: 1–600 trimmed characters, at most 75 whitespace-separated words; control/format
characters are rejected. Titles and normalized HTTP(S) URLs use the existing bibliography bounds
(1,000/2,000 characters), snippets at most 4,000. No implicit network calls occur on reads or saves.
Search shares the existing RETRIEVAL request budget and requires active content-editor permission
and CSRF. Authorization precedes validation/provider calls and is checked again after provider I/O,
before results are persisted or returned. Provider calls hold no database transaction. Every store
lookup/count is workspace-scoped, with a composite workspace/search FK for saved references.

Non-members and cross-workspace IDs receive uniform 404; viewer writes 403; archived writes 409;
invalid requests 400 `VALIDATION_FAILED`; missing server configuration 503
`EXTERNAL_SEARCH_UNAVAILABLE`; provider failures 502 `EXTERNAL_SEARCH_FAILED`; request budget
exhaustion uses the existing 429 `RATE_LIMIT_EXCEEDED` contract. Saved references remain readable
when the provider is disabled. Flyway **V35** adds discovery/reference tables and immutable triggers;
production Hibernate remains `ddl-auto: validate`.

Backend-only environment variables in `.env.example` / the local Spring profile:

| Variable | Default | Meaning |
| --- | --- | --- |
| `EXTERNAL_SEARCH_ENABLED` | `false` | Enables the configured adapter; users still must opt in per request. |
| `BRAVE_SEARCH_API_KEY` | empty | Provider key; required when enabled, never a public frontend variable. |
| `EXTERNAL_SEARCH_TIMEOUT` | `PT8S` | Positive duration no greater than `PT30S`. |

Invalid enabled credentials/timeout fail at startup. Set these in the environment of the existing
Spring process; no new service/container, model SDK or scraping infrastructure is introduced.

## Verification

```sh
cd backend
./mvnw verify
cd ../frontend
npm run lint
npm run format:check
npm run build
npm run test:coverage -- --runInBand
```

Source-module and dedicated external-source JaCoCo gates require 80% line coverage. Jest adds
individual 80% line/branch/function/statement gates for the new APIs and views. Tests cover keyboard
selection/opening/closing, focus restoration, composition, empty/error states, inert markup,
cancellation/consent withdrawal, recorded-reference pagination and permission-driven UI. Real HTTP /
PostgreSQL tests cover opt-in, role/CSRF/archival checks, revoked membership during provider I/O,
cross-workspace discovery IDs, snapshots/idempotence, separate identities, rejected AI source scope
and migration from populated V34 while preserving library metadata and immutable versions.
The HTTP adapter tests exercise the actual provider request contract against a local HTTP stub,
including redirects, malformed/oversized responses and secret-safe failures.

Build the frontend, then run the production-browser test from `backend`:

```sh
SOURCE_SEARCH_BROWSER_TESTS=true ./mvnw -Dtest='SourceExtractionEndToEndTest#productionBrowserSearchesRealRetrievalAndRecordsExternalEvidenceSeparately' test
```

This runs Chrome → production Webpack UI → Spring → PostgreSQL with real Python source extraction,
chunking and hybrid retrieval. External provider results use a deterministic boundary stub, avoiding
paid network calls in tests; adapter HTTP behavior is tested separately. It verifies keyboard entry,
immutable page links, opening beside a document, no-results actions, explicit external consent,
durable provenance, reload, workspace-only AI evidence, viewer/isolation checks and 1440/1280px
layouts. Screenshots: `backend/target/source-search-qa`; log:
`backend/target/source-search-browser-e2e.log`.

Verified on 2026-10-07: the full Maven `verify` passed (897 tests, zero failures/errors;
11 optional tests skipped), followed by the explicitly enabled Chrome end-to-end test above.
JaCoCo measured 95.37% line coverage for the source module and 99.17% for the dedicated external
source module (84.38% branches). The frontend passed lint, formatting, type checking, production
build and all 1,084 tests in 116 suites. The new APIs and views have 100% line coverage and
95.23–100% branch coverage; all configured 80% gates passed. The live paid Brave service was not
called during verification.
