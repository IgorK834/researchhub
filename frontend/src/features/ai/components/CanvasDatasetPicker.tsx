import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import type { WorkspaceSource } from '../../sources/api/sourceApi';
import type { AnalysisInput } from '../../analysis/api/analysisApi';
import { useDatasetPreviewQuery } from '../../analysis/api/useDatasetPreview';
import { Select } from '../../../shared/components/forms';
import { Button } from '../../../shared/components/Button';
import { describeError } from '../../../shared/api';

function DatasetFields({
  workspaceId,
  source,
  initial,
  disabled,
  onChoose,
}: {
  readonly workspaceId: string;
  readonly source: WorkspaceSource;
  readonly initial?: AnalysisInput;
  readonly disabled: boolean;
  readonly onChoose: (input: AnalysisInput | null) => void;
}): ReactElement {
  useUiLocale();
  const preview = useDatasetPreviewQuery(workspaceId, source.id, source.activeVersionId);
  const [sheetName, setSheet] = useState(initial?.sheetName ?? '');
  const [columns, setColumns] = useState<readonly number[]>(initial?.columns ?? []);
  const sheet = preview.data?.sheets.find((s) => s.name === sheetName);
  const choose = (next: readonly number[]): void => {
    setColumns(next);
    onChoose(
      sheet && next.length
        ? {
            sourceId: source.id,
            sourceVersionId: source.activeVersionId,
            sheetName: sheet.name,
            columns: next,
          }
        : null,
    );
  };
  return (
    <fieldset disabled={disabled}>
      <legend>
        {source.displayName} {uiText('ui.CanvasDatasetPicker.message001')}{' '}
        {source.activeVersionId.slice(0, 8)}
      </legend>
      {preview.isPending ? (
        <p role="status">{uiText('ui.CanvasDatasetPicker.message002')}</p>
      ) : null}
      {preview.error ? <p role="alert">{describeError(preview.error)}</p> : null}
      <Select
        label={uiText('ui.CanvasDatasetPicker.message003', {
          value0: source.displayName,
        })}
        value={sheetName}
        onChange={(e) => {
          setSheet(e.target.value);
          setColumns([]);
          onChoose(null);
        }}
      >
        <option value="">{uiText('ui.CanvasDatasetPicker.message004')}</option>
        {preview.data?.sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </Select>
      {sheet ? (
        <>
          <p>{uiText('ui.CanvasDatasetPicker.message005')}</p>
          {sheet.columns.map((c) => (
            <label key={c.index}>
              <input
                type="checkbox"
                checked={columns.includes(c.index)}
                onChange={(e) =>
                  choose(
                    e.target.checked
                      ? [...columns, c.index].sort((a, b) => a - b)
                      : columns.filter((i) => i !== c.index),
                  )
                }
              />
              {c.name} {uiText('ui.CanvasDatasetPicker.message006')} {c.index})
            </label>
          ))}
          <Button
            variant="secondary"
            onClick={() => choose(sheet.columns.map((c) => c.index))}
          >
            {uiText('ui.CanvasDatasetPicker.message007')}
          </Button>
          {preview.data?.warnings.map((w, i) => (
            <p key={i}>{w.message}</p>
          ))}
        </>
      ) : null}
    </fieldset>
  );
}
export function CanvasDatasetPicker({
  workspaceId,
  sources,
  value,
  onChange,
  disabled,
}: {
  readonly workspaceId: string;
  readonly sources: readonly WorkspaceSource[];
  readonly value: readonly AnalysisInput[];
  readonly onChange: (value: readonly AnalysisInput[]) => void;
  readonly disabled: boolean;
}): ReactElement {
  useUiLocale();
  const [versions, setVersions] = useState<readonly string[]>(
    value.map((i) => i.sourceVersionId),
  );
  const datasets = sources.filter(
    (s) => s.status === 'READY' && ['CSV', 'XLSX'].includes(s.sourceType),
  );
  return (
    <section aria-label={uiText('ui.CanvasDatasetPicker.message008')}>
      <h3>{uiText('ui.CanvasDatasetPicker.message009')}</h3>
      <p>{uiText('ui.CanvasDatasetPicker.message010')}</p>
      <Select
        label={uiText('ui.CanvasDatasetPicker.message011')}
        value=""
        disabled={disabled || versions.length >= 5}
        onChange={(e) => {
          if (e.target.value) setVersions([...versions, e.target.value]);
        }}
      >
        <option value="">{uiText('ui.CanvasDatasetPicker.message012')}</option>
        {datasets
          .filter((s) => !versions.includes(s.activeVersionId))
          .map((s) => (
            <option key={s.activeVersionId} value={s.activeVersionId}>
              {s.displayName} · {s.activeVersionId.slice(0, 8)}
            </option>
          ))}
      </Select>
      {versions.map((version) => {
        const input = value.find((i) => i.sourceVersionId === version);
        const source =
          datasets.find((s) => s.activeVersionId === version) ??
          (input ? sources.find((s) => s.id === input.sourceId) : undefined);
        const frozenSource = source ? { ...source, activeVersionId: version } : undefined;
        return source ? (
          <div key={version}>
            <DatasetFields
              workspaceId={workspaceId}
              source={frozenSource!}
              initial={value.find((i) => i.sourceVersionId === version)}
              disabled={disabled}
              onChoose={(input) =>
                onChange([
                  ...value.filter((i) => i.sourceVersionId !== version),
                  ...(input ? [input] : []),
                ])
              }
            />
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setVersions(versions.filter((v) => v !== version));
                onChange(value.filter((i) => i.sourceVersionId !== version));
              }}
            >
              {uiText('ui.CanvasDatasetPicker.message013')} {source.displayName}
            </Button>
          </div>
        ) : (
          <p key={version} role="alert">
            {uiText('ui.CanvasDatasetPicker.message014')}
            <Button
              variant="ghost"
              onClick={() => {
                setVersions(versions.filter((v) => v !== version));
                onChange(value.filter((i) => i.sourceVersionId !== version));
              }}
            >
              {uiText('ui.CanvasDatasetPicker.message015')}
            </Button>
          </p>
        );
      })}
      {!value.length ? (
        <p role="status">{uiText('ui.CanvasDatasetPicker.message016')}</p>
      ) : null}
    </section>
  );
}
