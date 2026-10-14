# Document templates (Task 35.8 / 35.10)

The eight reviewed fixtures are the runtime resources in `backend/src/main/resources/templates/documents/`: laboratory report, literature review, thesis chapter and statistical report, each in `en` and `pl`. No private research material or generated findings are included.

- `GET /api/workspaces/{workspaceId}/document-templates?locale=en` requires a workspace reader. The preview is a regular TipTap document plus `sha256` of the exact resource bytes.
- `POST /api/workspaces/{workspaceId}/documents/from-template` accepts `create.schema.json`, requires an editor and CSRF, and returns the existing document response (`201`). Workspace + caller + client request UUID is the retry identity. A different selection with the same identity returns `CONFLICT`.
- `GET /api/workspaces/{workspaceId}/documents/{documentId}/template-origin` returns the immutable accepted id/version/locale/resource SHA-256/initial content SHA-256/UTC timestamp, or `null` for a blank document. Normal document authorization applies before origin lookup.

Preview and cancel never persist metadata or document content. Accepted content is copied into the existing `PROSEMIRROR_JSON` model with fresh block identities and an `IMPORTED` / `TEMPLATE_APPLIED` provenance operation. TODO prompts are guidance, not scientific claims or citations. Editing, snapshots, search and all three existing exports use the normal document pipeline.

Resources are server-owned, not user-uploaded templates. Client content, file paths, HTML, citation claims and template-engine commands are not accepted inputs to this endpoint. Updating a resource/version cannot change already copied documents. Retries resolve an existing receipt before consulting the current catalog version.

`exportLanguage: "en" | "pl"` is an explicit additive field in the frozen report snapshot. Historical snapshots without it use English labels. It changes report labels and the bundled CSL locale, not authored text, publication titles, source quotations, scientific values or citation identity. `citationStyle` remains an independent explicit `APA_7` / `IEEE` choice.
