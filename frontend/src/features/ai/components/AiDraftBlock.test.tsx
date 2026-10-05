/** @jest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AiDraftBlock } from './AiDraftBlock';
import type { Citation } from '../api/generationApi';

const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: null,
  chunkId: 'a'.repeat(64),
  processingVersion: 'v1',
  contentHash: 'b'.repeat(64),
  pageStart: null,
  pageEnd: null,
  sectionTitle: null,
  title: null,
  spans: [],
};
const onInsert = jest.fn(),
  onRegenerate = jest.fn(),
  onDiscard = jest.fn();
const base = {
  suggestion: {
    generatedText: 'Grounded draft.',
    citations: [citation],
    warnings: ['Review source support.'],
  },
  sources: [{ id: 's', sourceType: 'PDF' }],
  busy: false,
  blocked: false,
  retry: false,
  onInsert,
  onRegenerate,
  onDiscard,
};
beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);
test('source count comes from distinct cited sources, with versioned reference locations', () => {
  render(
    <MemoryRouter>
      <AiDraftBlock
        {...base}
        suggestion={{
          ...base.suggestion,
          citations: [
            citation,
            {
              ...citation,
              chunkId: 'c'.repeat(64),
              spans: [{ unitId: 'unit-3', characterStart: 0, characterEnd: 20 }],
            },
            {
              ...citation,
              sourceId: 'another',
              chunkId: 'd'.repeat(64),
              title: 'Notes',
              sectionTitle: 'Method',
            },
          ],
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('Grounded in 2 sources')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Source — location' }).getAttribute('href'),
  ).toContain('processingVersion=v1');
  expect(screen.getByRole('link', { name: 'Source — unit-3' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Notes — Method' })).toBeTruthy();
  expect(screen.getByText('Review source support.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Insert draft' }));
  expect(onInsert).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Insert and edit' }));
  expect(onInsert).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  expect(onRegenerate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(onDiscard).toHaveBeenCalledTimes(1);
});
test('interrupted approval permits the same retry and blocks other actions', () => {
  render(
    <MemoryRouter>
      <AiDraftBlock {...base} retry />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry acceptance' }));
  expect(onInsert).toHaveBeenCalledWith(false);
  for (const name of ['Insert and edit', 'Regenerate', 'Discard'])
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(
      true,
    );
});
test.each([
  { generatedText: '', citations: [citation] },
  { generatedText: 'Unsupported text', citations: [] },
])('incomplete or ungrounded results cannot be inserted: %j', (suggestion) => {
  render(
    <MemoryRouter>
      <AiDraftBlock {...base} suggestion={{ ...suggestion, warnings: [] }} busy blocked />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status').textContent).toContain('Insufficient evidence');
  for (const button of screen.getAllByRole('button'))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Unsupported text')).toBeNull();
});
