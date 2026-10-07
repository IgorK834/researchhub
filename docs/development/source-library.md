# Bibliography, organization and source search (RH-240 / RH-241 / RH-242)

Sources have a stable identity and immutable uploaded versions. V34 adds mutable bibliographic metadata,
tags and flat collections to the stable `sources` row. Renaming or moving a source between collections
does not change its ID, original filename, version IDs, storage keys or content digests. Processing,
reprocessing and file replacement preserve this metadata.

Passage search (Cmd/Ctrl K) and separately labeled external discovery are documented in
[source-search-and-external-evidence.md](source-search-and-external-evidence.md). External references
do not enter this uploaded-source library or its citation scope.

## Public contracts

All existing source summaries now contain `bibliography`, `tags` and `collections`. Existing rows receive
an empty bibliography and empty lists through Flyway. Production continues to use Hibernate validation,
not schema creation. There are no new runtime dependencies or frontend package changes.

```json
{
  "bibliography": {
    "title": "Solar efficiency",
    "authors": ["Smith, J.", "Ada Lovelace"],
    "publicationYear": 2025,
    "doi": "10.1234/abc",
    "venue": "Energy Journal",
    "url": "https://example.org/paper",
    "citationKey": "Smith2025"
  },
  "tags": ["energy", "review"],
  "collections": ["papers"]
}
```

| Endpoint below `/api/workspaces/{workspaceId}/sources` | Contract |
| --- | --- |
| `PUT /{sourceId}/bibliography` | Full replacement of the seven bibliography fields. `authors` is required and may be empty. Other fields may be null. |
| `PUT /{sourceId}/organization` | Full replacement of `{displayName, tags, collections}`. Both lists are required and may be empty. |
| `GET /search` | AND filters: `query`, `type`, `uploader`, `status`, `tag`, `collection`; `page=0`, `size=30` by default. |
| `GET /facets` | Workspace-wide `{total, ready, types, uploaders, tags, collections}`, independent of the selected page or filters. |

Search returns `{items, totalElements, page, size, hasNext}`, rather than implicit Spring Page JSON.
Pages are zero-based, size is 1–100, page is 0–1,000,000, and query is at most 200 characters.
`query` matches a literal case-insensitive substring in display name, original filename or bibliographic
title; `%`, `_` and SQL-looking text have no special meaning. Type and status use the existing closed enums.
Uploader must be a UUID. Labels are matched after normalization. Search does not fetch external URLs,
search file contents, or imply author/DOI/full-text search. The original list endpoint remains available
to existing source pickers; the library loads bounded pages and lightweight filter options.

Bibliographic strings are trimmed and normalized to Unicode NFC; blanks become null. Authors retain
publication order (up to 100 names of 200 characters). Limits: title 1,000, venue 500, DOI 300, URL 2,000,
citation key 100 characters. Year is an integer 1–9999. DOI resolver URLs and `doi:` prefixes normalize
to `10.<registrant>/<suffix>` with ASCII case folding, preserving non-ASCII suffix characters ([DOI handbook](https://www.doi.org/doi-handbook/DOIHandbook_2025.pdf)). URLs must be absolute HTTP(S) addresses without credentials.
Control and format characters are rejected. Citation keys use letters, digits, `.`, `_`, `:`, `-`,
start with a letter or digit, and are unique case-insensitively within a workspace. Clearing a key releases it.

Display name is required, at most 255 characters. Tags and collections each permit up to 20 labels of
80 characters. They are trimmed, NFC-normalized, lowercased, deduplicated and sorted. A shared collection
label groups sources; removing the last assignment removes the label from filter options. There is no
filesystem hierarchy, separate folder permission model, or deletion of source evidence.

## Authorization and provenance

Every query and its count include `workspace_id`; authorization occurs before search validation/querying.
Readers, including viewers and members of archived workspaces, may search and read filter options.
Writes require `EDIT_CONTENT`, an active workspace and CSRF. Non-members and sources from another
workspace return the same 404. Viewer writes return 403; archived workspace writes return 409;
invalid metadata/search parameters return `400 VALIDATION_FAILED`; duplicate citation keys return 409.
Row locks serialize metadata edits with lifecycle/version writes, and database constraints enforce shape,
list bounds and citation-key uniqueness. Storage keys are never exposed.

Bibliography is manually curated workspace metadata. A DOI or URL describes the uploaded source and
does not certify or import an external source. The UI states that distinction. Export resolves the
authorized immutable source version, then freezes the current bibliography with it. PDF, DOCX and
LaTeX references share the same normalized authors, title, year, venue, DOI, URL and citation key while
retaining source version ID and SHA-256. Later label/metadata edits cannot alter a captured export.
Old export snapshots without bibliography remain readable through the filename fallback.

## UI and verification

The detail metadata panel supports reading every field and separate bibliography/organization saves,
retains form values on errors, and refreshes the source and library caches. Viewers and archived
workspaces have no edit controls. Library filters persist in the URL, reset the page on changes, and
provide explicit search, clearing, collection chips and Previous/Next controls. At 1280px the filters
use the existing popover, and source details use the existing slide-over. References: `Sources.pdf`
pp.1,3 and `DESIGN_SPEC.md` source library/reader and responsive rules.

Run backend checks with `cd backend && ./mvnw verify`; frontend with `cd frontend && npm run lint &&
npm run build && npm run test:coverage -- --runInBand`. Existing JaCoCo and Jest source-module gates
require at least 80% coverage. Integration tests use migrated PostgreSQL and real HTTP sessions,
including normalization, invalid inputs, role/CSRF checks, workspace isolation, paging, label clearing,
version retention and frozen bibliography in all three export formats.

For the production browser test, build the frontend, then run from `backend`:

```sh
SOURCE_LIBRARY_BROWSER_TESTS=true ./mvnw -Dtest=SourceApiIntegrationTest test
```

It seeds 32 sources and a private workspace in disposable test containers, runs Chrome against the
production Webpack UI and real Spring server, and verifies editing, filtering, pagination, reload,
1440/1280px layouts, immutable identity and viewer/outsider authorization. Screenshots and the browser
log are written below `backend/target/source-library-qa` and `backend/target/source-library-browser-e2e.log`.

Verification recorded on 2026-10-07: frontend lint, formatting check, production build and all 1,057
tests passed; source-module line coverage was 100% (97.09% branches). Backend verification and
coverage gates passed, with source-module coverage of 94.60% lines (88.89% branches). The complete
backend suite encountered a transient PostgreSQL container connection timeout; rerunning the affected
suite with `verify` passed. The combined final reports contain 885 tests, zero failures/errors and
10 optional tests skipped. The production Chrome E2E was run separately and passed, including the
1440px and 1280px visual checks. The migration upgrade test verified existing V33 source/version data
through V34.
