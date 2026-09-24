import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys, type ApiError } from '../../../shared/api';
import {
  archiveDocument,
  createDocument,
  fetchDocument,
  fetchDocuments,
  updateDocument,
  type CreateDocumentInput,
  type DocumentSummary,
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
): UseQueryResult<readonly DocumentSummary[], Error> {
  return useQuery({
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
 * Saves a document.
 *
 * Writes the response into the document's own key so the editor keeps rendering what was saved — including the
 * new revision, which the next save has to send. The list is invalidated with `exact: true`: the title and
 * `updatedAt` shown there have changed, but the document just written is already current, so a prefix
 * invalidation would refetch it for nothing.
 *
 * A `409` deliberately has no `onError` handling here. What to do about somebody else having saved first is a
 * decision for the screen holding the user's unsaved text, not for the cache.
 */
export function useUpdateDocument(
  workspaceId: string,
  documentId: string,
): UseMutationResult<WorkspaceDocument, ApiError, UpdateDocumentInput> {
  const queryClient = useQueryClient();

  return useMutation<WorkspaceDocument, ApiError, UpdateDocumentInput>({
    mutationFn: (input) => updateDocument(workspaceId, documentId, input),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.document(workspaceId, documentId), saved);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.documents(workspaceId),
        exact: true,
      });
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
