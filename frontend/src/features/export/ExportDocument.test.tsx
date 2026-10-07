/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExportDocument } from './ExportDocument';
import { createExport, downloadExport, fetchExport, type ExportJob } from './exportApi';
jest.mock('./exportApi', () => ({
  ...jest.requireActual<typeof import('./exportApi')>('./exportApi'),
  createExport: jest.fn(),
  fetchExport: jest.fn(),
  downloadExport: jest.fn(),
}));
const base: ExportJob = {
  id: 'j',
  workspaceId: 'w',
  documentId: 'd',
  requestedBy: 'u',
  revision: 3,
  format: 'DOCX',
  status: 'QUEUED',
  filename: 'report.docx',
  warnings: [],
  createdAt: '',
  startedAt: null,
  finishedAt: null,
  expiresAt: '',
  failureCode: null,
  sha256: null,
  sizeBytes: 0,
};
let client: QueryClient;
function show(settled = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExportDocument workspaceId="w" documentId="d" revision={3} settled={settled} />
    </QueryClientProvider>,
  );
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
}
beforeEach(() => {
  jest.clearAllMocks();
  (createExport as jest.Mock).mockResolvedValue(base);
  (downloadExport as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});
it('prevents exporting unsaved edits and explains when export becomes available', () => {
  show(false);
  open();
  expect(
    screen.getByRole('button', { name: 'Generate export' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.getByText(/Wait for your changes/)).toBeTruthy();
  expect(createExport).not.toHaveBeenCalled();
});
it('generates the selected format, polls a job, and downloads its saved revision', async () => {
  (createExport as jest.Mock).mockResolvedValue({ ...base, format: 'PDF' });
  (fetchExport as jest.Mock)
    .mockResolvedValueOnce({ ...base, format: 'PDF', status: 'RUNNING' })
    .mockResolvedValue({
      ...base,
      format: 'PDF',
      status: 'SUCCEEDED',
      warnings: ['Legacy citation was frozen.'],
    });
  show();
  open();
  fireEvent.click(screen.getByRole('radio', { name: /PDF report/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate export' }));
  await waitFor(() => expect(createExport).toHaveBeenCalledWith('w', 'd', 'PDF', 3));
  await waitFor(() => expect(screen.getByText(/Preparing PDF/)).toBeTruthy());
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy(),
    { timeout: 3000 },
  );
  expect(screen.getByText('Legacy citation was frozen.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() =>
    expect(downloadExport).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCEEDED', revision: 3 }),
    ),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy();
});
it.each(['FAILED', 'EXPIRED'] as const)(
  'shows %s and allows regeneration',
  async (status) => {
    (fetchExport as jest.Mock).mockResolvedValue({
      ...base,
      status,
      failureCode: 'RENDER_INTERRUPTED',
    });
    show();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          status === 'FAILED' ? /Rendering was interrupted/ : /This export has expired/,
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: 'Generate export' }).hasAttribute('disabled'),
    ).toBe(false);
  },
);
it('shows creation and download errors and allows retry', async () => {
  (createExport as jest.Mock)
    .mockRejectedValueOnce(new Error('Export request failed'))
    .mockResolvedValue({ ...base, status: 'SUCCEEDED' });
  (fetchExport as jest.Mock).mockResolvedValue({ ...base, status: 'SUCCEEDED' });
  show();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate export' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Generate export' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeTruthy(),
  );
  (downloadExport as jest.Mock).mockRejectedValueOnce(new Error('Download failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Download DOCX' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
});
it('can retry a failed status check', async () => {
  (fetchExport as jest.Mock)
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue({ ...base, status: 'SUCCEEDED' });
  show();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Generate export' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Check export status' })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check export status' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeTruthy(),
  );
});
