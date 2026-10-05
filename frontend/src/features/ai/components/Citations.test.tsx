/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  CitationReference,
  CitationPopover,
  CitationQuote,
  citationLocation,
  citationVariant,
} from './Citations';
import { fetchCitationFragment } from '../api/citationEvidence';
import type { Citation } from '../api/generationApi';
import { DocumentBodyEditor } from '../../documents/components/DocumentBodyEditor';
import { readStoredDocument } from '../../documents/api/documentContent';
import type { EditorCitation } from '../../documents/api/researchCitation';
import { ApiError } from '../../../shared/api';

jest.mock('../api/citationEvidence');
const fetchFragment = jest.mocked(fetchCitationFragment);
const citation: Citation = {
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'original-version',
  chunkId: 'a'.repeat(64),
  contentHash: 'b'.repeat(64),
  processingVersion: 'v1',
  pageStart: 7,
  pageEnd: 8,
  sectionTitle: null,
  title: '<img onerror=unsafe()>',
  spans: [{ unitId: 'page-7', characterStart: 0, characterEnd: 12 }],
};
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  fetchFragment.mockReset();
  fetchFragment.mockResolvedValue({
    ...citation,
    content: 'Original <script>quoted words</script>.',
  });
});
function renderWithClient(element: ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
    </QueryClientProvider>,
  );
}
it.each(['document', 'dataset', 'analysis'] as const)(
  'opens the %s citation by keyboard and restores focus on Escape',
  async (variant) => {
    const onInspect = jest.fn();
    renderWithClient(
      <CitationReference
        citation={citation}
        number="S1"
        variant={variant}
        onInspect={onInspect}
      />,
    );
    const trigger = screen.getByRole('link', { name: 'S1' });
    expect(trigger.className).toContain(variant);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: ' ' });
    const popup = screen.getByRole('dialog', { name: 'Citation S1' });
    expect(onInspect).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      within(popup).getByRole('button', { name: 'Close Citation S1' }),
    );
    expect(
      await within(popup).findByText('Original <script>quoted words</script>.'),
    ).toBeTruthy();
    expect(document.querySelector('img, script')).toBeNull();
    for (const name of ['Open source', 'View context'])
      expect(within(popup).getByRole('link', { name }).getAttribute('href')).toBe(
        '/app/workspaces/w/sources/s?processingVersion=v1&unit=page-7&page=7',
      );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  },
);
it('uses the same popover for a saved editor citation, keeping its tree and first-occurrence number unchanged', async () => {
  const metadata: EditorCitation = {
    ...citation,
    schemaVersion: '1.0',
    citationId: 'stable',
    displayStyle: 'NUMERIC',
  };
  const stored = readStoredDocument({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Human claim.' },
          { type: 'researchCitation', attrs: { citation: metadata } },
        ],
      },
    ],
  })!;
  const onChange = jest.fn(),
    onNavigate = jest.fn();
  renderWithClient(
    <DocumentBodyEditor
      initialContent={stored}
      sourceTypes={new Map([[citation.sourceId, 'CSV']])}
      editable={false}
      onChange={onChange}
      onOpenCitation={onNavigate}
      label="Document body"
    />,
  );
  const trigger = screen.getByRole('link', { name: '[1]' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const popup = screen.getByRole('dialog', { name: 'Citation 1' });
  expect(
    await within(popup).findByText('Original <script>quoted words</script>.'),
  ).toBeTruthy();
  expect(within(popup).getByText('<img onerror=unsafe()> · Pages 7–8')).toBeTruthy();
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(within(popup).getByRole('link', { name: 'View context' }));
  expect(onNavigate).toHaveBeenCalledWith(
    '/app/workspaces/w/sources/s?processingVersion=v1&unit=page-7&page=7',
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger.textContent).toBe(' [1]');
  expect(trigger.getAttribute('data-citation-variant')).toBe('dataset');
  expect(JSON.parse(trigger.getAttribute('data-citation')!)).toEqual(metadata);
});
it('supports legacy source-level citations and an existing quote without inventing missing metadata', () => {
  renderWithClient(
    <>
      <CitationQuote citation={{ ...citation, chunkId: null }} />
      <CitationReference
        citation={{
          ...citation,
          chunkId: undefined,
          title: null,
          pageStart: null,
          pageEnd: null,
          sectionTitle: 'Methods',
        }}
        number={2}
        quote="Existing evidence snippet"
      />
    </>,
  );
  expect(
    screen.getByText('No quoted passage is available for this citation.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: '2' }));
  const popup = screen.getByRole('dialog', { name: 'Citation 2' });
  expect(within(popup).getByText('Methods')).toBeTruthy();
  expect(within(popup).getByText('Source · Methods')).toBeTruthy();
  expect(within(popup).getByText('Existing evidence snippet')).toBeTruthy();
  expect(fetchFragment).not.toHaveBeenCalled();
  fireEvent.click(within(popup).getByRole('button', { name: 'Close Citation 2' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('never displays a stale quote after the pinned retrieval endpoint rejects access', async () => {
  let reject!: (error: Error) => void;
  fetchFragment.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  renderWithClient(<CitationReference citation={citation} number={1} />);
  fireEvent.click(screen.getByRole('link', { name: '1' }));
  expect(screen.getByRole('status').textContent).toBe('Loading cited passage…');
  await act(async () =>
    reject(
      new ApiError({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'RESOURCE_NOT_FOUND',
        rawCode: 'ACCESS_DENIED',
        detail: 'Access denied',
      }),
    ),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('Access denied');
  expect(screen.queryByText('Original <script>quoted words</script>.')).toBeNull();
});
it('uses native links when there is no route callback and supports unknown source locations', () => {
  function Preview(): ReactElement {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <button onClick={(event) => setAnchor(event.currentTarget)}>Preview</button>
        {anchor ? (
          <CitationPopover
            anchor={anchor}
            citation={{
              ...citation,
              chunkId: null,
              title: null,
              pageStart: null,
              pageEnd: null,
              sectionTitle: null,
              spans: [],
            }}
            number={3}
            onClose={() => setAnchor(null)}
          />
        ) : null}
      </>
    );
  }
  renderWithClient(<Preview />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByText('Source · Source fragment')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: 'Open source' }).getAttribute('href'),
  ).toContain('processingVersion=v1');
  fireEvent.click(screen.getByRole('link', { name: 'Open source' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(citationLocation({ ...citation, pageEnd: 7 })).toBe('Page 7');
  expect(citationVariant('CSV')).toBe('dataset');
  expect(citationVariant('XLSX')).toBe('dataset');
  expect(citationVariant('FUTURE')).toBe('document');
});
