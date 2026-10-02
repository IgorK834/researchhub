/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { desktopMedia } from '../../testing/desktopMedia';
import { DataTable } from './Content';
import { visibleTableColumns } from './tableColumns';
import { ResponsiveFilters } from './ResponsiveFilters';

const columns = [
  { id: 'name', header: 'Name', rowHeader: true, render: (row: string) => row },
  {
    id: 'uploader',
    header: 'Uploaded by',
    priority: 'metadata' as const,
    render: () => 'Ada',
  },
  { id: 'date', header: 'Date', priority: 'metadata' as const, render: () => 'Today' },
  {
    id: 'actions',
    header: 'Actions',
    priority: 'essential' as const,
    render: () => <button>Open</button>,
  },
];
it('drops explicit metadata columns first, irrespective of their language or position', () => {
  expect(visibleTableColumns(columns, false)).toBe(columns);
  expect(visibleTableColumns(columns, true).map((column) => column.id)).toEqual([
    'name',
    'actions',
  ]);
  expect(
    visibleTableColumns([{ priority: 'metadata' }, {}, { priority: 'essential' }], true),
  ).toEqual([{}, { priority: 'essential' }]);
});
it('updates headers and matching cells together while preserving native table and row-header semantics', () => {
  const media = desktopMedia();
  try {
    render(
      <DataTable
        columns={columns}
        rows={['Paper']}
        rowKey={(row) => row}
        caption="Sources"
        isSelected={() => true}
      />,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    act(() => media.resize(true));
    expect(screen.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      'Name',
      'Actions',
    ]);
    expect(screen.getByRole('rowheader').getAttribute('scope')).toBe('row');
    expect(screen.getByRole('rowheader').textContent).toContain('(selected)');
    expect(screen.queryByText('Ada')).toBeNull();
    expect(screen.getByRole('table').tagName).toBe('TABLE');
    act(() => media.resize(false));
    expect(screen.getByRole('columnheader', { name: 'Uploaded by' })).toBeTruthy();
  } finally {
    media.restore();
  }
});
it('collapses existing filter controls behind Filters without resetting their values', () => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  const media = desktopMedia();
  try {
    render(
      <ResponsiveFilters>
        <input aria-label="Author" defaultValue="" />
      </ResponsiveFilters>,
    );
    const input = screen.getByLabelText('Author');
    fireEvent.change(input, { target: { value: 'Ada' } });
    act(() => media.resize(true));
    expect(screen.queryByLabelText('Author')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    expect(screen.getByLabelText('Author')).toBe(input);
    expect(input).toHaveProperty('value', 'Ada');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => media.resize(false));
    expect(screen.getByLabelText('Author')).toBe(input);
  } finally {
    media.restore();
  }
});
