import type { Analysis, ExecutionRecord } from '../api/analysisApi';

/** Contract fixtures only; production never constructs computed results in the browser. */
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;
export function savedRecord(id = 'run-1', attempt = 1): Mutable<ExecutionRecord> {
  return {
    schemaVersion: '1.0',
    snapshot: {
      userPrompt: 'Calculate impedance U/I and plot impedance versus frequency.',
      plan: {
        schemaVersion: '1.0',
        summary: 'Calculate impedance versus frequency',
        inputs: [
          {
            sourceVersionId: 'v3',
            sheetName: 'measurements',
            requiredColumns: [1, 2, 3],
          },
        ],
        transformations: [
          {
            name: 'impedance',
            description: 'Convert current to amperes and compute U/I',
            sourceVersionId: 'v3',
            sheetName: 'measurements',
            columns: [1, 2, 3],
          },
        ],
        statisticalOperations: [],
        outputs: [
          {
            kind: 'TABLE',
            name: 'impedance-table',
            description: 'Computed impedance',
            sourceVersionIds: ['v3'],
          },
          {
            kind: 'CHART',
            name: 'impedance-chart',
            description: 'Computed chart',
            sourceVersionIds: ['v3'],
          },
        ],
        assumptions: ['Current is expressed in mA.'],
        warnings: ['Verify units before re-running.'],
        code: {
          language: 'PYTHON',
          source:
            '# Exact recorded Python\n# <script>untrusted text</script>\nimport pandas as pd',
        },
      },
      inputs: [
        {
          sourceId: 's',
          sourceVersionId: 'v3',
          versionNumber: 3,
          originalFilename: 'measurements.xlsx',
          format: 'XLSX',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
          sheets: [
            {
              name: 'measurements',
              columns: [
                { index: 1, label: 'Frequency' },
                { index: 2, label: 'Voltage' },
                { index: 3, label: 'Current' },
              ],
            },
          ],
        },
      ],
    },
    execution: {
      id,
      analysisId: 'a',
      workspaceId: 'w',
      requestedBy: 'researcher',
      attempt,
      status: 'SUCCEEDED',
      createdAt: '2026-10-01T12:00:00Z',
      startedAt: '2026-10-01T12:00:01Z',
      finishedAt: '2026-10-01T12:00:03Z',
      provenance: {
        planId: 'plan-1',
        planSha256: 'b'.repeat(64),
        codeSha256: 'c'.repeat(64),
        inputs: [
          {
            sourceId: 's',
            sourceVersionId: 'v3',
            format: 'XLSX',
            sizeBytes: 1024,
            sha256: 'a'.repeat(64),
          },
        ],
        imageId: `sha256:${'d'.repeat(64)}`,
        runtimeVersion: '1.1.0',
      },
      result: {
        schemaVersion: '2.0',
        outputs: [
          {
            kind: 'TABLE',
            name: 'impedance-table',
            columns: ['Frequency (Hz)', 'Impedance (Ω)'],
            rows: [
              [100, 2000],
              [200, 1000],
            ],
          },
          {
            kind: 'CHART',
            name: 'impedance-chart',
            artifact: {
              id: `image-${id}`,
              filename: 'impedance.png',
              mediaType: 'image/png',
              sizeBytes: 8,
              sha256: 'e'.repeat(64),
            },
          },
          {
            kind: 'TEXT',
            name: 'notes',
            text: 'Calculated from the selected immutable version.',
          },
        ],
      },
      failureCode: null,
      diagnostics: {
        exitCode: 0,
        timedOut: false,
        stdout: '2 rows computed',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMillis: 2000,
        configuredImage: 'researchhub-sandbox:1.1.0',
      },
    },
    charts: [
      {
        name: 'impedance-chart',
        title: 'Impedance magnitude versus frequency',
        xAxis: { label: 'Frequency f', unit: 'Hz', scale: 'LOG' },
        yAxis: { label: 'Impedance |Z|', unit: 'Ω', scale: 'LOG' },
        series: [
          {
            name: '|Z|',
            tableName: 'impedance-table',
            xColumn: 'Frequency (Hz)',
            yColumn: 'Impedance (Ω)',
            yTransform: 'ABS',
            rowCount: 2,
            pointCount: 2,
          },
        ],
        sourceAnalysisId: 'a',
        executionId: id,
        codeSha256: 'c'.repeat(64),
        image: {
          id: `image-${id}`,
          filename: 'impedance.png',
          mediaType: 'image/png',
          sizeBytes: 8,
          sha256: 'e'.repeat(64),
        },
        metadataAvailable: true,
      },
    ],
  };
}
export function savedAnalysis(): Analysis {
  const record = savedRecord();
  return {
    id: 'a',
    workspaceId: 'w',
    createdBy: 'researcher',
    userPrompt: record.snapshot.userPrompt,
    status: 'SUCCEEDED',
    createdAt: record.execution.createdAt,
    updatedAt: record.execution.finishedAt!,
    inputs: [
      {
        sourceId: 's',
        sourceVersionId: 'v3',
        sheetName: 'measurements',
        columns: [1, 2, 3],
      },
    ],
    planId: 'plan-1',
    plan: record.snapshot.plan,
    failureCode: null,
  };
}
