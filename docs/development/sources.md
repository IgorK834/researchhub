# Sources

Uploaded research material: the files a workspace's documents, retrieval, and analysis will cite. This page is the
reference for how a file becomes a source. Product context: [../context.md](../context.md) section 10. Schema:
[persistence.md](persistence.md#sources).

The domain model, `sources` table (V8), application service, HTTP API, React upload UI, and Azure Blob adapter are
implemented. Locally the adapter talks to Azurite through the same Azure SDK client used for Azure Blob Storage.
The source service is only created once an adapter is configured (see [Storage](#storage)).

## Types

The mapping is closed. `dev.researchhub.source.domain.SourceType` holds it, `ck_sources_source_type` and
`ck_sources_media_type_matches_type` enforce it in the database, and
`frontend/src/features/sources/api/sourceTypes.ts` mirrors it for pre-upload checks.

| `source_type` | Extension | Stored `media_type` (canonical) | Also accepted as the declared media type | Content check (first 8 KiB) |
| --- | --- | --- | --- | --- |
| `PDF` | `.pdf` | `application/pdf` | `application/x-pdf` | Starts with `%PDF-` |
| `DOCX` | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | — | Starts with a ZIP header (`PK\x03\x04`) |
| `XLSX` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | — | Starts with a ZIP header (`PK\x03\x04`) |
| `CSV` | `.csv` | `text/csv` | `application/csv`, `text/x-csv`, `text/plain`, `application/vnd.ms-excel` | No NUL byte |
| `TXT` | `.txt` | `text/plain` | — | No NUL byte |

For every type, an absent declared media type and `application/octet-stream` are also accepted, since neither says
anything about the content. Media type parameters (`; charset=utf-8`) and letter case are ignored.

**How an upload is recognised**, in order:

1. The **extension** of the cleaned file name, lowercased, decides the type. It is the one signal every browser sends
   consistently.
2. The **declared media type** must be in that type's accepted list, or be absent or generic. A `.pdf` declared as
   `image/png` is refused rather than guessed at.
3. The **content** must pass the type's check. A renamed executable is not a PDF because its name ends in `.pdf`.
   This is a sanity check, not a parser. Whether the file then parses is ingestion's question, and it answers with
   `FAILED`.

What is stored as `media_type` is always the canonical one, never the client's claim.

**Refusals** are `415 UNSUPPORTED_FILE_TYPE`. The detail says what was sent and lists what is supported:

| Case | `detail` |
| --- | --- |
| Unsupported extension | `Files of type .pptx are not supported. Supported types: PDF (.pdf), DOCX (.docx), XLSX (.xlsx), CSV (.csv), TXT (.txt).` |
| No extension | `The file has no extension, so its type cannot be recognised. Supported types: …` |
| Declared type contradicts the extension | `The file is named .pdf but was sent as image/png, which is not a PDF media type. Supported types: …` |
| Content does not match | `The file is named .pdf but its content is not a PDF file. Supported types: …` |

Legacy `.doc` and `.xls` are deliberately not accepted. PPTX and images are candidates once the ingestion path is
stable. Adding a type means a new `SourceType` value, a migration that widens both check constraints, and the
frontend mirror.

## Status

`SourceStatus`, pinned by `ck_sources_status`:

| From | May become | Meaning |
| --- | --- | --- |
| `UPLOADED` | `PROCESSING` | Stored and recorded; nothing has read it yet. Every new source starts here. |
| `PROCESSING` | `READY`, `FAILED` | Ingestion is reading it. |
| `FAILED` | `PROCESSING` | Processing failed. The original is kept and may be processed again. |
| `READY` | — | Final. Processing a changed file is a new version, not a re-run that changes what citations point at. |

Any other move is `409 CONFLICT` (`Source.moveTo`).

## File names

`SourceFilename` turns the name the client sent into metadata:

- any directory part is dropped (`C:\fakepath\x.pdf` and `../../x.pdf` both become `x.pdf`)
- the name is normalised to Unicode NFC
- control characters and bidirectional overrides are removed (`\u202Egpj.exe` would otherwise display as `exe.jpg`)
- surrounding whitespace is trimmed
- the result must be non-empty, not `.` or `..`, and at most 255 characters, otherwise the upload is
  `400 VALIDATION_FAILED`

The name is stored as `original_filename` and copied to `display_name`. It is **never** used to build a storage key,
a path, or a header without encoding.

## Storage keys

`StorageKey.generate()` returns `sources/<random UUID v4>`, and `ck_sources_storage_key_format` accepts nothing else.
The key contains nothing the user chose: no file name, no workspace id, no source id.

**A key carries no authority.** Nothing looks a source up by key, and no response includes one. Every read finds the
source by id within the caller's workspace, after the workspace membership check, and only then reads the key from
that row.

## Limits and quota

| Limit | Where | Default |
| --- | --- | --- |
| One source | `researchhub.sources.max-size-bytes`, read by `SourceLimits` | 50 MiB (`52428800`) |
| Schema ceiling | `ck_sources_size_bytes`, `Source.MAX_SIZE_BYTES_CEILING` | 1 GiB. A configured limit above it fails startup. |
| Empty file | `ck_sources_size_bytes`, and checked before storing | Refused, `400 VALIDATION_FAILED` |
| Whole workspace | `WorkspaceSourceQuota` hook | None: `UnlimitedWorkspaceSourceQuota` |

The per-source limit is enforced while the bytes stream in (`MeteredInputStream`). A client that declares its size is
refused before anything is read. A client that declares a smaller size, or none, is stopped at `limit + 1` bytes.
Both cases are `413 PAYLOAD_TOO_LARGE` with detail `The file is larger than the 50 MB allowed for one source`.

The quota hook is asked twice per upload: once with the declared size before reading, and once with the real size
after storing. A future quota answers by throwing `PayloadTooLargeException`. Replacing
`UnlimitedWorkspaceSourceQuota` with another bean is the whole change.

## Immutability and versions

A source's **original input never changes**. `id`, `workspace_id`, `original_filename`, `media_type`,
`source_type`, `size_bytes`, `storage_key`, `content_sha256`, `uploaded_by`, and `created_at` are `updatable = false`
on the entity. `tg_sources_original_is_immutable` refuses changing any of them from any writer. Only `display_name`,
`status`, and `updated_at` move. Storage adapters must refuse to overwrite an existing key.

`content_sha256` is the SHA-256 of the stored bytes, computed while they streamed in. It is what provenance can cite,
and it shows two uploads of the same file to be the same bytes.

Replacing a file is therefore never an update. Uploading a new file today creates a new source. When replacement is
added as a feature, it will be a source version: a new immutable input under the same logical source, recorded in a
new table by a new migration. The existing row stays as it is, so everything derived from it keeps pointing at what
it was derived from.

## Storage

`dev.researchhub.source.application.SourceStorage` is the port. It is written in `StorageKey`s, never URLs, container
names, or credentials:

| Operation | Contract |
| --- | --- |
| `store(key, content, mediaType)` | Streams the content in chunks, never buffering the whole file. Refuses an existing key. If reading `content` fails, including because the size limit was passed, it propagates that exception. |
| `open(key)` | A stream the caller closes. `StorageObjectNotFoundException` when nothing is there. |
| `exists(key)` | Whether an object is there. |
| `delete(key)` | Idempotent. Administrative lifecycle only: clean-up after a failed upload, or a retention decision. |
| `createTemporaryReadAccess(key, ttl)` | An expiring, single-object read URI (a SAS URL, say) when the adapter has one. Otherwise empty, and the caller streams through the API. |

Size limits and hashing are not the adapter's job. `SourceService` meters the stream it passes to `store`, so every
adapter enforces the same limit and produces the same digest.

The adapter is selected by `researchhub.sources.storage.adapter`. The local profile selects `azure-blob`, implemented
under `source.infrastructure`; its endpoint, emulator account, key, and container name live under
`researchhub.sources.storage.azure-blob`. It uses Azure's `BlobServiceClient` against Azurite, not a filesystem-only
substitute, so cloud wiring later changes credentials and endpoint rather than the source rules or adapter API.

The configured private container is created idempotently on the first storage operation. This is intentionally lazy:
the backend can start and unrelated local tests can run while Azurite is stopped, but an upload fails instead of
silently falling back to local disk. `SourceStorageContract` is the common adapter contract, and
`AzureBlobSourceStorageIntegrationTest` runs it against a real Azurite container as well as exercising the complete
`SourceService` -> PostgreSQL + Azurite -> read-back path.

**Upload order.** The bytes are stored first and the row is inserted second. Storage is not transactional, so this
order fails safe:

- a failed store leaves no row pointing at nothing
- a refused or failed insert deletes the stored object
- a crash between the two leaves an unreferenced object, which nothing can reach and a future reconciliation job would
  sweep

No failed upload is ever marked `READY`: a successfully stored and recorded input starts at `UPLOADED`; processing is
a separate lifecycle step. A future reconciliation job may remove crash-only orphan blobs, but no scheduler was added
as part of RH-072/RH-073.

## HTTP API

All routes require a session. Mutating requests also require the normal CSRF header.

| Route | Result |
| --- | --- |
| `POST /api/workspaces/{workspaceId}/sources` | Multipart part `file`; editors/owners get `201` with source metadata. |
| `GET /api/workspaces/{workspaceId}/sources` | Metadata list, newest first. |
| `GET /api/workspaces/{workspaceId}/sources/{sourceId}` | One source's metadata. |
| `GET /api/workspaces/{workspaceId}/sources/{sourceId}/content` | Streams the original bytes with canonical content type and an encoded attachment filename. |

Responses never contain `storageKey`, container credentials, or document contents. The frontend performs an early
extension/MIME/size check to avoid a pointless upload, but the backend repeats every validation and authorization
decision and is authoritative.

## Access

Access to sources follows the workspace, exactly as for documents:

| Operation | Requires | Non-member |
| --- | --- | --- |
| Upload | `EDIT_CONTENT` on an active workspace. A viewer gets `403`, an archived workspace `409`. | `404 Source was not found` |
| List, read metadata, open content | `VIEW_CONTENT`, archived workspaces included | `404 Source was not found` |

A source id from another workspace is `404` even for somebody who belongs to both.
