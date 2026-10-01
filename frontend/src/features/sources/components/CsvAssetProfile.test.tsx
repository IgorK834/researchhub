/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { CsvAssetProfile } from './CsvAssetProfile';
import type { CsvProfile } from '../api/sourceExtraction';
import fixture from '../../../../../contracts/tabular/v1/csv-profile.json';

const profile = fixture as CsvProfile;
it.each([
  [',', 'Comma'],
  [';', 'Semicolon'],
  ['\t', 'Tab'],
  ['|', 'Pipe'],
  [null, 'Single column'],
] as const)(
  'renders the safe encoding/separator and complete row count for %s',
  (delimiter, label) => {
    render(<CsvAssetProfile profile={{ ...profile, delimiter }} />);
    expect(screen.getByText(`Encoding: UTF-8. Separator: ${label}.`)).not.toBeNull();
    expect(
      screen.getByText(/Data rows: 2. Profiled data rows: 2 \(complete row scan\)/),
    ).not.toBeNull();
    expect(screen.getByRole('table', { name: 'CSV inferred schema' })).not.toBeNull();
    expect(screen.getByText('integer')).not.toBeNull();
    expect(screen.getByText('1 / 2')).not.toBeNull();
    expect(screen.getByText(/Inferred types can be wrong/)).not.toBeNull();
  },
);
it('renders limited row scans without inventing totals or executing schema names', () => {
  render(
    <CsvAssetProfile
      profile={{
        ...profile,
        encoding: 'UTF-8-BOM',
        rowCount: null,
        rowScanComplete: false,
        columns: [
          {
            ...profile.columns[0]!,
            name: '<script>private()</script>',
            inferredType: 'text',
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Data rows: Unknown/)).not.toBeNull();
  expect(screen.getByText(/limited row scan/)).not.toBeNull();
  expect(screen.getByText('<script>private()</script>')).not.toBeNull();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText(/empty or whitespace-only/)).not.toBeNull();
  expect(screen.getByText(/Use the original file for calculations/)).not.toBeNull();
});
