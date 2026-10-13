# Bibliography import fixtures

Synthetic, non-private fixtures for the local file migration contract. The accepted formats are UTF-8
BibTeX (`.bib`), RIS (`.ris`), and CSL-JSON (`.json`). They deliberately include Unicode, corporate and
multiple authors, missing dates, escaped braces, repeated citation keys, unsupported types, and attachment
paths/URLs that must remain inert.

The contract is preview-first. Invalid records remain visible with their record number/location; confirm stores
only accepted metadata. Attachment references are warnings, never uploads, filesystem reads, HTTP requests, or
retrieval chunks.

## HTTP contract

`POST /api/workspaces/{workspaceId}/bibliography/imports` is multipart (`file`, optional `format`: `BIBTEX`, `RIS`,
`CSL_JSON`; `origin`: `GENERIC`, `ZOTERO`, `MENDELEY`). Size <=2 MiB, records <=1000. Response is a no-store preview
with `id`, `workspaceId`, `fileName`, `fileSha256`, `format`, `origin`, `status`, `totalRecords`, `ready`, `duplicates`,
`conflicts`, `rejected`, `records` and `createdAt`. Each record includes its one-based `recordNumber`, `location`,
`status`, CSL `itemType`, `bibliography`, `tags`, `collections`, `ignoredAttachments`, `issues` and `matches`.
Matches include kind/id/title, DOI or metadata match reason, `conflictingFields`, existing metadata and labels.
Rejected rows have null bibliography/type, not an omitted record.

`SourceBibliography` has nullable `title`, `publicationYear`, `doi`, `venue`, `url`, `citationKey`, and ordered
`authors` (an array). Dates are reduced to the existing year-only model. Authors may be family/given or literal
corporate names. DOI normalization follows the existing source-library contract.

Confirm: `POST /{importId}/confirm`, for example:

```json
{
  "decisions": [
    { "recordNumber": 2, "action": "REPLACE_SOURCE", "targetId": "existing-source-uuid", "mergeOrganization": true },
    { "recordNumber": 3, "action": "SKIP" }
  ]
}
```

Actions: `CREATE`, `LINK_SOURCE`, `REPLACE_SOURCE`, `REPLACE_ITEM`, `SKIP`. Unspecified ready rows create metadata-only
items; other rows default to skip/duplicate/rejected. Explicit `acceptedBibliography` can resolve conflicts without
silently accepting an overwrite. The result has counts `created`, `linked`, `updated`, `skipped`, `rejected`,
`duplicates`, record outcomes/destinations, `importId` and `confirmedAt`. Identical decisions replay the immutable
result; different decisions after confirmation return 409. `DELETE /{importId}` cancels without accepted metadata.
GET of the import or `/{importId}/result` reloads preview/summary.

The authoritative Java DTOs are `BibliographyImportContracts`, consumed through the TypeScript
`bibliographyImportApi` contracts. Real HTTP tests exercise the serialized DTOs against these synthetic files.
Full subset/export/security and library-edit documentation: [file migration](../../docs/development/bibliography-import.md).
