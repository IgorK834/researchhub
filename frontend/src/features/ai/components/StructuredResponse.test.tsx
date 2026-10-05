/** @jest-environment jsdom */
import { render as renderView, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { GeneratedResponse } from '../api/generationApi';
import { StructuredResponse } from './StructuredResponse';

jest.mock('../api/citationEvidence', () => ({
  fetchCitationFragment: async (citation: unknown) => ({
    ...(citation as object),
    content: 'Stored cited passage',
  }),
}));
const response: GeneratedResponse = {
  result: {
    schemaVersion: '1.0',
    requestId: 'r1',
    templateId: 'grounded-response:1',
    templateHash: 'hash',
    providerRequestId: 'p1',
    model: {
      provider: 'deterministic',
      name: 'extractive-fixture',
      version: '1',
      structuredOutput: true,
      streaming: false,
    },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimated: true },
    answer: {
      status: 'SUPPORTED',
      claims: [{ text: '<script>unsafe()</script>', evidenceIds: ['c1'] }],
    },
  },
  evidence: [
    {
      workspaceId: 'w1',
      sourceId: 's1',
      sourceVersionId: null,
      chunkId: 'c1',
      processingVersion: 'v1',
      contentHash: 'hash',
      pageStart: 2,
      pageEnd: 2,
      sectionTitle: 'Theory',
      spans: [{ unitId: 'u2', characterStart: 0, characterEnd: 10 }],
    },
  ],
};
it('renders escaped claims with versioned citations and model/usage metadata', () => {
  render(<StructuredResponse response={response} />);
  expect(screen.getByText('<script>unsafe()</script>')).not.toBeNull();
  expect(document.querySelector('script')).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Theory · Page 2' }).getAttribute('href'),
  ).toContain('processingVersion=v1&unit=u2&page=2');
  expect(
    screen.getByText('Model: extractive-fixture (1) · deterministic'),
  ).not.toBeNull();
  expect(screen.getByText('Estimated tokens: 15 · Input: 10 · Output: 5')).not.toBeNull();
});
it('renders an insufficiency result without implying an answer exists', () => {
  render(
    <StructuredResponse
      response={{
        ...response,
        result: {
          ...response.result,
          answer: { status: 'INSUFFICIENT_EVIDENCE', claims: [] },
          usage: { ...response.result.usage, estimated: false },
        },
      }}
    />,
  );
  expect(
    screen.getByText('There is insufficient evidence to answer this request.'),
  ).not.toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('Tokens: 15 · Input: 10 · Output: 5')).not.toBeNull();
});
it('handles non-page sources and fails visibly when a citation cannot resolve', () => {
  render(
    <StructuredResponse
      response={{
        ...response,
        result: {
          ...response.result,
          answer: {
            status: 'SUPPORTED',
            claims: [{ text: 'Fact', evidenceIds: ['c1', 'missing'] }],
          },
        },
        evidence: [{ ...response.evidence[0]!, sectionTitle: null, pageStart: null }],
      }}
    />,
  );
  expect(screen.getByRole('link', { name: 'Source' })).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('unavailable');
});

it('renders local citation keys with escaped source titles while retaining the source/version link', () => {
  render(
    <StructuredResponse
      response={{
        ...response,
        context: {
          builderVersion: '1.0',
          tokenPolicy: 'utf8-conservative-v1',
          contextHash: 'hash',
          contextBytes: 300,
          tokenUpperBound: 4000,
          budget: { maxTokens: 32768, maxBytes: 24576, collapseExactDuplicates: true },
          citations: [{ citationKey: 'S1', chunkId: 'c1', textReference: null }],
        },
        evidence: [{ ...response.evidence[0]!, title: '<img src=x onerror=attack()>' }],
      }}
    />,
  );
  expect(
    screen
      .getByRole('link', { name: '[S1] <img src=x onerror=attack()> · Page 2' })
      .getAttribute('href'),
  ).toContain('/sources/s1?processingVersion=v1');
  expect(document.querySelector('img')).toBeNull();
});

function render(element: ReactElement) {
  return renderView(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
    </QueryClientProvider>,
  );
}
