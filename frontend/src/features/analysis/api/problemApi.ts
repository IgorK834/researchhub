import { apiClient } from '../../../shared/api';
import type { MathAst } from '../../documents/api/mathAst';
export interface ProblemParameter {
  symbol: string;
  value: string | null;
  unit: string | null;
}
export interface ProblemInput {
  statement: string;
  parameters: ProblemParameter[];
  unknowns: { symbol: string; unit: string | null }[];
  domain: 'REAL' | null;
  expectedOutputs: {
    name: string;
    kind: 'EVALUATE' | 'SOLVE';
    expression: MathAst | null;
    unit: string | null;
  }[];
  assumptions: string[];
  plot: {
    parameter: string;
    start: string;
    end: string;
    points: number;
    output: string;
  } | null;
}
export interface ProblemAnalysis {
  schemaVersion: '2.0';
  workload: 'PROBLEM';
  id: string;
  workspaceId: string;
  userPrompt: string;
  status: string;
  snapshot: {
    problem: ProblemInput;
    inputHash: string;
    origin: unknown;
    templateId: string;
    templateHash: string;
  };
  plan: { summary: string; warnings: string[] } | null;
  audit: unknown;
  missing: string[];
  parentAnalysisId: string | null;
}
export interface ProblemExecution {
  completedAt?: string | null;
  solution?: import('./solutionApi').SolutionBundle | null;
  computationStatus?: string;
  id: string;
  analysisId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  failureCode: string | null;
  inputHash: string;
  planHash: string;
  imageId: string | null;
  runtimeVersion: string | null;
  result: {
    outputs: {
      name: string;
      values: number[];
      unit: string;
      expression: MathAst;
      steps: unknown[];
    }[];
    plot: { points: number[][]; xUnit: string; yUnit: string } | null;
  } | null;
  verification: {
    status: 'CHECKED' | 'FAILED' | 'INVALID';
    candidateHash: string;
    receipt: unknown;
  } | null;
}
export const problemPath = (w: string, a?: string) =>
  `/api/workspaces/${encodeURIComponent(w)}/analyses${a ? `/${encodeURIComponent(a)}` : ''}`;
export const createProblem = (
  w: string,
  problem: ProblemInput,
  parent: ProblemAnalysis | null,
  clientRequestId: string,
): Promise<ProblemAnalysis> =>
  apiClient.post(problemPath(w), {
    body: {
      schemaVersion: '2.0',
      workload: 'PROBLEM',
      clientRequestId,
      userPrompt: problem.statement,
      problem,
      origin: null,
      parentAnalysisId: parent?.id ?? null,
    },
  });
export const fetchProblem = (
  w: string,
  a: string,
  signal?: AbortSignal,
): Promise<ProblemAnalysis> => apiClient.get(problemPath(w, a), { signal });
export const planProblem = (w: string, a: string): Promise<ProblemAnalysis> =>
  apiClient.post(`${problemPath(w, a)}/plan`, { body: {} });
export const executeProblem = (w: string, a: string): Promise<ProblemExecution> =>
  apiClient.post(`${problemPath(w, a)}/execute`, { body: {} });
export const fetchProblemExecutions = (
  w: string,
  a: string,
  signal?: AbortSignal,
): Promise<ProblemExecution[]> =>
  apiClient.get(`${problemPath(w, a)}/executions`, { signal });
export const reproduceProblem = (
  w: string,
  a: string,
  e: string,
): Promise<ProblemExecution> =>
  apiClient.post(
    `${problemPath(w, a)}/problem/executions/${encodeURIComponent(e)}/reproduce`,
    { body: {} },
  );
