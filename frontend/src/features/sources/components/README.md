# Source library and upload queue

RH-279, RH-295 and RH-296 use the existing workspace source contracts. `SourceVisuals` renders the exhaustive type/status maps next to `SOURCE_TYPES` and `SOURCE_STATUS_LABELS`. Unknown wire values use neutral visuals. No source types have been added.

`SourceList` is the dedicated Sources route: server-scoped paginated search, type/status/uploader/tag filters, collection chips, authenticated download links, ready-only Ask source links, and editor-only upload/reprocess actions. Ask source opens the existing workspace question form with that source selected. The server remains authoritative for membership and write permissions.

Keep `SourceUploadForm` mounted when `open` is false. The component owns the per-file queue outside the modal content; closing the dialog does not cancel XHR uploads or backend processing. Selecting/dropping files starts each upload through `useUploadSource` with its own progress callback. Invalid files keep the existing validation message and never reach the upload endpoint. Retry after an upload failure resends that file; Retry after a processing failure uses reprocess. Processing status uses the existing source and progress endpoints, with polling only while sources are uploaded/processing. There is no local persistence or notification promise.

The visual references are `Sources.pdf` pp.1–2, `Components&states.pdf` pp.1,3, `Brand&system.pdf` p.2 and `Key_user_flows.pdf` p.1. Viewers and archived workspaces have no upload/retry controls. RH-240/241/242 add the editable `SourceMetadataPanel`, explicit bibliography/organization/search/facet contracts and Flyway V34. Details and verification are in `docs/development/source-library.md`; no runtime dependency was added.
