/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { AiSuggestionCard } from './AiSuggestionCard';
import { ClaimEvidencePanel } from './ClaimEvidencePanel';
import type { AuthoringSuggestion } from '../api/authoringApi';
import type { Citation } from '../api/generationApi';

const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'source-v1',
  chunkId: 'a'.repeat(64),
  processingVersion: 'v1',
  contentHash: 'b'.repeat(64),
  pageStart: 3,
  pageEnd: 5,
  sectionTitle: 'Results',
  title: 'Study',
  spans: [{ unitId: 'p3', characterStart: 0, characterEnd: 20 }],
};
const proposal: AuthoringSuggestion = {
  id: 'proposal',
  workspaceId: 'w',
  documentId: 'd',
  createdBy: 'u',
  state: 'PENDING',
  command: {
    kind: 'REWRITE',
    expectedRevision: 1,
    placementBlock: null,
    from: 1,
    to: 7,
    action: 'SHORTEN',
    instruction: '',
    selectedSourceIds: [],
    lengthTarget: 300,
    stylePreset: 'ACADEMIC',
    citationRequired: false,
  },
  originalText: '<script>Claim</script>',
  generatedText: 'Shorter claim.',
  citations: [],
  candidates: [],
  warnings: ['Review this suggestion.'],
  generation: null,
  acceptedRevision: null,
};
const events = {
  onTextChange: jest.fn(),
  onAccept: jest.fn(),
  onReject: jest.fn(),
  onEdit: jest.fn(),
  onAddCitation: jest.fn(),
};
function shell(child: ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}
function rewrite(props: Partial<ComponentProps<typeof AiSuggestionCard>> = {}) {
  return shell(
    <AiSuggestionCard
      suggestion={proposal}
      text={proposal.generatedText}
      editing={false}
      blocked={false}
      frozen={false}
      busy={false}
      sourceTypes={new Map()}
      {...events}
      {...props}
    />,
  );
}
const candidates: AuthoringSuggestion['candidates'] = [
  {
    citation,
    snippet: 'Measured improvement.',
    category: 'supporting',
    relevance: 0.9,
    reason: 'Direct support.',
  },
  {
    citation: {
      ...citation,
      chunkId: 'c'.repeat(64),
      title: null,
      pageStart: null,
      pageEnd: null,
      sectionTitle: null,
    },
    snippet: 'Partial context.',
    category: 'related',
    relevance: 0.3,
    reason: '',
  },
  {
    citation: { ...citation, chunkId: 'd'.repeat(64), pageStart: null, pageEnd: null },
    snippet: 'Different setting.',
    category: 'insufficient',
    relevance: 0.1,
    reason: 'Does not support the claim.',
  },
];
function evidence(props: Partial<ComponentProps<typeof ClaimEvidencePanel>> = {}) {
  return shell(
    <ClaimEvidencePanel
      suggestion={{
        ...proposal,
        command: { ...proposal.command, kind: 'EVIDENCE' },
        candidates,
      }}
      blocked={false}
      busy={false}
      frozenChunkId={null}
      sourceTypes={new Map([['s', 'PDF']])}
      {...events}
      {...props}
    />,
  );
}
beforeEach(() => jest.clearAllMocks());
test('rewrite displays semantic diff, real provenance, safe text and explicit controls', () => {
  const { container, rerender } = render(rewrite());
  expect(container.querySelector('del')?.textContent).toBe(proposal.originalText);
  expect(container.querySelector('ins')?.textContent).toBe(proposal.generatedText);
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('Uses only your document text.')).toBeTruthy();
  for (const name of ['Accept', 'Reject', 'Edit'])
    fireEvent.click(screen.getByRole('button', { name }));
  expect(events.onAccept).toHaveBeenCalledTimes(1);
  expect(events.onReject).toHaveBeenCalledTimes(1);
  expect(events.onEdit).toHaveBeenCalledTimes(1);
  rerender(
    rewrite({
      suggestion: {
        ...proposal,
        citations: [citation],
        command: { ...proposal.command, action: 'EXPAND' },
      },
    }),
  );
  expect(screen.getByText('Uses your document text and 1 cited source.')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Study · Pages 3–5/ })).toBeTruthy();
  rerender(
    rewrite({
      suggestion: {
        ...proposal,
        citations: [citation, { ...citation, sourceId: 's2', chunkId: 'c' }],
        command: { ...proposal.command, action: null },
      },
    }),
  );
  expect(screen.getByText('Uses your document text and 2 cited sources.')).toBeTruthy();
  expect(screen.getByText(/Suggestion · Rewrite selection/)).toBeTruthy();
});
test('editing receives focus, only changes the review text, and freezes during approval retry', () => {
  const { rerender } = render(rewrite({ editing: true }));
  const input = screen.getByRole('textbox', { name: 'Edit suggestion' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Reviewed.' } });
  expect(events.onTextChange).toHaveBeenCalledWith('Reviewed.');
  expect(events.onAccept).not.toHaveBeenCalled();
  rerender(rewrite({ editing: true, frozen: true }));
  expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Reject' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Edit' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Retry acceptance' })).toHaveProperty(
    'disabled',
    false,
  );
  rerender(rewrite({ blocked: true, busy: true }));
  for (const name of ['Accept', 'Reject', 'Edit'])
    expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
});
test('empty replacement cannot be accepted and selected sources without citations are never called grounded', () => {
  render(
    rewrite({
      text: '',
      suggestion: {
        ...proposal,
        originalText: '',
        generatedText: '',
        command: { ...proposal.command, selectedSourceIds: ['s'] },
      },
    }),
  );
  expect(
    screen.getByText('Uses your document text; no source citations were returned.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Edit' })).toHaveProperty('disabled', true);
});
test('evidence cards use only returned metadata, keep the exact claim and open stored locations', () => {
  render(evidence());
  expect(screen.getByText(proposal.originalText)).toBeTruthy();
  const first = within(screen.getByRole('article', { name: 'Evidence 1' }));
  expect(first.getByText('Pages 3–5 · Results')).toBeTruthy();
  expect(first.getByText('Measured improvement.')).toBeTruthy();
  expect(first.getByText('Direct support.')).toBeTruthy();
  const open = first.getByRole('link', { name: 'Open' });
  expect(open.getAttribute('href')).toBe(
    '/app/workspaces/w/sources/s?processingVersion=v1&unit=p3&page=3',
  );
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toBe('noopener noreferrer');
  fireEvent.click(first.getByRole('button', { name: 'Add citation' }));
  expect(events.onAddCitation).toHaveBeenCalledWith(citation.chunkId);
  expect(screen.getByText('Source fragment')).toBeTruthy();
  expect(screen.getByText('Results')).toBeTruthy();
  expect(screen.getByText('Related / partial evidence')).toBeTruthy();
  expect(screen.queryByText(/90%|strength|contradictory/i)).toBeNull();
  expect(
    within(screen.getByRole('article', { name: 'Evidence 3' })).getByRole('button', {
      name: 'Add citation',
    }),
  ).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(events.onReject).toHaveBeenCalledTimes(1);
});
test('citation retry freezes other candidates and stale or unsaved revisions block insertion', () => {
  const { rerender } = render(evidence({ frozenChunkId: citation.chunkId }));
  expect(screen.getByRole('button', { name: 'Retry citation' })).toHaveProperty(
    'disabled',
    false,
  );
  expect(
    within(screen.getByRole('article', { name: 'Evidence 2' })).getByRole('button', {
      name: 'Add citation',
    }),
  ).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Reject' })).toHaveProperty('disabled', true);
  rerender(evidence({ blocked: true, busy: true }));
  for (const button of screen.getAllByRole('button', { name: 'Add citation' }))
    expect(button).toHaveProperty('disabled', true);
});
test('empty and insufficient evidence offer keeping the claim, without inventing candidates', () => {
  const empty = { ...proposal, candidates: [] };
  const { rerender } = render(evidence({ suggestion: empty }));
  expect(screen.getByText('No supporting evidence found.')).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Keep claim as it is' }));
  expect(events.onReject).toHaveBeenCalledTimes(1);
  expect(events.onAddCitation).not.toHaveBeenCalled();
  rerender(
    evidence({ suggestion: { ...proposal, candidates: [candidates[2]!] }, busy: true }),
  );
  expect(screen.getByRole('button', { name: 'Keep claim as it is' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(screen.getByRole('button', { name: 'Add citation' })).toHaveProperty(
    'disabled',
    true,
  );
});
