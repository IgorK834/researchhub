/** @jest-environment jsdom */
import { getSchema, Editor } from '@tiptap/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  documentExtensions,
  readStoredDocument,
  savedDocumentOf,
} from '../api/documentContent';
import { documentNavigation } from '../api/documentNavigation';
import { DocumentOutline, ContentOriginLegend } from './DocumentOutline';
import { DocumentSources } from './DocumentSources';
import type { EditorCitation } from '../api/researchCitation';

const citation: EditorCitation = {
  contentHash: 'a'.repeat(64),
  workspaceId: 'w',
  sourceId: 's',
  sourceVersionId: 'version-old',
  processingVersion: 'v1',
  pageStart: 7,
  pageEnd: 7,
  sectionTitle: null,
  spans: [],
  title: 'Original paper',
  displayStyle: 'NUMERIC',
};
const schema = getSchema(documentExtensions);
const heading = (title: string, level = 2) => ({
  type: 'heading',
  attrs: { level },
  content: title ? [{ type: 'text', text: title }] : [],
});
const sources = [
  { id: 's', title: 'Current paper', href: '/sources/s' },
  { id: 'other', title: 'Lab notes', href: '/sources/other' },
];
const references = [{ number: 1, citation, citationId: 'reference' }];

it('derives heading depth, duplicate headings and active section without changing the stored tree', () => {
  const content = {
    type: 'doc',
    content: [
      heading('Method'),
      heading('Method', 3),
      heading('', 1),
      {
        type: 'paragraph',
        content: [
          { type: 'researchCitation', attrs: { citation } },
          { type: 'researchCitation', attrs: { citation } },
        ],
      },
    ],
  };
  const doc = schema.nodeFromJSON(content);
  const before = doc.toJSON();
  const navigation = documentNavigation(doc, doc.content.size);
  expect(navigation.headings.map((item) => [item.title, item.level])).toEqual([
    ['Method', 2],
    ['Method', 3],
    ['Untitled section', 1],
  ]);
  expect(navigation.activePosition).toBe(navigation.headings.at(-1)?.position);
  expect(navigation.references).toHaveLength(1);
  expect(doc.toJSON()).toEqual(before);
  expect(
    documentNavigation(
      schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] }),
      0,
    ).activePosition,
  ).toBeNull();
});

it('navigates outline positions, marks the current section and shows a static origin legend', () => {
  const navigation = documentNavigation(
    schema.nodeFromJSON({
      type: 'doc',
      content: [heading('Method'), heading('Results')],
    }),
    1,
  );
  const navigate = jest.fn();
  render(
    <>
      <DocumentOutline navigation={navigation} onNavigate={navigate} />
      <ContentOriginLegend />
    </>,
  );
  expect(
    screen.getByRole('button', { name: 'Method' }).getAttribute('aria-current'),
  ).toBe('location');
  fireEvent.click(screen.getByRole('button', { name: 'Results' }));
  expect(navigate).toHaveBeenCalledWith(navigation.headings[1]?.position);
  expect(screen.getByRole('region', { name: 'Content origin' }).textContent).toContain(
    'Human written',
  );
});

it('shows an outline hint when no headings exist', () => {
  render(
    <DocumentOutline
      navigation={{ headings: [], references: [], activePosition: null }}
      onNavigate={jest.fn()}
    />,
  );
  expect(screen.getByText('Add headings to build an outline.')).toBeTruthy();
});

it('separates cited sources from uncited summaries and keeps version-pinned citation links', () => {
  const path = jest.fn(() => '/sources/s?version=version-old&page=7');
  render(
    <MemoryRouter>
      <DocumentSources
        sources={sources}
        references={references}
        citationHref={path}
        loading={false}
        error={null}
      />
    </MemoryRouter>,
  );
  const cited = screen.getByRole('region', {
    name: 'Cited in this document (1 source)',
  });
  expect(
    within(cited).getByRole('link', { name: 'Original paper' }).getAttribute('href'),
  ).toBe('/sources/s?version=version-old&page=7');
  expect(within(cited).getByText('p. 7')).toBeTruthy();
  const uncited = screen.getByRole('region', { name: 'In the workspace, not cited' });
  expect(within(uncited).queryByText('Current paper')).toBeNull();
  expect(within(uncited).getByRole('link', { name: 'Lab notes' })).toBeTruthy();
});

it('handles missing legacy labels, section locators, source failures and empty source lists', () => {
  const old = {
    ...citation,
    title: null,
    pageStart: null,
    pageEnd: null,
    sectionTitle: 'Methods',
  };
  const props = {
    sources: [],
    references: [{ ...references[0]!, citation: old }],
    citationHref: () => '/s',
    loading: true,
    error: null,
  };
  const view = render(
    <MemoryRouter>
      <DocumentSources {...props} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status').textContent).toBe('Loading sources…');
  expect(screen.getByText('Methods')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Source' })).toBeTruthy();
  view.rerender(
    <MemoryRouter>
      <DocumentSources {...props} loading={false} error="Sources unavailable" />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert').textContent).toBe('Sources unavailable');
  view.rerender(
    <MemoryRouter>
      <DocumentSources {...props} loading={false} references={[]} />
    </MemoryRouter>,
  );
  expect(screen.getByText('No sources cited yet.')).toBeTruthy();
  expect(screen.getByText('No uncited sources.')).toBeTruthy();
  view.rerender(
    <MemoryRouter>
      <DocumentSources
        {...props}
        loading={false}
        sources={sources}
        references={[{ ...references[0]!, citation: { ...old, sectionTitle: null } }]}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Current paper' })).toBeTruthy();
  expect(screen.getByText('Source reference')).toBeTruthy();
});

it('round-trips a figure, caption and citation as JSON and renders semantic figure HTML', () => {
  const stored = {
    type: 'doc',
    content: [
      {
        type: 'figure',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Figure content' }] },
          {
            type: 'figureCaption',
            content: [
              { type: 'text', text: 'Figure 1. Measurements ' },
              { type: 'researchCitation', attrs: { citation } },
            ],
          },
        ],
      },
      { type: 'paragraph' },
    ],
  };
  expect(readStoredDocument(stored)).toEqual(stored);
  const editor = new Editor({ extensions: documentExtensions, content: stored });
  expect(savedDocumentOf(editor)).toEqual(stored);
  expect(editor.getHTML()).toContain('<figure>');
  expect(editor.getHTML()).toContain('<figcaption>');
  expect(documentNavigation(editor.state.doc, 1).references).toHaveLength(1);
  editor.commands.setContent(
    '<figure><p>Data</p><figcaption>Figure 2</figcaption></figure>',
  );
  expect(editor.getJSON().content?.[0]?.type).toBe('figure');
  expect(editor.getJSON().content?.[0]?.content?.[1]?.type).toBe('figureCaption');
  editor.destroy();
});

it('groups multiple citation entities for a source while keeping each immutable locator accessible', () => {
  const second = {
    number: 2,
    citationId: 'second',
    citation: { ...citation, sourceVersionId: 'version-new', pageStart: 14, pageEnd: 14 },
  };
  render(
    <MemoryRouter>
      <DocumentSources
        sources={sources}
        references={[references[0]!, second]}
        citationHref={(c) => `/s?version=${c.sourceVersionId}&page=${c.pageStart}`}
        loading={false}
        error={null}
      />
    </MemoryRouter>,
  );
  const cited = screen.getByRole('region', { name: 'Cited in this document (1 source)' });
  expect(within(cited).getAllByRole('listitem')).toHaveLength(1);
  expect(
    within(cited).getByRole('link', { name: 'Citation 1' }).getAttribute('href'),
  ).toBe('/s?version=version-old&page=7');
  expect(
    within(cited).getByRole('link', { name: 'Citation 2' }).getAttribute('href'),
  ).toBe('/s?version=version-new&page=14');
});
