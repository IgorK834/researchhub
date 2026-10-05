import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api';
import {
  fetchAnalyses,
  fetchAnalysis,
  fetchExecutions,
  fetchExecutionRecord,
} from './analysisApi';

export function useAnalysesQuery(workspaceId: string, enabled = true, offset = 0) {
  return useQuery({
    queryKey: [...queryKeys.analyses(workspaceId), { offset }],
    queryFn: ({ signal }) => fetchAnalyses(workspaceId, offset, signal),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.some((a) => ['PLANNING', 'QUEUED', 'RUNNING'].includes(a.status))
        ? 2000
        : false,
  });
}
export function useAnalysisQuery(
  workspaceId: string,
  analysisId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.analysis(workspaceId, analysisId),
    queryFn: ({ signal }) => fetchAnalysis(workspaceId, analysisId, signal),
    enabled,
    refetchInterval: (q) =>
      q.state.data && ['PLANNING', 'QUEUED', 'RUNNING'].includes(q.state.data.status)
        ? 2000
        : false,
  });
}
export function useExecutionsQuery(
  workspaceId: string,
  analysisId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.executions(workspaceId, analysisId),
    queryFn: ({ signal }) => fetchExecutions(workspaceId, analysisId, signal),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.some((e) => ['QUEUED', 'RUNNING'].includes(e.status)) ? 2000 : false,
  });
}
export function useExecutionRecordQuery(
  workspaceId: string,
  analysisId: string,
  executionId: string,
) {
  return useQuery({
    queryKey: queryKeys.executionRecord(workspaceId, analysisId, executionId),
    queryFn: ({ signal }) =>
      fetchExecutionRecord(workspaceId, analysisId, executionId, signal),
    enabled: executionId.length > 0,
    refetchInterval: (q) =>
      q.state.data && ['QUEUED', 'RUNNING'].includes(q.state.data.execution.status)
        ? 2000
        : false,
  });
}
