/** @jest-environment jsdom */
import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import * as analysisApi from '../api/analysisApi';
import * as documentApi from '../../documents/api/documentApi';
import {
  semanticRecord,
  semanticAnalysis,
  executionId,
  newerId,
  analysisId,
  reference,
} from '../testing/semanticFixtures';
import { AnalysisOutputPicker } from './AnalysisOutputPicker';
import { InsertAnalysisResult } from './InsertAnalysisResult';
import { AnalysisEvidencePicker } from '../../ai/components/AnalysisEvidencePicker';
import type { AnalysisEvidenceReference } from '../../ai/api/generationApi';
import { ApiError } from '../../../shared/api';
import { desktopMedia } from '../../../shared/testing/desktopMedia';
let client: QueryClient;
let media: ReturnType<typeof desktopMedia>;
const doc: documentApi.WorkspaceDocument = {
  id: 'd',
  title: 'Experimental report',
  contentFormat: 'PROSEMIRROR_JSON',
  content: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: {
          level: 2,
        },
        content: [
          {
            type: 'text',
            text: 'Findings',
          },
        ],
      },
      {
        type: 'paragraph',
      },
    ],
  },
  revision: 3,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
  archivedAt: null,
};
function Location() {
  const l = useLocation();
  return (
    <output aria-label="Location">
      {l.pathname}
      {l.hash}
    </output>
  );
}
function mount(child: ReactElement) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {child}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  media = desktopMedia();
  jest.spyOn(analysisApi, 'fetchAnalyses').mockResolvedValue([semanticAnalysis()]);
  jest.spyOn(analysisApi, 'fetchExecutions').mockResolvedValue([
    semanticRecord(newerId).execution,
    semanticRecord().execution,
    {
      ...semanticRecord().execution,
      id: 'failed',
      status: 'FAILED',
    },
  ]);
  jest
    .spyOn(analysisApi, 'fetchExecutionRecord')
    .mockImplementation(async (_w, _a, e) => semanticRecord(e));
  jest.spyOn(documentApi, 'fetchDocuments').mockResolvedValue([doc]);
  jest.spyOn(documentApi, 'fetchDocument').mockResolvedValue(doc);
});
afterEach(() => {
  cleanup();
  client.clear();
  media.restore();
  jest.restoreAllMocks();
});
async function pick() {
  await screen.findByRole('option', { name: 'Calculate impedance versus frequency' });
  fireEvent.change(await screen.findByLabelText('Analysis'), {
    target: {
      value: analysisId,
    },
  });
  await waitFor(() => expect(screen.getByText(/Attempt 2/)).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Execution'), {
    target: {
      value: newerId,
    },
  });
  await screen.findByText('impedance-table (TABLE)');
  fireEvent.change(screen.getByLabelText('Output'), {
    target: {
      value: 'impedance-table',
    },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Use selected output',
    }),
  );
}
test('picker never selects latest implicitly, ignores failed executions and chooses exact metadata', async () => {
  const choose = jest.fn();
  mount(<AnalysisOutputPicker workspaceId="w" initial={reference} onChoose={choose} />);
  await screen.findByText('impedance-chart (CHART)');
  expect((screen.getByLabelText('Execution') as HTMLSelectElement).value).toBe(
    executionId,
  );
  expect(choose).not.toHaveBeenCalled();
  expect(screen.queryByText(/failed/)).toBeNull();
  await pick();
  expect(choose).toHaveBeenCalledWith({
    analysisId,
    executionId: newerId,
    outputId: 'impedance-table',
    renderMode: 'TABLE',
  });
});
test('picker handles unavailable records and paged analyses', async () => {
  jest
    .mocked(analysisApi.fetchAnalyses)
    .mockResolvedValueOnce(
      Array.from(
        {
          length: 50,
        },
        (_, i) => ({
          ...semanticAnalysis(),
          id: `a-${i}`,
        }),
      ),
    )
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  mount(<AnalysisOutputPicker workspaceId="w" onChoose={jest.fn()} />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Older analyses',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Older analyses',
    }),
  );
  await waitFor(() =>
    expect(analysisApi.fetchAnalyses).toHaveBeenCalledWith(
      'w',
      50,
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Newer analyses',
    }),
  );
  await waitFor(() =>
    expect(analysisApi.fetchAnalyses).toHaveBeenCalledWith(
      'w',
      0,
      expect.any(AbortSignal),
    ),
  );
});
test('picker disables submission when selected record fails to load or is not successful', async () => {
  jest
    .mocked(analysisApi.fetchExecutionRecord)
    .mockRejectedValue(new Error('Unavailable'));
  mount(
    <AnalysisOutputPicker workspaceId="w" initial={reference} onChoose={jest.fn()} />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load saved outputs',
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Use selected output',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test('insertion saves a semantic block at the selected position with an optimistic revision, then navigates', async () => {
  const save = jest.spyOn(documentApi, 'updateDocument').mockResolvedValue({
    ...doc,
    revision: 4,
  });
  const close = jest.fn();
  mount(<InsertAnalysisResult record={semanticRecord()} onClose={close} />);
  expect(
    (
      screen.getByRole('button', {
        name: 'Insert',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await screen.findByRole('option', { name: 'Experimental report' });
  fireEvent.change(screen.getByLabelText('Document'), {
    target: {
      value: 'd',
    },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Insert',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Caption'), {
    target: {
      value: '<img onerror=evil()>',
    },
  });
  fireEvent.change(screen.getByLabelText('Insert position'), {
    target: {
      value: '0',
    },
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Insert',
    }),
  );
  await waitFor(() => expect(save).toHaveBeenCalled());
  const input = save.mock.calls[0]![2];
  expect(input.revision).toBe(3);
  expect(input.saveKind).toBe('MANUAL');
  expect(input.content.content?.[0]).toMatchObject({
    type: 'analysisResult',
    attrs: {
      reference,
      caption: '<img onerror=evil()>',
    },
  });
  expect(input.content.content).toHaveLength(3);
  await waitFor(() =>
    expect(screen.getByLabelText('Location').textContent).toContain(
      '/app/workspaces/w/documents/d#analysis-',
    ),
  );
  expect(close).toHaveBeenCalledTimes(1);
});
test('insertion leaves a conflicting save reviewable, reloads the revision and retains exact block identity', async () => {
  const save = jest
    .spyOn(documentApi, 'updateDocument')
    .mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        rawCode: 'CONFLICT',
        status: 409,
        code: 'CONFLICT',
        title: 'Conflict',
        detail: 'Reload the destination',
      }),
    )
    .mockResolvedValueOnce({
      ...doc,
      revision: 5,
    });
  mount(<InsertAnalysisResult record={semanticRecord()} onClose={jest.fn()} />);
  await screen.findByRole('option', { name: 'Experimental report' });
  fireEvent.change(screen.getByLabelText('Document'), {
    target: {
      value: 'd',
    },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Insert',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole('radio', {
      name: 'Table impedance-table',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Insert',
    }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('Could not insert');
  jest.mocked(documentApi.fetchDocument).mockResolvedValue({
    ...doc,
    revision: 4,
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reload destination',
    }),
  );
  await waitFor(() => expect(documentApi.fetchDocument).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Insert',
    }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![2].revision).toBe(4);
  const first = save.mock.calls[0]![2].content.content?.at(-1);
  expect(save.mock.calls[1]![2].content.content?.at(-1)).toEqual(first);
  expect(first?.attrs?.['reference']).toEqual({
    ...reference,
    outputId: 'impedance-table',
    renderMode: 'TABLE',
  });
});
test('insertion exposes unavailable and malformed destinations and allows cancel', async () => {
  jest.mocked(documentApi.fetchDocument).mockResolvedValue({
    ...doc,
    content: {
      type: 'unknown',
    },
  });
  const close = jest.fn();
  mount(<InsertAnalysisResult record={semanticRecord()} onClose={close} />);
  await screen.findByRole('option', { name: 'Experimental report' });
  fireEvent.change(screen.getByLabelText('Document'), {
    target: {
      value: 'd',
    },
  });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'cannot be opened safely',
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Cancel',
    }),
  );
  expect(close).toHaveBeenCalled();
});
test('AI evidence is explicitly scoped, deduplicated, removable and limited', async () => {
  function Scope() {
    const [value, setValue] = useState<readonly AnalysisEvidenceReference[]>([]);
    return (
      <AnalysisEvidencePicker
        workspaceId="w"
        value={value}
        onChange={setValue}
        disabled={false}
      />
    );
  }
  mount(<Scope />);
  expect(analysisApi.fetchAnalyses).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Choose computed output',
    }),
  );
  await pick();
  expect(
    screen.getByRole('button', {
      name: 'Remove output impedance-table',
    }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Choose computed output',
    }),
  );
  await pick();
  expect(
    screen.getAllByRole('button', {
      name: 'Remove output impedance-table',
    }),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Remove output impedance-table',
    }),
  );
  expect(screen.getByText('No computed outputs selected.')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Choose computed output',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Hide saved outputs',
    }),
  );
});
test('AI evidence cannot be expanded beyond six outputs or while disabled', () => {
  mount(
    <AnalysisEvidencePicker
      workspaceId="w"
      value={Array.from(
        {
          length: 6,
        },
        (_, i) => ({
          analysisId,
          executionId,
          outputId: `out-${i}`,
        }),
      )}
      onChange={jest.fn()}
      disabled={false}
    />,
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Choose computed output',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test('empty output and destination failures cannot be submitted even with a programmatic form event', async () => {
  jest.mocked(documentApi.fetchDocuments).mockRejectedValue(new Error('Unavailable'));
  const save = jest.spyOn(documentApi, 'updateDocument');
  const record = semanticRecord();
  record.execution.result = null;
  mount(<InsertAnalysisResult record={record} onClose={jest.fn()} />);
  await screen.findByText(/Could not load the destination/);
  expect(
    (screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  await screen.findByText(/Could not insert the result/);
  expect(save).not.toHaveBeenCalled();
});
test('summary insertion keeps saved TEXT metadata and prevents dismissing an in-flight save', async () => {
  let finish: ((doc: documentApi.WorkspaceDocument) => void) | undefined;
  const save = jest.spyOn(documentApi, 'updateDocument').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const close = jest.fn();
  const record = semanticRecord();
  record.execution.result!.outputs = [record.execution.result!.outputs[2]!];
  mount(<InsertAnalysisResult record={record} onClose={close} />);
  await screen.findByRole('option', { name: 'Experimental report' });
  fireEvent.change(screen.getByLabelText('Document'), { target: { value: 'd' } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('radio', { name: 'Summary notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(
    (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  expect(save.mock.calls[0]![2].content.content?.at(-1)?.attrs?.['reference']).toEqual({
    ...reference,
    outputId: 'notes',
    renderMode: 'SUMMARY',
  });
  finish?.({ ...doc, revision: 4 });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
test('archived destinations remain readable but cannot accept an insertion', async () => {
  jest
    .mocked(documentApi.fetchDocument)
    .mockResolvedValue({ ...doc, archivedAt: '2026-10-01' });
  mount(<InsertAnalysisResult record={semanticRecord()} onClose={jest.fn()} />);
  await screen.findByRole('option', { name: 'Experimental report' });
  fireEvent.change(screen.getByLabelText('Document'), { target: { value: 'd' } });
  await screen.findByLabelText('Insert position');
  expect(
    (screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
