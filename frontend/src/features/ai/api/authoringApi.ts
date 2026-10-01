import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { WorkspaceDocument } from '../../documents/api/documentApi';
import type { Citation, GeneratedResponse } from './generationApi';

export type AuthoringKind = 'DRAFT' | 'REWRITE' | 'EVIDENCE';
export type RewriteAction =
  'IMPROVE_ACADEMIC_STYLE' | 'SHORTEN' | 'EXPAND' | 'CLARIFY' | 'FIX_GRAMMAR' | 'EXPLAIN';
export interface AuthoringCommand {
  readonly kind: AuthoringKind;
  readonly expectedRevision: number;
  readonly placementBlock: number | null;
  readonly from: number | null;
  readonly to: number | null;
  readonly action: RewriteAction | null;
  readonly instruction: string;
  /** null searches all workspace sources, only for evidence discovery. */
  readonly selectedSourceIds: readonly string[] | null;
  readonly lengthTarget: number;
  readonly stylePreset: string;
  readonly citationRequired: boolean;
}
export interface AuthoringSuggestion {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly createdBy: string;
  readonly state: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  readonly command: AuthoringCommand;
  readonly originalText: string;
  readonly generatedText: string;
  readonly citations: readonly Citation[];
  readonly candidates: readonly {
    readonly citation: Citation;
    readonly snippet: string;
    readonly category: 'supporting' | 'related' | 'insufficient';
    readonly relevance: number;
    readonly reason: string;
  }[];
  readonly warnings: readonly string[];
  readonly generation: {
    readonly requestId: string;
    readonly templateId: string;
    readonly model: GeneratedResponse['result']['model'];
    readonly usage: GeneratedResponse['result']['usage'];
  } | null;
  readonly acceptedRevision: number | null;
}
export interface AuthoringAcceptance {
  readonly expectedRevision: number;
  readonly editedText: string | null;
  readonly citationChunkId: string | null;
}
export interface AcceptedAuthoring {
  readonly eventId: string;
  readonly acceptedRevision: number;
  readonly document: WorkspaceDocument;
}
const path = (workspaceId: string, documentId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentId)}/ai/suggestions`;

export async function suggestAuthoring(
  workspaceId: string,
  documentId: string,
  command: AuthoringCommand,
): Promise<AuthoringSuggestion> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<AuthoringSuggestion>(path(workspaceId, documentId), {
    body: command,
  });
}
export function fetchAuthoringSuggestion(
  workspaceId: string,
  documentId: string,
  id: string,
): Promise<AuthoringSuggestion> {
  return apiClient.get<AuthoringSuggestion>(
    `${path(workspaceId, documentId)}/${encodeURIComponent(id)}`,
  );
}
export async function rejectAuthoring(
  workspaceId: string,
  documentId: string,
  id: string,
): Promise<AuthoringSuggestion> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<AuthoringSuggestion>(
    `${path(workspaceId, documentId)}/${encodeURIComponent(id)}/reject`,
  );
}
export async function acceptAuthoring(
  workspaceId: string,
  documentId: string,
  id: string,
  input: AuthoringAcceptance,
): Promise<AcceptedAuthoring> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<AcceptedAuthoring>(
    `${path(workspaceId, documentId)}/${encodeURIComponent(id)}/accept`,
    { body: input },
  );
}
