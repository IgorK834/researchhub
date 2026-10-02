/** @jest-environment jsdom */
import { useState } from 'react';
import {
  act,
  createEvent,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../api/sourceApi';
import { sourceFixture, sourceApiError } from '../../../shared/testing/sourceFixtures';
import { queryKeys } from '../../../shared/api';
import { checkSourceFile, SOURCE_FILE_ACCEPT, SOURCE_TYPES } from '../api/sourceTypes';
import { SourceUploadForm } from './SourceUploadForm';

jest.mock('../api/sourceApi', () => ({
  ...jest.requireActual('../api/sourceApi'),
  uploadSource: jest.fn(),
  fetchSource: jest.fn(),
  fetchSourceProcessing: jest.fn(),
  reprocessSource: jest.fn(),
}));
const upload = jest.mocked(api.uploadSource);
const fetchSource = jest.mocked(api.fetchSource);
const processing = jest.mocked(api.fetchSourceProcessing);
const reprocess = jest.mocked(api.reprocessSource);
let client: QueryClient;
function view(path = '/', initiallyOpen = true) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <>
        <button onClick={() => setOpen(true)}>Reopen upload</button>
        <SourceUploadForm
          workspaceId="workspace-1"
          open={open}
          onClose={() => setOpen(false)}
        />
      </>
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function choose(...files: File[]) {
  fireEvent.change(screen.getByLabelText('Source file'), { target: { files } });
}
const textFile = (name = 'notes.txt') =>
  new File(['Research notes'], name, { type: 'text/plain' });
beforeEach(() => {
  fetchSource.mockResolvedValue(sourceFixture());
  processing.mockResolvedValue(undefined);
  upload.mockImplementation(async (_workspace, file) =>
    sourceFixture({ id: file.name, displayName: file.name, sourceType: 'TXT' }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  jest.resetAllMocks();
  jest.useRealTimers();
});

it('offers accessible browsing, the size limit and exactly five supported types', () => {
  view();
  const input = screen.getByLabelText('Source file') as HTMLInputElement;
  expect(input.accept).toBe(SOURCE_FILE_ACCEPT);
  expect(input.multiple).toBe(true);
  const click = jest.spyOn(input, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));
  expect(click).toHaveBeenCalledTimes(1);
  for (const type of SOURCE_TYPES) expect(screen.getByText(type)).not.toBeNull();
  expect(screen.getByText('Up to 50 MB per file. Supported types:')).not.toBeNull();
  choose();
  fireEvent.change(input, { target: { files: null } });
  expect(screen.queryByRole('list', { name: 'Upload queue' })).toBeNull();
});
it('uploads each selected file once using its own progress callback', async () => {
  upload.mockImplementation((_workspace, file, progress) => {
    progress?.(5, 10);
    return new Promise(() => {});
  });
  view();
  choose(textFile('one.txt'), textFile('two.txt'));
  expect(await screen.findByText('Uploading one.txt: 50%')).not.toBeNull();
  expect(screen.getByText('Uploading two.txt: 50%')).not.toBeNull();
  expect(screen.getAllByLabelText('Upload progress')).toHaveLength(2);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(
    upload.mock.calls.every(
      ([id, , callback]) => id === 'workspace-1' && typeof callback === 'function',
    ),
  ).toBe(true);
});
it('supports drag and drop, drag feedback and completed files', async () => {
  view();
  const dropzone = screen.getByText('Drop files here').closest('.dropzone')!;
  const dataTransfer = { files: [textFile()], dropEffect: 'none' };
  fireEvent.dragEnter(dropzone, { dataTransfer });
  expect(dropzone.className).toContain('dragging');
  fireEvent.dragOver(dropzone, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe('copy');
  const leave = createEvent.dragLeave(dropzone);
  Object.defineProperty(leave, 'relatedTarget', {
    value: screen.getByRole('button', { name: 'Browse files' }),
  });
  fireEvent(dropzone, leave);
  expect(dropzone.className).toContain('dragging');
  fireEvent.dragLeave(dropzone);
  expect(dropzone.className).not.toContain('dragging');
  fireEvent.drop(dropzone, { dataTransfer });
  expect(await screen.findByText('Uploaded notes.txt.')).not.toBeNull();
  expect(await screen.findByText('Ready')).not.toBeNull();
  expect(screen.getByRole('heading', { name: '1 file' })).not.toBeNull();
});
it('keeps each validation message unchanged and accepts the valid file in a mixed selection', async () => {
  view();
  const empty = new File([], 'empty.csv', { type: 'text/csv' });
  const unsupported = textFile('program.exe');
  const mismatch = new File(['data'], 'wrong.pdf', { type: 'text/plain' });
  const large = textFile('large.txt');
  Object.defineProperty(large, 'size', { value: 52428801 });
  const files = [empty, unsupported, mismatch, large];
  choose(...files, textFile());
  for (const file of files) {
    const check = checkSourceFile(file);
    if (!check.ok) expect(screen.getByText(check.message)).not.toBeNull();
  }
  expect(await screen.findByText('Uploaded notes.txt.')).not.toBeNull();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
it('bounds server errors without replacing their wording and retries just that file', async () => {
  upload
    .mockRejectedValueOnce(
      sourceApiError('The file contents do not match its .csv extension'),
    )
    .mockResolvedValueOnce(sourceFixture());
  view();
  choose(textFile());
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('The file contents do not match its .csv extension');
  expect(alert.getAttribute('title')).toBe(alert.textContent);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Uploaded notes.txt.')).not.toBeNull();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('continues an in-flight upload when closed and retains the queue on reopening', async () => {
  let finish!: (source: api.WorkspaceSource) => void;
  upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  view();
  choose(textFile());
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {
    finish(sourceFixture());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reopen upload' }));
  expect(await screen.findByText('Uploaded notes.txt.')).not.toBeNull();
  expect(upload).toHaveBeenCalledTimes(1);
});
it('transitions uploaded files through server processing to ready without uploading again', async () => {
  upload.mockResolvedValue(sourceFixture({ status: 'UPLOADED' }));
  fetchSource.mockImplementation(() => new Promise(() => {}));
  processing.mockResolvedValue({
    jobId: 'job',
    status: 'RUNNING',
    stage: 'EMBED',
    progress: 64,
    attempt: 1,
  });
  view();
  choose(textFile());
  expect(await screen.findByText('Uploaded')).not.toBeNull();
  expect(await screen.findByText('Making source searchable · 64%')).not.toBeNull();
  act(() => {
    client.setQueryData(
      queryKeys.source('workspace-1', 'source-1'),
      sourceFixture({ status: 'PROCESSING' }),
    );
  });
  expect(await screen.findByText('Processing')).not.toBeNull();
  act(() => {
    client.setQueryData(queryKeys.source('workspace-1', 'source-1'), sourceFixture());
  });
  expect(await screen.findByText('Ready')).not.toBeNull();
  expect(screen.queryByLabelText('Source processing progress')).toBeNull();
  expect(upload).toHaveBeenCalledTimes(1);
});
it.each([null, 'The workbook is encrypted.'])(
  'shows processing failure (%s), retrying via reprocess instead of reupload',
  async (failureSummary) => {
    const failed = sourceFixture({ status: 'FAILED', failureSummary });
    upload.mockResolvedValue(failed);
    fetchSource.mockResolvedValue(failed);
    reprocess.mockResolvedValue(sourceFixture({ status: 'UPLOADED' }));
    view();
    choose(textFile());
    expect((await screen.findByRole('alert')).textContent).toBe(
      failureSummary ?? 'Source processing failed.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(reprocess).toHaveBeenCalledWith('workspace-1', 'source-1'),
    );
    expect(upload).toHaveBeenCalledTimes(1);
  },
);
it('reports a status read error without losing the uploaded file', async () => {
  upload.mockResolvedValue(sourceFixture());
  fetchSource.mockRejectedValue(sourceApiError('Status unavailable'));
  view();
  choose(textFile());
  expect((await screen.findByRole('alert')).textContent).toContain('Status unavailable');
  expect(
    within(screen.getByRole('list', { name: 'Upload queue' })).getByText('notes.txt'),
  ).not.toBeNull();
});
it('opens the shell fragment and allows dismissal', () => {
  view('/#upload-source-heading', false);
  expect(screen.getByRole('dialog')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps indeterminate progress for unknown totals and clamps oversized progress', async () => {
  upload.mockImplementation((_workspace, _file, callback) => {
    callback?.(2, 0);
    return new Promise(() => {});
  });
  view();
  choose(textFile());
  await waitFor(() => expect(upload).toHaveBeenCalled());
  expect(screen.getByLabelText('Upload progress').getAttribute('value')).toBeNull();
  const callback = upload.mock.calls[0]![2]!;
  act(() => callback(200, 100));
  expect(screen.getByLabelText('Upload progress').getAttribute('value')).toBe('100');
});
it('falls back to progress text while a processing read is unavailable', async () => {
  upload.mockResolvedValue(sourceFixture({ status: 'PROCESSING' }));
  fetchSource.mockResolvedValue(sourceFixture({ status: 'PROCESSING' }));
  processing.mockRejectedValue(sourceApiError('No progress available'));
  view();
  choose(textFile());
  expect(
    await screen.findByText('Processing source. Progress is temporarily unavailable.'),
  ).not.toBeNull();
});
