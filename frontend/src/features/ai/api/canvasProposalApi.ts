import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { Citation } from './generationApi';

export interface CanvasProposal {
  readonly schemaVersion: '2.0';
  readonly id: string;
  readonly contextId: string;
  readonly state: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  readonly mode: 'INSERT_AT_ANCHOR' | 'REPLACE_RANGE';
  readonly versionHash: string;
  readonly originalText: string;
  readonly paragraphs: readonly string[];
  readonly citations: readonly Citation[];
  readonly warnings: readonly string[];
  readonly operationId: string | null;
  readonly compensationId?: string | null;
  readonly calculation?: {
    schemaVersion: '2.0';
    workload: 'PROBLEM' | 'DATASET';
    analysisId: string;
    executionId: string;
    selection: 'FULL' | 'TABLE' | 'CHART';
    outputId: string | null;
    conversationId: string | null;
    blocks: readonly {
      type: 'analysisResult';
      attrs: import('../../documents/api/analysisReference').AnalysisBlockAttrs;
    }[];
  };
}
export interface CalculationProposalRequest {
  clientProposalId: string;
  contextId: string;
  analysisId: string;
  executionId: string;
  selection: 'FULL' | 'TABLE' | 'CHART';
  outputId: string | null;
  conversationId: string | null;
  turnId: string | null;
}
export interface CanvasReceipt {
  readonly operationId: string;
  readonly proposalId: string;
  readonly kind: 'ACCEPT' | 'UNDO';
  readonly revision: number;
}
const path = (workspace: string, document: string) =>
  `/api/workspaces/${encodeURIComponent(workspace)}/documents/${encodeURIComponent(document)}/ai`;
export async function prepareCalculationProposal(
  workspace: string,
  document: string,
  body: CalculationProposalRequest,
): Promise<CanvasProposal> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(`${path(workspace, document)}/proposals/calculation`, { body });
}
export const fetchCanvasProposal = (
  workspace: string,
  document: string,
  proposal: string,
  signal?: AbortSignal,
) =>
  apiClient.get<CanvasProposal>(
    `${path(workspace, document)}/proposals/${encodeURIComponent(proposal)}`,
    { ...(signal ? { signal } : {}) },
  );
export async function acceptCanvasProposal(
  workspace: string,
  document: string,
  proposal: CanvasProposal,
  operationId: string,
): Promise<CanvasReceipt> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(
    `${path(workspace, document)}/proposals/${encodeURIComponent(proposal.id)}/accept`,
    { body: { clientOperationId: operationId, versionHash: proposal.versionHash } },
  );
}
export async function rejectCanvasProposal(
  workspace: string,
  document: string,
  proposal: string,
): Promise<CanvasProposal> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(
    `${path(workspace, document)}/proposals/${encodeURIComponent(proposal)}/reject`,
    { body: {} },
  );
}
export async function undoCanvasOperation(
  workspace: string,
  document: string,
  operation: string,
  requestId: string,
): Promise<CanvasReceipt> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post(
    `${path(workspace, document)}/operations/${encodeURIComponent(operation)}/undo`,
    { body: { clientOperationId: requestId } },
  );
}
