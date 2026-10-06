import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { CommentAnchor } from './commentAnchor';
import type { AuthoringSuggestion } from '../../ai/api/authoringApi';

export interface CommentAiSuggestion {
  readonly id: string;
  readonly commentId: string;
  readonly kind: 'AI_EVIDENCE';
  readonly requestedBy: string;
  readonly requestedByName: string;
  readonly claim: string;
  readonly evidence: Pick<AuthoringSuggestion, 'candidates' | 'warnings' | 'generation'>;
  readonly createdAt: string;
  readonly acceptedChunkIds: readonly string[];
}

export interface CommentReply {
  readonly id: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}
export interface DocumentComment extends CommentReply {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly anchor: CommentAnchor;
  readonly orphaned: boolean;
  readonly updatedAt: string;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly replies: readonly CommentReply[];
  readonly aiSuggestions: readonly CommentAiSuggestion[];
}
export interface CommentEvent {
  readonly id: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly action: 'CREATED' | 'REPLIED' | 'RESOLVED' | 'REOPENED';
  readonly previousStatus: 'OPEN' | 'RESOLVED' | null;
  readonly status: 'OPEN' | 'RESOLVED';
  readonly createdAt: string;
}
export interface CommentThread {
  readonly comment: DocumentComment;
  readonly events: readonly CommentEvent[];
}
const path = (workspaceId: string, documentId: string): string =>
  `/api/workspaces/${workspaceId}/documents/${documentId}/comments`;

export const commentApi = {
  evidence: async (
    workspaceId: string,
    documentId: string,
    commentId: string,
    id: string,
  ): Promise<DocumentComment> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(`${path(workspaceId, documentId)}/${commentId}/ai-evidence`, {
      body: { id },
    });
  },
  acceptEvidence: async (
    workspaceId: string,
    documentId: string,
    commentId: string,
    suggestionId: string,
    chunkId: string,
  ): Promise<DocumentComment> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(
      `${path(workspaceId, documentId)}/${commentId}/ai-evidence/${suggestionId}/accept`,
      { body: { chunkId } },
    );
  },
  list: (workspaceId: string, documentId: string): Promise<DocumentComment[]> =>
    apiClient.get(path(workspaceId, documentId)),
  thread: (workspaceId: string, documentId: string, id: string): Promise<CommentThread> =>
    apiClient.get(`${path(workspaceId, documentId)}/${id}`),
  create: async (
    workspaceId: string,
    documentId: string,
    anchor: CommentAnchor,
    body: string,
  ): Promise<DocumentComment> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(path(workspaceId, documentId), {
      body: { id: anchor.id, anchor, body },
    });
  },
  reply: async (
    workspaceId: string,
    documentId: string,
    commentId: string,
    id: string,
    body: string,
  ): Promise<DocumentComment> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(`${path(workspaceId, documentId)}/${commentId}/replies`, {
      body: { id, body },
    });
  },
  status: async (
    workspaceId: string,
    documentId: string,
    id: string,
    status: DocumentComment['status'],
  ): Promise<DocumentComment> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.patch(`${path(workspaceId, documentId)}/${id}`, {
      body: { status },
    });
  },
};
