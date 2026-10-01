import type { ReactElement } from 'react';
import type { CsvProfile } from '../api/sourceExtraction';

/** CSV metadata is a data profile; sampled values below remain inert strings. */
export function CsvAssetProfile({
  profile,
}: {
  readonly profile: CsvProfile;
}): ReactElement {
  const delimiter =
    profile.delimiter === null
      ? 'Single column'
      : ({ ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' } as const)[
          profile.delimiter
        ];
  return (
    <section aria-label="CSV data asset">
      <h3>CSV data asset</h3>
      <p>
        Encoding: {profile.encoding}. Separator: {delimiter}.
      </p>
      <p>
        Data rows: {profile.rowCount ?? 'Unknown'}. Profiled data rows:{' '}
        {profile.profiledRowCount}
        {profile.rowScanComplete ? ' (complete row scan)' : ' (limited row scan)'}.
      </p>
      <p>
        The first nonempty record is assumed to contain column names. Inferred types can
        be wrong; verify them before analysis.
      </p>
      <p>
        Missing counts cover profiled rows and treat empty or whitespace-only cells as
        missing. Text such as NA or null remains a value.
      </p>
      <p>AI source questions use this schema. Use the original file for calculations.</p>
      <table aria-label="CSV inferred schema">
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col">Name</th>
            <th scope="col">Inferred type</th>
            <th scope="col">Missing in profiled rows</th>
          </tr>
        </thead>
        <tbody>
          {profile.columns.map((column) => (
            <tr key={column.columnNumber}>
              <th scope="row">{column.columnNumber}</th>
              <td>{column.name}</td>
              <td>{column.inferredType}</td>
              <td>
                {column.missingCount} / {profile.profiledRowCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
