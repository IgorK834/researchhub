/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import {
  Card,
  Panel,
  DashedNote,
  IconTile,
  ListRow,
  DataTable,
  EmptyState,
  Keycap,
  KeyboardHintBar,
  emptyStateCopy,
  searchEmptyStateCopy,
} from './index';

it('composes native cards and labelled panels with optional header and footer slots', () => {
  const click = jest.fn();
  const { rerender } = render(
    <Card className="consumer" data-testid="card" onClick={click}>
      A real object
    </Card>,
  );
  fireEvent.click(screen.getByTestId('card'));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('card').classList.contains('consumer')).toBe(true);
  rerender(
    <Panel
      title="Provenance"
      header={<button>Inspect</button>}
      footer={<a href="/chain">Full chain</a>}
    >
      Source and version
    </Panel>,
  );
  const panel = screen.getByRole('region', { name: 'Provenance' });
  expect(within(panel).getByRole('heading', { name: 'Provenance' }).tagName).toBe('H2');
  expect(within(panel).getByRole('button', { name: 'Inspect' })).toBeTruthy();
  expect(panel.querySelector('footer a')?.getAttribute('href')).toBe('/chain');
  rerender(
    <Panel title="Notes" className="custom">
      Known notes
    </Panel>,
  );
  expect(
    screen.getByRole('region', { name: 'Notes' }).querySelector('footer'),
  ).toBeNull();
  rerender(<Card>Plain card</Card>);
  expect(screen.getByText('Plain card').classList.contains('card')).toBe(true);
});

it('provides quiet dashed notes and decorative, token-colored icon tiles at all sizes', () => {
  const { rerender } = render(<DashedNote>Nothing is deleted.</DashedNote>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen
      .getByText('Nothing is deleted.')
      .parentElement?.querySelector('svg')
      ?.getAttribute('aria-hidden'),
  ).toBe('true');
  rerender(<DashedNote icon="shield">Source and version are kept.</DashedNote>);
  for (const tone of ['blue', 'coral', 'mint', 'yellow', 'lavender'] as const) {
    for (const size of ['small', 'default', 'large'] as const) {
      rerender(<IconTile icon="book" tone={tone} size={size} />);
      const tile = document.querySelector('.tile')!;
      expect(tile.classList.contains(size)).toBe(true);
      expect(tile.classList.contains(tone)).toBe(true);
      expect(tile.getAttribute('aria-hidden')).toBe('true');
    }
  }
  rerender(<IconTile icon="file" fill="base" />);
  expect(document.querySelector('.tile')?.classList.contains('tileBase')).toBe(true);
  expect(document.querySelector('.tile')?.classList.contains('blue')).toBe(true);
});

it('keeps list row links separate from trailing chips and keyboard-reachable hover actions', () => {
  const action = jest.fn();
  const { rerender } = render(
    <ul>
      <ListRow
        title={<a href="/document">Laboratory Report</a>}
        meta="Adam · today"
        leading={<IconTile icon="file" tone="coral" />}
        trailing={<span>Draft</span>}
        actions={<button onClick={action}>Archive report</button>}
        selected
        className="custom"
      />
    </ul>,
  );
  expect(screen.getByRole('listitem').getAttribute('data-selected')).toBe('true');
  expect(
    screen.getByRole('link', { name: 'Laboratory Report' }).querySelector('button'),
  ).toBeNull();
  expect(screen.getByText('(selected)')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Archive report' });
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(action).toHaveBeenCalledTimes(1);
  rerender(
    <ul>
      <ListRow title="Source" />
    </ul>,
  );
  expect(screen.getByRole('listitem').hasAttribute('data-selected')).toBe(false);
  expect(document.querySelector('.rowActions')).toBeNull();
});

it('retains table, caption, column and row headers, named scrolling and selection words', () => {
  const rows = [
    { id: 'one', title: 'First', value: 2 },
    { id: 'two', title: 'Second', value: 3 },
  ];
  const columns = [
    {
      id: 'name',
      header: 'Document',
      rowHeader: true,
      render: (row: (typeof rows)[number]) => row.title,
    },
    {
      id: 'value',
      header: 'Citations',
      render: (row: (typeof rows)[number]) => row.value,
    },
  ];
  const { rerender } = render(
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      caption="Document library"
      isSelected={(row) => row.id === 'two'}
      footer={<span>2 documents</span>}
    />,
  );
  const region = screen.getByRole('region', { name: 'Document library table' });
  expect(region.tabIndex).toBe(0);
  const table = within(region).getByRole('table', { name: 'Document library' });
  expect(table.tagName).toBe('TABLE');
  expect(table.querySelector('caption')?.textContent).toBe('Document library');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .every((cell) => cell.getAttribute('scope') === 'col'),
  ).toBe(true);
  expect(
    within(table)
      .getAllByRole('rowheader')
      .every((cell) => cell.getAttribute('scope') === 'row'),
  ).toBe(true);
  expect(
    within(table)
      .getByRole('row', { name: /Second/ })
      .getAttribute('data-selected'),
  ).toBe('true');
  expect(screen.getByText('2 documents').closest('table')).toBeNull();
  rerender(
    <DataTable
      rows={[]}
      rowKey={(row: (typeof rows)[number]) => row.id}
      columns={columns}
      label="Measurements"
      scrollLabel="Sample rows"
      caption="No rows"
    />,
  );
  expect(screen.getByRole('region', { name: 'Sample rows' })).toBeTruthy();
  expect(
    screen.getByRole('table', { name: 'Measurements' }).querySelector('tbody')?.children,
  ).toHaveLength(0);
  expect(document.querySelector('.tableFooter')).toBeNull();
});

it('rejects a table without accessible column headers', () => {
  expect(() =>
    render(<DataTable rows={[]} rowKey={() => 'id'} columns={[]} caption="Empty" />),
  ).toThrow('at least one column');
});

it('expresses all six design empty states without feature markup, with at most two actions', () => {
  const copy = [
    ...Object.values(emptyStateCopy),
    searchEmptyStateCopy('thermal drift', { sources: 12, documents: 3, analyses: 17 }),
  ];
  const { rerender } = render(<EmptyState {...copy[0]!} />);
  for (const state of copy) {
    rerender(
      <EmptyState
        {...state}
        art={<span>Optional art</span>}
        tone="coral"
        actions={[
          <button key="first">Next step</button>,
          <button key="second">Alternative</button>,
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: state.title });
    expect(within(region).getByText(state.description)).toBeTruthy();
    expect(within(region).getAllByRole('button')).toHaveLength(2);
    expect(
      screen.getByText('Optional art').parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
  }
  rerender(
    <EmptyState
      title="Nothing written yet"
      description="Start a report."
      headingLevel="h3"
      actions={[<button key="one">Create first document</button>]}
    />,
  );
  expect(screen.getByRole('heading').tagName).toBe('H3');
  expect(document.querySelector('.context')).toBeNull();
  expect(document.querySelector('.art')).toBeNull();
});

it('rejects more than two empty-state actions supplied by untyped consumers', () => {
  const actions = [
    <button key="1">One</button>,
    <button key="2">Two</button>,
    <button key="3">Three</button>,
  ] as unknown as readonly [ReactElement, ReactElement];
  expect(() =>
    render(<EmptyState title="Empty" description="Next step." actions={actions} />),
  ).toThrow('at most two actions');
});

it('shows semantic keycaps and a labelled keyboard hint list without registering shortcuts', () => {
  const { rerender } = render(
    <Keycap title="Escape" className="custom">
      Esc
    </Keycap>,
  );
  expect(screen.getByText('Esc').tagName).toBe('KBD');
  expect(screen.getByTitle('Escape').classList.contains('custom')).toBe(true);
  rerender(
    <KeyboardHintBar
      hints={[
        { keys: ['↑', '↓'], label: 'Move' },
        { keys: ['↵'], label: 'Open' },
      ]}
    />,
  );
  expect(
    screen.getByRole('list', { name: 'Keyboard shortcuts' }).querySelectorAll('kbd'),
  ).toHaveLength(3);
  rerender(<KeyboardHintBar hints={[]} label="Search shortcuts" />);
  expect(screen.getByRole('list', { name: 'Search shortcuts' }).children).toHaveLength(0);
});
