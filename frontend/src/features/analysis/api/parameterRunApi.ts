import { apiClient, CSRF_PRIMING_PATH } from '../../../shared/api';
import { problemPath, type ProblemInput } from './problemApi';
export interface ParameterDefinition {
  schemaVersion: '1.0';
  name: string;
  type: 'DECIMAL';
  unit: string;
  bounds: { minimum: string; maximum: string };
  defaultValue: string;
  required: boolean;
}
export interface ParameterRun {
  idempotencyKey: string;
  parameters: Record<string, { type: 'DECIMAL'; value: string; unit: string }>;
  inputMode: 'ORIGINAL' | 'LATEST';
  plot: ProblemInput['plot'];
}
export interface ParameterResult {
  parentAnalysisId: string;
  analysisId: string;
  executionId: string;
  mode: 'APPROVED_PLAN';
  llmTokens: number;
}
export const parameterRunApi = {
  definitions: (w: string, a: string): Promise<ParameterDefinition[]> =>
    apiClient.get(`${problemPath(w, a)}/parameters`),
  run: async (w: string, a: string, body: ParameterRun): Promise<ParameterResult> => {
    await apiClient.get(CSRF_PRIMING_PATH);
    return apiClient.post(`${problemPath(w, a)}/runs`, { body });
  },
};
