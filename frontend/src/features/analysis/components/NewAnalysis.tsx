import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { Panel, DataTable } from '../../../shared/components/content';
import { Select, Textarea } from '../../../shared/components/forms';
import { Banner } from '../../../shared/components/feedback';
import { describeError, queryKeys } from '../../../shared/api';
import { useDatasetPreviewQuery } from '../api/useDatasetPreview';
import {
  createAnalysis,
  planAnalysis,
  executeAnalysis,
  type AnalysisInput,
  type DatasetChoice,
} from '../api/analysisApi';
import styles from './Analysis.module.css';

export function NewAnalysis({
  workspaceId,
  datasets,
  onCreated,
  initialVersionId,
}: {
  readonly workspaceId: string;
  readonly datasets: readonly DatasetChoice[];
  readonly onCreated: (analysisId: string) => void;
  readonly initialVersionId?: string;
}): ReactElement {
  const [version, setVersion] = useState(
    initialVersionId ?? datasets[0]?.sourceVersionId ?? '',
  );
  const selected = datasets.find((d) => d.sourceVersionId === version) ?? datasets[0];
  const [prompt, setPrompt] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: AnalysisInput) => {
      setDraftId(null);
      const draft = await createAnalysis(workspaceId, prompt.trim(), [input]);
      setDraftId(draft.id);
      await planAnalysis(workspaceId, draft.id);
      await executeAnalysis(workspaceId, draft.id);
      return draft.id;
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: queryKeys.analyses(workspaceId) });
      onCreated(id);
    },
  });
  return (
    <section className={styles.page}>
      <Link to={`/app/workspaces/${workspaceId}/analyses`}>All analyses</Link>
      <h1>New analysis</h1>
      <p>
        Choose the data and describe what to calculate. Each run keeps its source
        versions, code and result.
      </p>
      {create.error ? (
        <Banner tone="error" lead="The analysis could not be started">
          {describeError(create.error)}
          {draftId ? (
            <Link to={`/app/workspaces/${workspaceId}/analyses/${draftId}`}>
              Open saved analysis
            </Link>
          ) : null}
        </Banner>
      ) : null}
      {!selected ? (
        <Panel title="Choose data">
          <Illustration scene="sources" />
          <p>
            No ready CSV or XLSX datasets are available. Upload and process a dataset
            first.
          </p>
          <Link to={`/app/workspaces/${workspaceId}/sources`}>Open sources</Link>
        </Panel>
      ) : (
        <div className={styles.stack}>
          <Select
            label="Source version"
            value={selected.sourceVersionId}
            disabled={create.isPending}
            onChange={(e) => setVersion(e.target.value)}
          >
            {datasets.map((d) => (
              <option key={d.sourceVersionId} value={d.sourceVersionId}>
                {d.label}
              </option>
            ))}
          </Select>
          <DatasetSelection
            key={selected.sourceVersionId}
            workspaceId={workspaceId}
            dataset={selected}
            prompt={prompt}
            onPrompt={setPrompt}
            pending={create.isPending}
            onRun={(input) => create.mutate(input)}
          />
        </div>
      )}
    </section>
  );
}
function DatasetSelection({
  workspaceId,
  dataset,
  prompt,
  onPrompt,
  pending,
  onRun,
}: {
  readonly workspaceId: string;
  readonly dataset: DatasetChoice;
  readonly prompt: string;
  readonly onPrompt: (value: string) => void;
  readonly pending: boolean;
  readonly onRun: (input: AnalysisInput) => void;
}): ReactElement {
  const preview = useDatasetPreviewQuery(
    workspaceId,
    dataset.sourceId,
    dataset.sourceVersionId,
  );
  const [sheetName, setSheet] = useState('');
  const [selected, setSelected] = useState<readonly number[] | null>(null);
  if (preview.isPending) return <p role="status">Loading dataset structure…</p>;
  if (preview.error)
    return (
      <Banner tone="error" lead="Could not inspect this version">
        {describeError(preview.error)}
      </Banner>
    );
  const sheet =
    preview.data.sheets.find((s) => s.name === sheetName) ?? preview.data.sheets[0];
  if (!sheet) return <p>No inspected sheets are available for this version.</p>;
  const columns = selected ?? sheet.columns.map((c) => c.index);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onRun({
      sourceId: dataset.sourceId,
      sourceVersionId: dataset.sourceVersionId,
      sheetName: sheet.name,
      columns,
    });
  };
  return (
    <form onSubmit={submit} className={styles.stack}>
      <Panel title="1 · Choose data">
        <Select
          label="Sheet"
          value={sheet.name}
          disabled={pending}
          onChange={(e) => {
            setSheet(e.target.value);
            setSelected(null);
          }}
        >
          {preview.data.sheets.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </Select>
        <fieldset disabled={pending} className={styles.columns}>
          <legend>Columns to use</legend>
          {sheet.columns.map((c) => (
            <label key={c.index}>
              <input
                type="checkbox"
                checked={columns.includes(c.index)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...columns, c.index]
                      : columns.filter((i) => i !== c.index),
                  )
                }
              />
              {c.name} <span className={styles.meta}>{c.inferredType.toLowerCase()}</span>
            </label>
          ))}
        </fieldset>
        <DataTable
          columns={sheet.columns.map((c, i) => ({
            id: String(c.index),
            header: c.name,
            render: (row: (typeof sheet.sampleRows)[number]) => row.cells[i],
          }))}
          rows={sheet.sampleRows.slice(0, 8)}
          rowKey={(row) => row.rowNumber}
          caption="Inspection sample — execution reads the full selected source version"
        />
        <p className={styles.meta}>
          Version {preview.data.versionNumber} · {preview.data.originalFilename}
          {preview.data.truncated ? ' · Preview limited' : ''}
        </p>
      </Panel>
      <Panel title="2 · Describe what to calculate">
        <Textarea
          label="Analysis request"
          value={prompt}
          maxLength={4000}
          required
          disabled={pending}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder="Calculate impedance U/I and plot impedance versus frequency."
        />
        <p className={styles.meta}>
          Computed values will come from execution of the full dataset. The original data
          stays unchanged.
        </p>
        <Button
          type="submit"
          icon="play"
          disabled={pending || !prompt.trim() || columns.length === 0}
        >
          {pending ? 'Preparing analysis…' : 'Run analysis'}
        </Button>
      </Panel>
    </form>
  );
}
