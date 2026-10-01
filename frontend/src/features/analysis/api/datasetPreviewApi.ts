import { apiClient } from '../../../shared/api';

/** Mirrors `contracts/analysis/dataset-preview/v1` and the Spring `DatasetPreview` record. */

export type InferredType =
  | 'INTEGER'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'TEXT'
  | 'FORMULA'
  | 'ERROR'
  | 'MIXED'
  | 'UNKNOWN';

export type PreviewWarningCode =
  | 'SHEETS_OMITTED'
  | 'ROWS_TRUNCATED'
  | 'COLUMNS_TRUNCATED'
  | 'ROW_COUNT_ESTIMATED'
  | 'MISSING_VALUES_PARTIAL'
  | 'VALUES_SHORTENED'
  | 'FORMULAS_NOT_EVALUATED'
  | 'TYPES_INFERRED'
  | 'RESPONSE_SIZE_CAPPED';

export interface PreviewWarning {
  readonly code: PreviewWarningCode;
  /** The sheet the warning concerns, or null when it applies to the whole file. */
  readonly sheet: string | null;
  readonly message: string;
}

export interface PreviewColumn {
  /** 1-based column number in the sheet. */
  readonly index: number;
  readonly name: string;
  readonly inferredType: InferredType;
  readonly missingValues: number;
  readonly profiledValues: number;
  readonly missingValuesExact: boolean;
}

export interface PreviewRow {
  /** Physical 1-based row in the sheet. Rows hold data only: the header is described by `columns`. */
  readonly rowNumber: number;
  readonly cells: readonly string[];
}

export interface PreviewDimensions {
  readonly usedRange: string | null;
  /** Rows including the header; null when the bounded scan stopped early and no estimate exists. */
  readonly rowCount: number | null;
  /** Rows excluding the header. */
  readonly dataRowCount: number | null;
  readonly rowCountEstimated: boolean;
  readonly scannedRows: number;
  /** Total columns in the sheet, which can exceed the columns listed. */
  readonly columnCount: number | null;
}

export interface PreviewSheet {
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'veryHidden';
  readonly headerRow: number | null;
  readonly formulaPresence: boolean | null;
  readonly dimensions: PreviewDimensions;
  readonly columns: readonly PreviewColumn[];
  readonly sampleRows: readonly PreviewRow[];
  readonly truncated: boolean;
}

export interface DatasetPreview {
  readonly schemaVersion: '1.0';
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly originalFilename: string;
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly format: 'CSV' | 'XLSX';
  readonly formulasEvaluated: false;
  readonly truncated: boolean;
  readonly limits: {
    readonly maxResponseBytes: number;
    readonly maxSheets: number;
    readonly maxColumns: number;
    readonly maxSampleRows: number;
    readonly maxCells: number;
    readonly maxCellBytes: number;
  };
  readonly warnings: readonly PreviewWarning[];
  readonly sheets: readonly PreviewSheet[];
}

export function datasetPreviewPath(
  workspaceId: string,
  sourceId: string,
  sourceVersionId: string,
): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/analysis/datasets/${encodeURIComponent(sourceId)}/versions/${encodeURIComponent(sourceVersionId)}/preview`;
}

/** One bounded request: the server never sends more than its documented caps, whatever the file size. */
export function fetchDatasetPreview(
  workspaceId: string,
  sourceId: string,
  sourceVersionId: string,
  signal?: AbortSignal,
): Promise<DatasetPreview> {
  return apiClient.get(datasetPreviewPath(workspaceId, sourceId, sourceVersionId), {
    ...(signal === undefined ? {} : { signal }),
  });
}
