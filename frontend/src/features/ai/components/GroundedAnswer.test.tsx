/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnswerState, GroundedAnswer } from './GroundedAnswer';
import { ResearchAnswer } from './ResearchEvidence';
import { fetchCitationFragment } from '../api/citationEvidence';
import type { QuestionResponse } from '../api/questionApi';
import fixture from '../../../../../contracts/ai/questions/v1/response.json';

jest.mock('../api/citationEvidence');
const response = fixture as QuestionResponse;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  jest.mocked(fetchCitationFragment).mockImplementation(async (citation) => ({
    ...citation,
    content: 'Only words from the source.',
  }));
});
it('renders thinking, streaming and failure with working Stop and Try again actions', () => {
  const onStop = jest.fn(),
    onRetry = jest.fn();
  const view = render(<AnswerState state="thinking" message="Searching sources…" />);
  expect(screen.getByRole('status').textContent).toBe('Searching sources…');
  expect(screen.queryByLabelText('Answer preview')).toBeNull();
  view.rerender(
    <AnswerState
      state="streaming"
      message="Answering…"
      preview="Partial text without invented citations"
      onStop={onStop}
    />,
  );
  expect(screen.getByLabelText('Answer preview').textContent).toBe(
    'Partial text without invented citations',
  );
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(onStop).toHaveBeenCalledTimes(1);
  view.rerender(
    <AnswerState state="failed" message="Connection interrupted" onRetry={onRetry} />,
  );
  expect(screen.getByRole('alert').textContent).toBe('Connection interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
it.each([
  ['NO_RETRIEVED_EVIDENCE', 'No evidence was retrieved from the selected sources.'],
  [
    'INSUFFICIENT_RETRIEVED_EVIDENCE',
    'The retrieved evidence is insufficient to answer this question.',
  ],
] as const)(
  'always shows the %s reason and the existing answer explanation',
  (reason, explanation) => {
    render(
      <GroundedAnswer
        status="INSUFFICIENT_EVIDENCE"
        reason={reason}
        answer="The available excerpts do not establish the requested claim."
        generation={null}
        evidence={[]}
      />,
    );
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(
      screen.getByText('The available excerpts do not establish the requested claim.'),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Evidence' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  },
);
it('retains a dataset source type when inspecting structured support and uses the common popover', async () => {
  const citation = response.citations[0]!;
  const onInspect = jest.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ResearchAnswer
        response={response}
        sources={{
          sources: [
            {
              id: citation.sourceId,
              title: citation.title ?? 'Dataset',
              ready: true,
              status: 'READY',
              sourceType: 'CSV',
            },
          ],
          loading: false,
          error: null,
        }}
        selected={{ citation, label: 'S1', sourceType: 'CSV' }}
        onInspect={onInspect}
        sourceView={false}
        onAskAll={jest.fn()}
        disabled={false}
      />
    </QueryClientProvider>,
  );
  const chip = screen.getByRole('button', { name: 'Show support for claim 1, S1' });
  expect(chip.className).toContain('dataset');
  fireEvent.click(chip);
  expect(onInspect).toHaveBeenCalledWith({ citation, label: 'S1', sourceType: 'CSV' });
  expect(
    await within(screen.getByRole('dialog', { name: 'Citation S1' })).findByText(
      'Only words from the source.',
    ),
  ).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(
    screen.getByRole('link', { name: 'Inspect citation S1' }).getAttribute('href'),
  ).toContain('page=38');
});
