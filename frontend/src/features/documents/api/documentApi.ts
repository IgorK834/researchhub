import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';

import type { ProseMirrorDocument } from './documentContent';

/**
 * Transport for the document endpoints, which are nested under the workspace that owns them. Everything goes
 * through the shared client, so the credentials mode, CSRF header, and ProblemDetail decoding are the same as
 * everywhere else.
 */

function documentsPath(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/documents`;
}

/**
 * A document in a list. Mirrors `DocumentSummaryResponse`.
 *
 * There is no `content` field, and that is the server's contract rather than an omission here: a list must not
 * grow with the length of the prose in the workspace.
 *
 * `revision` is included because a client needs it before it can save.
 */
export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly contentFormat: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** `null` while the document is active. An archived document leaves the list but stays readable by id. */
  readonly archivedAt: string | null;
}

/**
 * One document with its content.
 *
 * Named `WorkspaceDocument` rather than `Document` on purpose: `Document` is a DOM global, and shadowing it in
 * a browser codebase is the kind of name collision that produces a baffling type error months later.
 *
 * `content` is `unknown` because it is arbitrary JSON the backend does not interpret. Use `readStoredDocument`
 * to check it against the editor's schema rather than indexing into it at a call site.
 */
export interface WorkspaceDocument extends DocumentSummary {
  readonly content: unknown;
}

export interface CreateDocumentInput {
  readonly title: string;
  readonly content: ProseMirrorDocument;
}

/**
 * A save carries the revision the editor last saw.
 *
 * Required, not optional. A save that does not say what it is replacing is the write that silently destroys
 * somebody else's paragraph, and the server refuses one.
 */
export interface UpdateDocumentInput {
  readonly title: string;
  readonly content: ProseMirrorDocument;
  readonly revision: number;
}

/**
 * The workspace's active documents, most recently updated first.
 *
 * Requires `VIEW_CONTENT`, so any member. A non-member gets `RESOURCE_NOT_FOUND` — the same answer as a
 * workspace that does not exist.
 */
export function fetchDocuments(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<readonly DocumentSummary[]> {
  return apiClient.get<readonly DocumentSummary[]>(documentsPath(workspaceId), {
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * One document, with its content.
 *
 * The document must belong to this workspace. One that does not is `RESOURCE_NOT_FOUND`, identical to a
 * document that does not exist, so a document id from elsewhere reveals nothing.
 */
export function fetchDocument(
  workspaceId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<WorkspaceDocument> {
  return apiClient.get<WorkspaceDocument>(`${documentsPath(workspaceId)}/${documentId}`, {
    ...(signal === undefined ? {} : { signal }),
  });
}

/** Creates a document at revision 1. Requires `EDIT_CONTENT`, so a viewer gets `403`. */
export async function createDocument(
  workspaceId: string,
  input: CreateDocumentInput,
): Promise<WorkspaceDocument> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<WorkspaceDocument>(documentsPath(workspaceId), { body: input });
}

/**
 * Saves the next revision.
 *
 * Answers `CONFLICT` when the stored document has moved on since `input.revision`, and writes nothing. The
 * caller keeps the user's text and explains; it must not quietly adopt the server's copy.
 */
export async function updateDocument(
  workspaceId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<WorkspaceDocument> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.patch<WorkspaceDocument>(
    `${documentsPath(workspaceId)}/${documentId}`,
    {
      body: input,
    },
  );
}

/**
 * Archives a document. Requires `EDIT_CONTENT`.
 *
 * Soft: the document leaves the list but keeps its text, its revision, and its id, and stays readable. Nothing
 * here deletes anything.
 */
export async function archiveDocument(
  workspaceId: string,
  documentId: string,
): Promise<void> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  await apiClient.delete<void>(`${documentsPath(workspaceId)}/${documentId}`);
}
