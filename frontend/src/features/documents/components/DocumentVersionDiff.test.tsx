/** @jest-environment jsdom */
import type { JSONContent } from '@tiptap/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocumentVersionDiff } from './DocumentVersionDiff';
import type { ProseMirrorDocument } from '../api/documentContent';
import { DocumentViewerNotice } from './DocumentViewerNotice';
const p = (value: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
});
const doc = (...content: JSONContent[]): ProseMirrorDocument => ({
  type: 'doc',
  content,
});
it('shows explicit equality, legends and a close action without any editor controls', () => {
  const close = jest.fn();
  render(
    <DocumentVersionDiff
      selected={doc(p('Same'))}
      current={doc(p('Same'))}
      selectedRevision={1}
      currentRevision={3}
      title="Report"
      onClose={close}
    />,
  );
  expect(screen.getByText('Previewing v1, compared with current (v3)')).not.toBeNull();
  expect(screen.getByText(/No differences/)).not.toBeNull();
  expect(screen.getByText('Added')).not.toBeNull();
  expect(screen.getByText('Removed')).not.toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('toolbar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close version preview' }));
  expect(close).toHaveBeenCalledTimes(1);
});
it('renders semantic paragraphs, lists, tables, quotes, figures, marks and citations safely', () => {
  const citation = {
    type: 'researchCitation',
    attrs: { citation: { title: 'Paper', label: '[1]', sourceVersionId: 'pinned' } },
  };
  const current = doc(
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [
        {
          type: 'text',
          text: 'Results',
          marks: [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'code' },
            { type: 'strike' },
          ],
        },
      ],
    },
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('Bullet')] }] },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [{ type: 'listItem', content: [p('Third')] }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: { colspan: 2, rowspan: 1 },
              content: [p('Header')],
            },
            { type: 'tableCell', content: [p('Value')] },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [p('Quote')] },
    { type: 'codeBlock', content: [{ type: 'text', text: '<script>unsafe()</script>' }] },
    {
      type: 'figure',
      content: [
        p('Figure'),
        { type: 'figureCaption', content: [{ type: 'text', text: 'Caption' }, citation] },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Line' },
        { type: 'hardBreak' },
        citation,
        { ...citation, attrs: { citation: { title: null } } },
        { ...citation, attrs: { citation: { title: 'Title only' } } },
      ],
    },
    { type: 'horizontalRule' },
  );
  const snapshot = JSON.stringify(current);
  const { container } = render(
    <DocumentVersionDiff
      selected={doc(p('Old'))}
      current={current}
      selectedRevision={1}
      currentRevision={2}
      title="Report"
      onClose={jest.fn()}
    />,
  );
  const region = screen.getByRole('region', { name: 'Version differences' });
  expect(region.querySelector('del')?.textContent).toBe('Old');
  expect(region.querySelector('ins')).not.toBeNull();
  expect(region.querySelector('ol')?.getAttribute('start')).toBe('3');
  expect(region.querySelector('th')?.getAttribute('colspan')).toBe('2');
  expect(region.querySelector('td')?.textContent).toBe('Value');
  expect(region.querySelector('figcaption')?.textContent).toContain('Caption');
  expect(region.querySelector('.citation')?.getAttribute('title')).toBe('Paper');
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<script>unsafe()</script>');
  expect(JSON.stringify(current)).toBe(snapshot);
});
it('offers the viewer chip, information and dismissible toast without requiring a global provider', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { unmount } = render(<DocumentViewerNotice statusHost={host} />);
  expect(host.textContent).toBe('Read-only');
  expect(
    screen.getByText('You’re a viewer in this workspace.').closest('[role="status"]')
      ?.textContent,
  ).toContain('Only editors can change the document.');
  expect(screen.getByRole('region', { name: 'Notifications' }).textContent).toContain(
    'Only editors can change this document',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss Only editors can change this document' }),
  );
  expect(screen.queryByText('Only editors can change this document')).toBeNull();
  unmount();
  host.remove();
  render(<DocumentViewerNotice />);
  expect(screen.getByText('Read-only')).not.toBeNull();
});
it('shows a changed semantic execution reference as inert version metadata', () => {
  const ref = {
    analysisId: '11111111-1111-4111-8111-111111111111',
    executionId: '22222222-2222-4222-8222-222222222222',
    outputId: 'plot',
    renderMode: 'CHART',
  };
  const block = {
    type: 'analysisResult',
    attrs: {
      blockId: '44444444-4444-4444-8444-444444444444',
      reference: ref,
      caption: '',
    },
  };
  render(
    <DocumentVersionDiff
      selected={doc(block)}
      current={doc({
        ...block,
        attrs: {
          ...block.attrs,
          caption: '<script>inert caption</script>',
          reference: { ...ref, executionId: '33333333-3333-4333-8333-333333333333' },
        },
      })}
      selectedRevision={1}
      currentRevision={2}
      title="Report"
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText(/22222222/)).toBeTruthy();
  expect(screen.getByText(/33333333/)).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});
