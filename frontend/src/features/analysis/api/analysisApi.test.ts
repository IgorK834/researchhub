import { apiClient } from '../../../shared/api';
import { savedRecord } from '../testing/analysisFixtures';
import {
  analysesPath,
  analysisPath,
  fetchAnalyses,
  fetchAnalysis,
  createAnalysis,
  planAnalysis,
  executeAnalysis,
  fetchExecutions,
  fetchExecutionRecord,
  fetchChartImage,
  fetchAnalysisOrigin,
  rerunAnalysis,
  fetchComputationProvenance,
} from './analysisApi';

jest.mock('../../../shared/api', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), getBlob: jest.fn() },
}));
beforeEach(() => jest.resetAllMocks());
it('encodes all IDs and addresses immutable attempts with forwarded cancellation', async () => {
  const signal = new AbortController().signal;
  expect(analysesPath('w /')).toBe('/api/workspaces/w%20%2F/analyses');
  expect(analysisPath('w', 'a?')).toBe('/api/workspaces/w/analyses/a%3F');
  await fetchAnalyses('w', 50, signal);
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/workspaces/w/analyses?offset=50', {
    signal,
  });
  await fetchAnalyses('w');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses?offset=0',
    {},
  );
  await fetchAnalysis('w', 'a', signal);
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/workspaces/w/analyses/a', {
    signal,
  });
  await fetchExecutions('w', 'a');
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/executions',
    {},
  );
  await fetchExecutionRecord('w', 'a', 'run/1', signal);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/executions/run%2F1/record',
    { signal },
  );
});
it('sends intent only; Docker options and Python result values never come from the client', async () => {
  const input = {
    sourceId: 's',
    sourceVersionId: 'v',
    sheetName: 'sheet',
    columns: [1, 2],
  };
  await createAnalysis('w', 'Compute U/I', [input]);
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/workspaces/w/analyses', {
    body: { userPrompt: 'Compute U/I', inputs: [input] },
  });
  await planAnalysis('w', 'a');
  expect(apiClient.post).toHaveBeenLastCalledWith('/api/workspaces/w/analyses/a/plan', {
    body: {},
  });
  await executeAnalysis('w', 'a');
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/execute',
    { body: {} },
  );
});
it('loads only the bound artifact and rejects mismatched MIME types or byte lengths', async () => {
  const chart = savedRecord().charts[0]!;
  const png = new Blob([new Uint8Array(8)], { type: 'image/png' });
  const signal = new AbortController().signal;
  jest.mocked(apiClient.getBlob).mockResolvedValue(png);
  await expect(fetchChartImage('w', chart, signal)).resolves.toBe(png);
  expect(apiClient.getBlob).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/executions/run-1/artifacts/image-run-1',
    { signal },
  );
  await fetchChartImage('w', chart);
  expect(apiClient.getBlob).toHaveBeenLastCalledWith(expect.any(String), {});
  for (const bad of [
    new Blob(['wrong'], { type: 'image/png' }),
    new Blob([new Uint8Array(8)], { type: 'text/html' }),
  ]) {
    jest.mocked(apiClient.getBlob).mockResolvedValue(bad);
    await expect(fetchChartImage('w', chart)).rejects.toThrow('did not match');
  }
  const svgChart = {
    ...chart,
    image: { ...chart.image, mediaType: 'image/svg+xml' as const },
  };
  const svg = new Blob([new Uint8Array(8)], { type: 'image/svg+xml' });
  jest.mocked(apiClient.getBlob).mockResolvedValue(svg);
  await expect(fetchChartImage('w', svgChart)).resolves.toBe(svg);
});
it('addresses stable provenance and explicit rerun contracts without transmitting code', async () => {
  const signal = new AbortController().signal;
  jest.mocked(apiClient.get).mockResolvedValue({ lineage: null });
  await expect(fetchAnalysisOrigin('w', 'a', signal)).resolves.toBeNull();
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/workspaces/w/analyses/a/origin', {
    signal,
  });
  await fetchComputationProvenance('w', 'a', 'run/1', signal);
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/api/workspaces/w/analyses/a/executions/run%2F1/provenance',
    { signal },
  );
  for (const inputMode of ['ORIGINAL', 'LATEST'] as const) {
    await rerunAnalysis('w', 'a', 'run/1', inputMode);
    expect(apiClient.post).toHaveBeenLastCalledWith(
      '/api/workspaces/w/analyses/a/executions/run%2F1/rerun',
      { body: { inputMode } },
    );
  }
});
