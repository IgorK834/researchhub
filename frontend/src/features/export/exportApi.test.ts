/** @jest-environment jsdom */
import { apiClient } from '../../shared/api';
import {
  createExport,
  downloadExport,
  exportFailure,
  fetchExport,
  type ExportJob,
} from './exportApi';
jest.mock('../../shared/api', () => ({
  apiClient: { post: jest.fn(), get: jest.fn(), getBlob: jest.fn() },
}));
const job: ExportJob = {
  id: 'j',
  workspaceId: 'w',
  documentId: 'd',
  requestedBy: 'u',
  revision: 3,
  format: 'DOCX',
  status: 'SUCCEEDED',
  filename: 'report.docx',
  warnings: [],
  createdAt: '',
  startedAt: null,
  finishedAt: '',
  expiresAt: '',
  failureCode: null,
  sha256: 'a',
  sizeBytes: 20,
};
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});
it('sends explicit format/revision and escapes every path segment', async () => {
  await createExport('w/a', 'd/a', 'PDF', 7);
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/w%2Fa/documents/d%2Fa/exports',
    { body: { format: 'PDF', revision: 7 } },
  );
  const signal = new AbortController().signal;
  await fetchExport('w/a', 'd/a', 'j/a', signal);
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/workspaces/w%2Fa/documents/d%2Fa/exports/j%2Fa',
    { signal },
  );
});
it.each(['PDF', 'DOCX', 'LATEX'] as const)(
  'downloads %s through authenticated transport and releases its URL',
  async (format) => {
    jest.useFakeTimers();
    (apiClient.getBlob as jest.Mock).mockResolvedValue(new Blob(['artifact']));
    URL.createObjectURL = jest.fn().mockReturnValue('blob:report');
    URL.revokeObjectURL = jest.fn();
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await downloadExport({ ...job, format });
    expect(apiClient.getBlob).toHaveBeenCalledWith(
      '/api/workspaces/w/documents/d/exports/j/download',
      {
        accept: {
          PDF: 'application/pdf',
          DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          LATEX: 'application/zip',
        }[format],
      },
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a')).toBeNull();
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
    click.mockRestore();
  },
);
it('propagates download errors and translates stable failure codes', async () => {
  (apiClient.getBlob as jest.Mock).mockRejectedValue(new Error('denied'));
  await expect(downloadExport(job)).rejects.toThrow('denied');
  for (const code of [
    'ACCESS_REVOKED',
    'OUTPUT_TOO_LARGE',
    'RENDER_INTERRUPTED',
    'RENDER_FAILED',
    null,
  ])
    expect(exportFailure(code).length).toBeGreaterThan(20);
});
