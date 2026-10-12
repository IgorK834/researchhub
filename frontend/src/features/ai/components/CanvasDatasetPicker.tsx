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
        {source.displayName} · version {source.activeVersionId.slice(0, 8)}
      </legend>
      {preview.isPending ? (
        <p role="status">Loading immutable dataset structure…</p>
      ) : null}
      {preview.error ? <p role="alert">{describeError(preview.error)}</p> : null}
      <Select
        label={`Dataset sheet ${source.displayName}`}
        value={sheetName}
        onChange={(e) => {
          setSheet(e.target.value);
          setColumns([]);
          onChoose(null);
        }}
      >
        <option value="">Choose a sheet explicitly</option>
        {preview.data?.sheets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </Select>
      {sheet ? (
        <>
          <p>
            Select the physical columns to provide to the plan. The sandbox reads the full
            frozen file.
          </p>
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
              {c.name} (column {c.index})
            </label>
          ))}
          <Button
            variant="secondary"
            onClick={() => choose(sheet.columns.map((c) => c.index))}
          >
            Select all inspected columns
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
  const [versions, setVersions] = useState<readonly string[]>(
    value.map((i) => i.sourceVersionId),
  );
  const datasets = sources.filter(
    (s) => s.status === 'READY' && ['CSV', 'XLSX'].includes(s.sourceType),
  );
  return (
    <section aria-label="Dataset calculation inputs">
      <h3>Frozen calculation inputs</h3>
      <p>
        Choose an exact dataset version, sheet and columns. No dataset is selected
        automatically.
      </p>
      <Select
        label="Calculation dataset version"
        value=""
        disabled={disabled || versions.length >= 5}
        onChange={(e) => {
          if (e.target.value) setVersions([...versions, e.target.value]);
        }}
      >
        <option value="">Add dataset version</option>
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
              Remove dataset {source.displayName}
            </Button>
          </div>
        ) : (
          <p key={version} role="alert">
            This selected version is no longer listed. Choose an available immutable
            version explicitly.
            <Button
              variant="ghost"
              onClick={() => {
                setVersions(versions.filter((v) => v !== version));
                onChange(value.filter((i) => i.sourceVersionId !== version));
              }}
            >
              Remove unavailable version
            </Button>
          </p>
        );
      })}
      {!value.length ? (
        <p role="status">
          Choose a sheet and at least one column before sending Analyze.
        </p>
      ) : null}
    </section>
  );
}
