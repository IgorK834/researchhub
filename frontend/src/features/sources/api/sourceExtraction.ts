import { apiClient } from '../../../shared/api';

export interface ExtractedUnit {
  readonly sourceId: string;
  readonly parserVersion: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly pageNumber: number | null;
  readonly sectionId: string | null;
  readonly characterStart: number;
  readonly characterEnd: number;
  readonly location: {
    readonly kind: 'PDF_PAGE' | 'PARAGRAPH' | 'HEADING' | 'TABLE' | 'SHEET' | 'TEXT';
    readonly blockIndex: number | null;
    readonly headingLevel: number | null;
    readonly sheetName: string | null;
    readonly cellRange: string | null;
  } | null;
}

export interface SheetMetadata {
  readonly previewRows: readonly {
    readonly rowNumber: number;
    readonly cells: readonly string[];
  }[];
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'veryHidden';
  readonly usedRange: string | null;
  readonly rowCountEstimate: number | null;
  readonly columnCount: number | null;
  readonly headerCandidate: readonly string[];
  readonly headerRow: number | null;
  readonly columns: readonly {
    readonly columnNumber: number;
    readonly values: readonly string[];
    readonly dataTypes: readonly string[];
  }[];
  readonly sampledRows: number;
  readonly truncated: boolean;
  readonly formulaPresence: boolean | null;
  readonly formulaScanComplete: boolean;
}

export interface CsvProfile {
  readonly schemaVersion: '1.0';
  readonly encoding: 'UTF-8' | 'UTF-8-BOM';
  readonly delimiter: ',' | ';' | '\t' | '|' | null;
  readonly headerPolicy: 'FIRST_NONEMPTY_RECORD';
  readonly missingValuePolicy: 'EMPTY_OR_WHITESPACE';
  readonly indexPolicy: 'SCHEMA_ONLY';
  readonly rowCount: number | null;
  readonly profiledRowCount: number;
  readonly rowScanComplete: boolean;
  readonly columns: readonly {
    readonly columnNumber: number;
    readonly name: string;
    readonly inferredType: 'integer' | 'number' | 'boolean' | 'date' | 'text' | 'unknown';
    readonly missingCount: number;
  }[];
}

export interface SourceExtraction {
  readonly processingVersion: string;
  readonly parserVersion: string;
  readonly extractionMetadata: {
    readonly title: string | null;
    readonly author: string | null;
    readonly language: string | null;
    readonly pageCount: number;
    readonly characterCount: number;
    readonly contentSha256: string;
  };
  readonly structure: {
    readonly pages: readonly {
      readonly pageNumber: number;
      readonly characterStart: number;
      readonly characterEnd: number;
    }[];
    readonly sections: readonly {
      readonly sectionId: string;
      readonly heading: string | null;
      readonly level: number;
      readonly parentSectionId: string | null;
      readonly characterStart: number;
      readonly characterEnd: number;
    }[];
  };
  readonly chunks: readonly ExtractedUnit[];
  readonly warnings: readonly string[];
  readonly workbook: {
    readonly csvProfile?: CsvProfile | null;
    readonly previewRowLimit: number;
    readonly sheets: readonly SheetMetadata[];
    readonly rowLimit: number;
    readonly columnLimit: number;
    readonly sampleLimit: number;
  } | null;
}

export async function fetchSourceExtraction(
  workspaceId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<SourceExtraction | null> {
  const result = await apiClient.get<SourceExtraction | undefined>(
    `/api/workspaces/${workspaceId}/sources/${sourceId}/extraction`,
    { ...(signal === undefined ? {} : { signal }) },
  );
  return result ?? null;
}

export interface ExtractionRun {
  readonly jobId: string;
  readonly parserVersion: string;
  readonly processingVersion: string;
  readonly schemaVersion: string;
  readonly persistedAt: string;
  readonly jobStatus: string;
}

export function fetchExtractionRuns(
  workspaceId: string,
  sourceId: string,
  signal?: AbortSignal,
): Promise<readonly ExtractionRun[]> {
  return apiClient.get<readonly ExtractionRun[]>(
    `/api/workspaces/${workspaceId}/sources/${sourceId}/extraction/runs`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
