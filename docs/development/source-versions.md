# Immutable source versions (RH-130)

A **source** is the stable workspace object people refer to; a **source version** is one immutable upload of it.
Replacing a spreadsheet or paper never rewrites bytes that an analysis already used: it adds version *n + 1*, makes it
the active version, and leaves every earlier version, its blob and everything derived from it exactly as they were.

Context: [sources.md](sources.md) (upload, storage, limits), [source-extraction.md](source-extraction.md) (what a
version is processed into), [source-analysis.md](source-analysis.md) (analyses that cite versions) and
[dataset-inspection.md](dataset-inspection.md) (the bounded preview of a version). Decision record:
[ADR-005](../adr/ADR-005-immutable-source-versions.md).

## Model

```text
sources                       stable identity, label, active projection
 └─ source_versions           one row per upload; immutable input (bytes, name, type, size, hash, uploader)
     ├─ processing_job_source_versions   the version each durable job was created for
     ├─ source_version_extractions       complete validated extraction of that version
     ├─ source_version_retrieval_sets    snapshot of its retrieval chunks (text, spans, provenance)
     └─ ai_source_analysis_sources       the exact versions an analysis consumed
```

| Rule | Where it is enforced |
| --- | --- |
| A replacement creates a new row and a **new blob key**; the old key is never overwritten. | `SourceService.replace`, `StorageKey.generate()`, storage adapters refuse an existing key |
| A version's input never changes: `id`, `source_id`, `workspace_id`, `version_number`, file name, media type, source type, size, `storage_key`, `content_sha256`, uploader, `created_at`. | `tg_source_version_input_is_immutable` (V19), any writer |
| A version row cannot be deleted while it exists, so its blob stays referenced. | the same trigger refuses `DELETE` |
| The active source points at its **latest** version, and the file columns on `sources` are only ever a complete copy of one of that source's own versions. | `fk_sources_active_version` (composite, same source and workspace), `sources_original_is_immutable` (V19) |
| Version numbers are consecutive per source. | `Source.replaceWith`, `uq_source_versions_number` |
| A version belongs to exactly one source in one workspace; ids never resolve across either. | `uq_source_versions_scope`, every query is `workspaceId + sourceId + versionId` |
| A revision is accepted only for a `READY` or `FAILED` source, by an editor of an active workspace. | `Source.replaceWith`, `requireEditor` |
| Two concurrent revisions yield exactly one new version; the loser's bytes are removed. | row lock + `activeVersionId` compare in `SourceService.replace` |

`sources.status` and the active file fields are a **projection** of the latest version, kept so existing readers
(`GET /sources`, retrieval, the legacy extraction route) keep working unchanged. The authoritative record of an input
is its `source_versions` row. A version has its own lifecycle (`UPLOADED → PROCESSING → READY | FAILED`) mirrored by the
same job listener that updates the source, so version 1 stays `READY` while version 2 is still being processed.

Existing data: V19 turns every existing source into version 1 **without moving its blob**, binds its jobs, extraction
runs, retrieval chunks and saved analyses to it, and archives its extraction and retrieval snapshot. The archive is
rebuilt from the stored rows exactly as the application would (`SourceVersionMigrationUpgradeTest` proves the rebuilt
chunk set equals the validated one), so an analysis created before versioning is reproducible too.

## Processing is pinned to a version

Every durable `SOURCE_INGEST` job is bound to the version it was created for (`processing_job_source_versions`). A
retry, a reprocess or a stale recovery therefore reads **that version's** bytes, never whichever version is active when
the worker is finally called. Reprocessing keeps the same version and binds a fresh job to it. A late notification from
an old job is ignored by the existing "current run" check, and the listener refuses a job whose version is not the active
one.

When a new version finishes, `source_extractions` and `source_retrieval_*` (the *active projection* used by search and
the legacy `/extraction` route) are replaced by the new version's output, while `source_version_extractions` and
`source_version_retrieval_sets` keep the output of every version. Search only returns chunks of the active version
(`c.source_version_id = s.active_version_id`), and only for a `READY` source.

Chunk identity stays **content-addressed and independent of the version** (`RetrievalIdentity.chunkId`): the worker
mints ids before the server binds a chunk set to a version, `processingVersion` already commits to the source and
extraction hashes, and every id minted before versioning (including stored citations) remains valid. The version is
recorded next to the id (`sourceVersionId` on each chunk), not inside it.

## Analyses reference the exact versions they consumed

`ai_source_analysis_sources(analysis_id, source_id, source_version_id, ordinal)` is the inspectable relational record;
the immutable analysis payload carries the same facts (`sources[].sourceVersionId`, `versionNumber`, `contentSha256`) and
every citation carries its chunk's `sourceVersionId`. Reading a saved analysis re-authorizes its versions, never
re-reads data, and is unaffected by later uploads.

Re-running an analysis is an explicit choice (`POST .../source-analyses/{id}/disagreements`, body `{"instruction": …,
"versionSelection": "ORIGINAL" | "LATEST"}`):

| `versionSelection` | Evidence | Recorded versions |
| --- | --- | --- |
| `ORIGINAL` (default) | The comparison's own chunks, read from the per-version snapshot, so they are identical even after the source was replaced. | the original ones |
| `LATEST` | A fresh search over the current active versions of the same sources. If a source was replaced while the request was running, it fails with `409` instead of mixing versions. | the latest ones |

Nothing migrates silently: the default never reads newer data, and `LATEST` creates a **new** analysis that names its
newer versions. The UI shows when a newer version exists and lets the user choose.

## HTTP API

All routes are workspace-authorized (`404` for a non-member, `403` for a viewer on a write); writes need the CSRF header.

| Route | Result |
| --- | --- |
| `POST /api/workspaces/{w}/sources/{s}/versions` | Multipart part `file`; `201` with the source (now at `activeVersionNumber` *n + 1*, status `UPLOADED`). `409` unless the source is `READY`/`FAILED` or when two revisions race; `415`/`413`/`400` exactly as an upload. Any file type that a source may have is allowed, including a different one. |
| `GET /api/workspaces/{w}/sources/{s}/versions` | Every version, newest first, with `active`, `status`, `contentSha256`; never a storage key. |
| `GET /api/workspaces/{w}/sources/{s}/versions/{v}` | One version. A version of another source or workspace is `404`. |
| `GET /api/workspaces/{w}/sources/{s}/versions/{v}/content` | The exact original bytes of that version (`private, no-store`, `nosniff`, encoded attachment name). |

`SourceResponse` also carries `activeVersionId` and `activeVersionNumber`. `GET /sources/{s}/content` returns the active
version.

## Frontend

The source page shows the active version number, a **Versions** table (number, file, size, status, upload time, a
download link for every version, and **Preview data** for ready CSV/XLSX versions selected through `?version=`), and an
**Upload a new version** form for editors/owners, which states that existing analyses keep their original version and
bytes. The comparison panel names the version of each source (`Paper A (version 1)`), announces when a newer version was
uploaded after the comparison, and offers the explicit original/latest choice for a follow-up.

## Retention

No code path deletes a version row or a version's blob, and the database refuses to delete the row. A future
retention/purge job must (1) keep any version referenced by `ai_source_analysis_sources`, by a document citation
(`sourceVersionId`) or by a versioned-document policy, (2) delete the blob and the version's archives together, and
(3) do so through a migration that deliberately replaces the immutability trigger. Until such a policy exists, versions
are kept indefinitely.

## Verification

* `SourceTest`, `SourceVersionTest` – domain rules (consecutive numbers, replace only after a terminal state).
* `SourceServiceIntegrationTest` – replace/versions/scoping/immutability triggers against PostgreSQL.
* `SourceApiIntegrationTest` – real HTTP: bytes of version 1 survive revision 2, authorization, race of two revisions.
* `SourceVersionMigrationUpgradeTest` – V19 on data written by V18, including the archived retrieval snapshot.
* `SourceExtractionEndToEndTest` – upload → durable job → real Python worker → PostgreSQL, replacement, version-pinned
  processing, and an analysis followed up with `ORIGINAL` and `LATEST` after its source was replaced.
