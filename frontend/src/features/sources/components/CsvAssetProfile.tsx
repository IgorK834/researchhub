import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import type { CsvProfile } from '../api/sourceExtraction';

/** CSV metadata is a data profile; sampled values below remain inert strings. */
export function CsvAssetProfile({
  profile,
}: {
  readonly profile: CsvProfile;
}): ReactElement {
  useUiLocale();
  const delimiter =
    profile.delimiter === null
      ? uiText('ui.CsvAssetProfile.message001')
      : ({ ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' } as const)[
          profile.delimiter
        ];
  return (
    <section aria-label={uiText('ui.CsvAssetProfile.message002')}>
      <h3>{uiText('ui.CsvAssetProfile.message002')}</h3>
      <p>
        {uiText('ui.CsvAssetProfile.message003')} {profile.encoding}
        {uiText('ui.CsvAssetProfile.message004')} {delimiter}.
      </p>
      <p>
        {uiText('ui.CsvAssetProfile.message005')}{' '}
        {profile.rowCount ?? uiText('ui.ProblemForm.message012')}
        {uiText('ui.CsvAssetProfile.message006')} {profile.profiledRowCount}
        {profile.rowScanComplete
          ? ' ' + uiText('ui.CsvAssetProfile.message007')
          : ' ' + uiText('ui.CsvAssetProfile.message008')}
        .
      </p>
      <p>{uiText('ui.CsvAssetProfile.message009')}</p>
      <p>{uiText('ui.CsvAssetProfile.message010')}</p>
      <p>{uiText('ui.CsvAssetProfile.message011')}</p>
      <table aria-label={uiText('ui.CsvAssetProfile.message012')}>
        <thead>
          <tr>
            <th scope="col">{uiText('ui.AnalysisProvenance.message007')}</th>
            <th scope="col">{uiText('ui.CsvAssetProfile.message013')}</th>
            <th scope="col">{uiText('ui.CsvAssetProfile.message014')}</th>
            <th scope="col">{uiText('ui.CsvAssetProfile.message015')}</th>
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
