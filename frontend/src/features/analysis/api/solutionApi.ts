import { apiClient } from '../../../shared/api';
import type { MathAst } from '../../documents/api/mathAst';
export interface SolutionStep {
  id: string;
  outputId: string;
  index: number;
  operation: 'EVALUATE' | 'SOLVE';
  expression: MathAst;
  substitution: Record<string, { value: string; unit: string; siValue: string }>;
  values: number[];
  unit: string;
  check: 'CHECKED';
}
export interface SolutionBundle {
  schemaVersion: '3.0';
  kind: 'SOLUTION';
  workload: 'PROBLEM';
  analysisId: string;
  executionId: string;
  inputHash: string;
  planHash: string;
  candidateHash: string;
  imageId: string;
  runtimeVersion: string;
  codeHashes: Record<string, string>;
  verificationVersion: string;
  precision: { absolute: number; relative: number };
  domain: string;
  statement: string;
  inputs: { symbol: string; value: string; unit: string }[];
  unknowns: { symbol: string; unit: string }[];
  steps: SolutionStep[];
  outputs: { name: string; expression: MathAst; values: number[]; unit: string }[];
  plot: {
    points: number[][];
    parameter: string;
    output: string;
    xUnit: string;
    yUnit: string;
  } | null;
  receipt: unknown;
  interpretation: {
    status: 'NOT_CHECKED';
    summary: string;
    assumptions: string[];
    warnings: string[];
  };
  origin: unknown;
}
export const solutionPath = (w: string, a: string, e: string) =>
  `/api/workspaces/${encodeURIComponent(w)}/analyses/${encodeURIComponent(a)}/executions/${encodeURIComponent(e)}/solution`;
export const fetchSolution = (
  w: string,
  a: string,
  e: string,
  signal?: AbortSignal,
): Promise<SolutionBundle> => apiClient.get(solutionPath(w, a, e), { signal });
