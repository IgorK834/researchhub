/** @jest-environment jsdom */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasDatasetPicker } from './CanvasDatasetPicker';
import * as preview from '../../analysis/api/useDatasetPreview';
import type { AnalysisInput } from '../../analysis/api/analysisApi';
import type { WorkspaceSource } from '../../sources/api/sourceApi';
jest.mock('../../analysis/api/useDatasetPreview');
const source = {
  id: 's',
  activeVersionId: 'v1',
  displayName: 'Data',
  status: 'READY',
  sourceType: 'CSV',
} as WorkspaceSource;
const data = {
  sheets: [
    {
      name: 'CSV',
      columns: [
        { name: 'voltage', index: 1 },
        { name: 'current', index: 2 },
      ],
    },
  ],
  warnings: [{ message: 'Preview is bounded' }],
};
beforeEach(() =>
  jest
    .mocked(preview.useDatasetPreviewQuery)
    .mockReturnValue({ data, isPending: false, error: null } as never),
);
function Controlled() {
  const [value, change] = useState<readonly AnalysisInput[]>([]);
  return (
    <>
      <CanvasDatasetPicker
        workspaceId="w"
        sources={[
          source,
          { ...source, id: 'pdf', sourceType: 'PDF', activeVersionId: 'pdf' },
        ]}
        value={value}
        onChange={change}
        disabled={false}
      />
      <pre>{JSON.stringify(value)}</pre>
    </>
  );
}
test('no automatic file, sheet or columns; selected physical indices are frozen', () => {
  render(<Controlled />);
  expect(screen.queryByLabelText('Dataset sheet Data')).toBeNull();
  fireEvent.change(screen.getByLabelText('Calculation dataset version'), {
    target: { value: 'v1' },
  });
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.change(screen.getByLabelText('Dataset sheet Data'), {
    target: { value: 'CSV' },
  });
  fireEvent.click(screen.getByLabelText('voltage (column 1)'));
  expect(screen.getByText(/"columns":\[1\]/).textContent).toContain(
    '"sourceVersionId":"v1"',
  );
  fireEvent.click(screen.getByLabelText('current (column 2)'));
  fireEvent.click(screen.getByLabelText('voltage (column 1)'));
  expect(screen.getByText(/"columns":\[2\]/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Select all inspected columns' }));
  expect(screen.getByText(/"columns":\[1,2\]/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Dataset sheet Data'), {
    target: { value: '' },
  });
  expect(screen.getByRole('status')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove dataset Data' }));
  expect(screen.queryByLabelText('Dataset sheet Data')).toBeNull();
});
test('loading, preview errors, stale selected version and disabled controls are explicit', () => {
  jest
    .mocked(preview.useDatasetPreviewQuery)
    .mockReturnValue({ isPending: true, error: new Error('not ready') } as never);
  const change = jest.fn();
  const view = render(
    <CanvasDatasetPicker
      workspaceId="w"
      sources={[source]}
      value={[{ sourceId: 's', sourceVersionId: 'v1', sheetName: 'CSV', columns: [1] }]}
      onChange={change}
      disabled
    />,
  );
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('An unexpected error');
  expect(
    (screen.getByLabelText('Dataset sheet Data') as HTMLSelectElement).closest('fieldset')
      ?.disabled,
  ).toBe(true);
  view.rerender(
    <CanvasDatasetPicker
      workspaceId="w"
      sources={[{ ...source, activeVersionId: 'v2' }]}
      value={[]}
      onChange={change}
      disabled={false}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('no longer listed');
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable version' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('replacement leaves an explicitly inspected historical input on its selected version', () => {
  const input = { sourceId: 's', sourceVersionId: 'v1', sheetName: 'CSV', columns: [1] };
  const change = jest.fn();
  const view = render(
    <CanvasDatasetPicker
      workspaceId="w"
      sources={[source]}
      value={[input]}
      onChange={change}
      disabled={false}
    />,
  );
  view.rerender(
    <CanvasDatasetPicker
      workspaceId="w"
      sources={[{ ...source, activeVersionId: 'v2' }]}
      value={[input]}
      onChange={change}
      disabled={false}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(preview.useDatasetPreviewQuery).toHaveBeenLastCalledWith('w', 's', 'v1');
  expect((screen.getByLabelText('voltage (column 1)') as HTMLInputElement).checked).toBe(
    true,
  );
  expect(change).not.toHaveBeenCalled();
});
