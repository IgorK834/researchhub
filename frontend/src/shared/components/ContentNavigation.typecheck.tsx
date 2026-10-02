import { DataTable, EmptyState } from './content';
import { Tabs } from './navigation';

export const typedTable = (
  <DataTable
    rows={[{ id: 'a', title: 'Title' }]}
    rowKey={(row) => row.id}
    caption="Documents"
    columns={[{ id: 'title', header: 'Title', render: (row) => row.title }]}
  />
);
export const invalidActions = (
  <EmptyState
    title="Empty"
    description="Next step."
    actions={[
      <button key="1">One</button>,
      <button key="2">Two</button>,
      // @ts-expect-error Empty states support at most two actions.
      <button key="3">Three</button>,
    ]}
  />
);
export const invalidTabs = (
  <Tabs<'all' | 'pdf'>
    label="Types"
    items={[{ value: 'all', label: 'All', content: 'All' }]}
    // @ts-expect-error Tab values are an explicit public union.
    value="unknown"
    onChange={() => {}}
  />
);
export const invalidColumn = (
  <DataTable
    rows={[{ id: 'one' }]}
    caption="Rows"
    rowKey={(row) => row.id}
    columns={[
      // @ts-expect-error Column renderers use the actual row type.
      { id: 'name', header: 'Name', render: (row) => row.name },
    ]}
  />
);
