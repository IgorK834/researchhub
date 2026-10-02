import { useCallback } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  archiveDocument,
  createDocument,
  fetchDocument,
  fetchDocuments,
  fetchDocumentVersion,
  fetchDocumentVersions,
  restoreDocumentVersion,
  updateDocument,
  type CreateDocumentInput,
  type DocumentSummary,
  type DocumentVersion,
  type DocumentVersionSummary,
  type UpdateDocumentInput,
  type WorkspaceDocument,
} from './documentApi';

/**
 * The workspace's active documents.
 *
 * Keyed by `queryKeys.documents(workspaceId)`, which the shared factory already defined. The per-document key
 * sits underneath it, so invalidating the list also refreshes an open document by prefix — and the reverse does
 * not happen, which is what lets a save update one document without refetching every other.
 */
export function useDocumentsQuery(
  workspaceId: string,
  enabled = true,
): UseQueryResult<readonly DocumentSummary[], Error> {
  return useQuery({
    enabled,
    queryKey: queryKeys.documents(workspaceId),
    queryFn: ({ signal }) => fetchDocuments(workspaceId, signal),
  });
}

/**
 * One document with its content.
 *
 * A 404 is left as an error for the page to recognise, the same way the workspace detail query does: it is a
 * dead end to render, not an ordinary value.
 */
export function useDocumentQuery(
  workspaceId: string,
  documentId: string,
): UseQueryResult<WorkspaceDocument, Error> {
  return useQuery({
    queryKey: queryKeys.document(workspaceId, documentId),
    queryFn: ({ signal }) => fetchDocument(workspaceId, documentId, signal),
  });
}

/** Creates a document and refreshes the list it belongs to. */
export function useCreateDocument(
  workspaceId: string,
): UseMutationResult<WorkspaceDocument, ApiError, CreateDocumentInput> {
  const queryClient = useQueryClient();

  return useMutation<WorkspaceDocument, ApiError, CreateDocumentInput>({
    mutationFn: (input) => createDocument(workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
    },
  });
}

/**
 * Writes a document the server just returned into the cache, and marks what it made stale.
 *
 * The document's own key gets the response directly, so anything rendering it — including the next save's
 * revision — is current without a refetch. The list is invalidated with `exact: true`, because its titles and
 * `updatedAt` changed but the document itself is already fresh. The history is invalidated because a save may
 * have recorded a version.
 */
function rememberSavedDocument(
  queryClient: QueryClient,
  workspaceId: string,
  saved: WorkspaceDocument,
): void {
  queryClient.setQueryData(queryKeys.document(workspaceId, saved.id), saved);
  void queryClient.invalidateQueries({
    queryKey: queryKeys.documents(workspaceId),
    exact: true,
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.documentVersions(workspaceId, saved.id),
  });
}

/**
 * A function that saves a document and updates the cache. Stable across renders.
 *
 * A plain function rather than a `useMutation`, on purpose. Autosave calls it from timers and, when the user
 * leaves the page, from an unmount cleanup — and a mutation's per-call callbacks do not run once the component
 * that started it is gone. Here the cache update is part of the promise, so a save that finishes after the user
 * navigated away still lands in the cache, and reopening the document shows it.
 *
 * A `409` is not handled here. What to do about somebody else having saved first is a decision for the screen
 * holding the user's unsaved text, not for the cache.
 */
export function useSaveDocument(
  workspaceId: string,
  documentId: string,
): (input: UpdateDocumentInput) => Promise<WorkspaceDocument> {
  const queryClient = useQueryClient();

  return useCallback(
    async (input: UpdateDocumentInput) => {
      const saved = await updateDocument(workspaceId, documentId, input);
      rememberSavedDocument(queryClient, workspaceId, saved);
      return saved;
    },
    [queryClient, workspaceId, documentId],
  );
}

/**
 * The document's history, newest first.
 *
 * `enabled` lets a collapsed history panel stay quiet: a save invalidates this key, and a list nobody is looking
 * at should not be refetched every few seconds while somebody types.
 */
export function useDocumentVersionsQuery(
  workspaceId: string,
  documentId: string,
  enabled: boolean,
): UseQueryResult<readonly DocumentVersionSummary[], Error> {
  return useQuery({
    queryKey: queryKeys.documentVersions(workspaceId, documentId),
    queryFn: ({ signal }) => fetchDocumentVersions(workspaceId, documentId, signal),
    enabled,
  });
}

/** One version with its content, fetched only once a version is chosen. Versions never change, so never stale. */
export function useDocumentVersionQuery(
  workspaceId: string,
  documentId: string,
  versionId: string | null,
): UseQueryResult<DocumentVersion, Error> {
  return useQuery({
    queryKey: queryKeys.documentVersion(workspaceId, documentId, versionId ?? ''),
    queryFn: ({ signal }) =>
      fetchDocumentVersion(workspaceId, documentId, versionId ?? '', signal),
    enabled: versionId !== null,
    staleTime: Infinity,
  });
}

export interface RestoreDocumentVersionInput {
  readonly versionId: string;
  /** The revision on screen. A stale one is `CONFLICT`, exactly like a save. */
  readonly revision: number;
}

/** Restores a version as the document's next revision, and caches the result like a save. */
export function useRestoreDocumentVersion(
  workspaceId: string,
  documentId: string,
): UseMutationResult<WorkspaceDocument, ApiError, RestoreDocumentVersionInput> {
  const queryClient = useQueryClient();

  return useMutation<WorkspaceDocument, ApiError, RestoreDocumentVersionInput>({
    mutationFn: ({ versionId, revision }) =>
      restoreDocumentVersion(workspaceId, documentId, versionId, revision),
    onSuccess: (restored) => {
      rememberSavedDocument(queryClient, workspaceId, restored);
    },
  });
}

/**
 * Archives a document.
 *
 * Invalidates by prefix rather than exactly, because both the list — which the document leaves — and the
 * document's own cached copy, which now reports being archived, are out of date.
 */
export function useArchiveDocument(
  workspaceId: string,
  documentId: string,
): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: () => archiveDocument(workspaceId, documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
    },
  });
}
