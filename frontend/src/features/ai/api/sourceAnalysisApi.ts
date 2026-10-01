import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import type { Citation, GeneratedResponse } from './generationApi';

export const DEFAULT_COMPARISON_CRITERIA = [
  'method',
  'dataset',
  'metric',
  'main result',
  'limitations',
] as const;
export interface ComparisonCommand {
  readonly selectedSourceIds: readonly string[];
  readonly criteria: readonly string[];
  readonly instruction: string | null;
}
export interface AnalysisCell {
  readonly criterion: string;
  readonly status: 'REPORTED' | 'MISSING';
  readonly text: string | null;
  readonly evidenceIds: readonly string[];
}
export interface SourceAnalysis {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: 'COMPARISON' | 'DISAGREEMENTS';
  readonly parentComparisonId: string | null;
  readonly command: ComparisonCommand;
  readonly analysisInstruction: string;
  readonly sources: readonly { readonly id: string; readonly title: string }[];
  readonly answer: {
    readonly status: 'READY' | 'INSUFFICIENT_EVIDENCE' | 'NO_POTENTIAL_DISAGREEMENT';
    readonly rows: readonly {
      readonly sourceId: string;
      readonly cells: readonly AnalysisCell[];
    }[];
    readonly summary: readonly {
      readonly text: string;
      readonly evidenceIds: readonly string[];
    }[];
    readonly findings: readonly {
      readonly category:
        | 'POTENTIAL_DISAGREEMENT'
        | 'DIFFERENT_REPORTED_RESULT'
        | 'DIFFERENT_EXPERIMENTAL_CONDITIONS';
      readonly description: string;
      readonly sides: readonly {
        readonly sourceId: string;
        readonly text: string;
        readonly evidenceIds: readonly string[];
      }[];
      readonly methodologicalContext: AnalysisCell;
    }[];
  };
  readonly evidence: readonly Citation[];
  readonly warnings: readonly string[];
  readonly generation: {
    readonly model: GeneratedResponse['result']['model'];
    readonly templateId: string;
    readonly requestId: string;
  } | null;
  readonly createdAt: string;
}
const path = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/ai/source-analyses`;
export async function compareSources(
  workspaceId: string,
  command: ComparisonCommand,
): Promise<SourceAnalysis> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<SourceAnalysis>(`${path(workspaceId)}/comparisons`, {
    body: command,
  });
}
export function fetchSourceAnalysis(
  workspaceId: string,
  id: string,
): Promise<SourceAnalysis> {
  return apiClient.get<SourceAnalysis>(`${path(workspaceId)}/${encodeURIComponent(id)}`);
}
export async function findPotentialDisagreements(
  workspaceId: string,
  id: string,
  instruction: string | null,
): Promise<SourceAnalysis> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<SourceAnalysis>(
    `${path(workspaceId)}/${encodeURIComponent(id)}/disagreements`,
    { body: { instruction } },
  );
}
