import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { Citation, GeneratedResponse } from './generationApi';

export interface WorkspaceQuestion {
  readonly question: string;
  /** Omitted/null searches all authorized sources; [] deliberately searches none. */
  readonly selectedSourceIds?: readonly string[] | null;
}
export interface QuestionResponse {
  readonly status: 'SUPPORTED' | 'INSUFFICIENT_EVIDENCE';
  readonly reason: 'NO_RETRIEVED_EVIDENCE' | 'INSUFFICIENT_RETRIEVED_EVIDENCE' | null;
  readonly answer: string;
  readonly citations: readonly Citation[];
  readonly generation: GeneratedResponse | null;
}

export async function askWorkspaceQuestion(
  workspaceId: string,
  question: WorkspaceQuestion,
  signal?: AbortSignal,
): Promise<QuestionResponse> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<QuestionResponse>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/ai/questions`,
    { body: question, ...(signal === undefined ? {} : { signal }) },
  );
}
