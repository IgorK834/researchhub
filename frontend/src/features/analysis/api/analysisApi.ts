import { apiClient } from '../../../shared/api';

export type AnalysisStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'READY_TO_EXECUTE'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export interface AnalysisInput {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sheetName: string | null;
  readonly columns: readonly number[] | null;
}
export interface PlanStep {
  readonly name: string;
  readonly description: string;
  readonly sourceVersionId: string;
  readonly sheetName: string;
  readonly columns: readonly number[];
}
export interface AnalysisPlan {
  readonly schemaVersion: '1.0';
  readonly summary: string;
  readonly inputs: readonly {
    readonly sourceVersionId: string;
    readonly sheetName: string;
    readonly requiredColumns: readonly number[];
  }[];
  readonly transformations: readonly PlanStep[];
  readonly statisticalOperations: readonly PlanStep[];
  readonly outputs: readonly {
    readonly kind: 'TABLE' | 'CHART' | 'TEXT';
    readonly name: string;
    readonly description: string;
    readonly sourceVersionIds: readonly string[];
  }[];
  readonly assumptions: readonly string[];
  readonly warnings: readonly string[];
  readonly code: { readonly language: 'PYTHON'; readonly source: string };
}
export interface Analysis {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdBy: string;
  readonly userPrompt: string;
  readonly status: AnalysisStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly inputs: readonly AnalysisInput[];
  readonly planId: string | null;
  readonly plan: AnalysisPlan | null;
  readonly failureCode: string | null;
}
export interface Artifact {
  readonly id: string;
  readonly filename: string;
  readonly mediaType: 'image/png' | 'image/svg+xml';
  readonly sizeBytes: number;
  readonly sha256: string;
}
export interface Axis {
  readonly label: string;
  readonly unit: string | null;
  readonly scale: 'LINEAR' | 'LOG';
}
export interface ChartSeries {
  readonly name: string;
  readonly tableName: string;
  readonly xColumn: string;
  readonly yColumn: string;
  readonly yTransform: 'IDENTITY' | 'ABS';
  readonly rowCount: number;
  readonly pointCount: number;
}
export interface Chart {
  readonly name: string;
  readonly title: string;
  readonly xAxis: Axis | null;
  readonly yAxis: Axis | null;
  readonly series: readonly ChartSeries[];
  readonly sourceAnalysisId: string;
  readonly executionId: string;
  readonly codeSha256: string;
  readonly image: Artifact;
  readonly metadataAvailable: boolean;
}
export type Scalar = string | number | boolean | null;
export type ComputedOutput =
  | {
      readonly kind: 'TABLE';
      readonly name: string;
      readonly columns: readonly string[];
      readonly rows: readonly (readonly Scalar[])[];
    }
  | { readonly kind: 'TEXT'; readonly name: string; readonly text: string }
  | { readonly kind: 'CHART'; readonly name: string; readonly artifact: Artifact };
export interface Execution {
  readonly id: string;
  readonly analysisId: string;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly attempt: number;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly provenance: {
    readonly planId: string;
    readonly planSha256: string;
    readonly codeSha256: string;
    readonly inputs: readonly {
      readonly sourceId: string;
      readonly sourceVersionId: string;
      readonly format: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    }[];
    readonly imageId: string | null;
    readonly runtimeVersion: string | null;
  };
  readonly result: {
    readonly schemaVersion: '1.0' | '2.0';
    readonly outputs: readonly ComputedOutput[];
  } | null;
  readonly failureCode: string | null;
  readonly diagnostics: {
    readonly exitCode: number | null;
    readonly timedOut: boolean;
    readonly stdout: string;
    readonly stderr: string;
    readonly stdoutTruncated: boolean;
    readonly stderrTruncated: boolean;
    readonly durationMillis: number;
    readonly configuredImage: string;
  } | null;
}
export interface ExecutionRecord {
  readonly schemaVersion: '1.0';
  readonly snapshot: {
    readonly lineage?: AnalysisLineage | null;
    readonly userPrompt: string;
    readonly plan: AnalysisPlan;
    readonly inputs: readonly {
      readonly sourceId: string;
      readonly sourceVersionId: string;
      readonly versionNumber: number;
      readonly originalFilename: string;
      readonly format: string;
      readonly sizeBytes: number;
      readonly sha256: string;
      readonly sheets: readonly {
        readonly name: string;
        readonly columns: readonly {
          readonly index: number;
          readonly label: string | null;
        }[];
      }[];
    }[];
  };
  readonly execution: Execution;
  readonly charts: readonly Chart[];
}
export interface AnalysisLineage {
  readonly originAnalysisId: string;
  readonly originExecutionId: string;
  readonly inputMode: 'ORIGINAL' | 'LATEST';
  readonly versions: readonly {
    readonly sourceId: string;
    readonly originalVersionId: string;
    readonly originalVersionNumber: number;
    readonly selectedVersionId: string;
    readonly selectedVersionNumber: number;
  }[];
  readonly requestedRuntime: {
    readonly imageId: string;
    readonly runtimeVersion: string;
  } | null;
}
export interface RerunResult {
  readonly analysisId: string;
  readonly execution: Execution | null;
  readonly lineage: AnalysisLineage;
  readonly failureCode: string | null;
}
export interface ComputationProvenance {
  readonly schemaVersion: '1.0';
  readonly workspaceId: string;
  readonly analysisId: string;
  readonly executionId: string;
  readonly status: Execution['status'];
  readonly inputSources: ExecutionRecord['snapshot']['inputs'];
  readonly prompt: string;
  readonly planSummary: string;
  readonly warnings: readonly string[];
  readonly code: {
    readonly language: 'PYTHON';
    readonly sha256: string;
    readonly url: string;
  };
  readonly result: Execution['result'];
  readonly charts: readonly Chart[];
  readonly outputReferences: readonly {
    readonly name: string;
    readonly kind: ComputedOutput['kind'];
    readonly provenanceUrl: string;
    readonly detailsUrl: string;
    readonly artifactUrl: string | null;
  }[];
  readonly executionTimestamp: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly runtimeVersion: string | null;
  readonly imageId: string | null;
  readonly lineage: AnalysisLineage | null;
  readonly executionHash: string;
  readonly links: {
    readonly provenance: string;
    readonly record: string;
    readonly code: string;
    readonly details: string;
  };
}
export interface DatasetChoice {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly label: string;
}
export const analysesPath = (workspaceId: string): string =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/analyses`;
export const analysisPath = (workspaceId: string, analysisId: string): string =>
  `${analysesPath(workspaceId)}/${encodeURIComponent(analysisId)}`;
export const executionPath = (
  workspaceId: string,
  analysisId: string,
  executionId: string,
): string =>
  `${analysisPath(workspaceId, analysisId)}/executions/${encodeURIComponent(executionId)}`;
const signalOptions = (signal?: AbortSignal): { readonly signal?: AbortSignal } =>
  signal === undefined ? {} : { signal };
export const fetchAnalyses = (
  workspaceId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<readonly Analysis[]> =>
  apiClient.get(`${analysesPath(workspaceId)}?offset=${offset}`, signalOptions(signal));
export const fetchAnalysis = (
  workspaceId: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<Analysis> =>
  apiClient.get(analysisPath(workspaceId, analysisId), signalOptions(signal));
export const createAnalysis = (
  workspaceId: string,
  userPrompt: string,
  inputs: readonly AnalysisInput[],
): Promise<Analysis> =>
  apiClient.post(analysesPath(workspaceId), { body: { userPrompt, inputs } });
export const planAnalysis = (
  workspaceId: string,
  analysisId: string,
): Promise<Analysis> =>
  apiClient.post(`${analysisPath(workspaceId, analysisId)}/plan`, { body: {} });
export const executeAnalysis = (
  workspaceId: string,
  analysisId: string,
): Promise<Execution> =>
  apiClient.post(`${analysisPath(workspaceId, analysisId)}/execute`, { body: {} });
export const fetchExecutions = (
  workspaceId: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<readonly Execution[]> =>
  apiClient.get(
    `${analysisPath(workspaceId, analysisId)}/executions`,
    signalOptions(signal),
  );
export const fetchExecutionRecord = (
  workspaceId: string,
  analysisId: string,
  executionId: string,
  signal?: AbortSignal,
): Promise<ExecutionRecord> =>
  apiClient.get(
    `${executionPath(workspaceId, analysisId, executionId)}/record`,
    signalOptions(signal),
  );
export const fetchAnalysisOrigin = (
  workspaceId: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<AnalysisLineage | null> =>
  apiClient
    .get<{ readonly lineage: AnalysisLineage | null }>(
      `${analysisPath(workspaceId, analysisId)}/origin`,
      signalOptions(signal),
    )
    .then((body) => body.lineage);
export const rerunAnalysis = (
  workspaceId: string,
  analysisId: string,
  executionId: string,
  inputMode: AnalysisLineage['inputMode'],
): Promise<RerunResult> =>
  apiClient.post(`${executionPath(workspaceId, analysisId, executionId)}/rerun`, {
    body: { inputMode },
  });
export const fetchComputationProvenance = (
  workspaceId: string,
  analysisId: string,
  executionId: string,
  signal?: AbortSignal,
): Promise<ComputationProvenance> =>
  apiClient.get(
    `${executionPath(workspaceId, analysisId, executionId)}/provenance`,
    signalOptions(signal),
  );
export async function fetchChartImage(
  workspaceId: string,
  chart: Chart,
  signal?: AbortSignal,
): Promise<Blob> {
  const blob = await apiClient.getBlob(
    `${executionPath(workspaceId, chart.sourceAnalysisId, chart.executionId)}/artifacts/${encodeURIComponent(chart.image.id)}`,
    signalOptions(signal),
  );
  if (
    blob.size !== chart.image.sizeBytes ||
    blob.type !== chart.image.mediaType ||
    !['image/png', 'image/svg+xml'].includes(blob.type)
  )
    throw new Error('The saved chart image did not match its record.');
  return blob;
}
