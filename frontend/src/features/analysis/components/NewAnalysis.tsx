import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { ProblemForm } from './ProblemForm';
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
  useUiLocale();
  const [problemMode, setProblemMode] = useState(false);
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
  if (problemMode)
    return (
      <section className={styles.page}>
        <Button variant="ghost" onClick={() => setProblemMode(false)}>
          {uiText('ui.NewAnalysis.message001')}
        </Button>
        <ProblemForm workspaceId={workspaceId} onCreated={onCreated} />
      </section>
    );
  return (
    <section className={styles.page}>
      <Link to={`/app/workspaces/${workspaceId}/analyses`}>
        {uiText('ui.AnalysisStudio.message009')}
      </Link>
      <h1>{uiText('ui.AnalysisList.message003')}</h1>
      <Button variant="secondary" onClick={() => setProblemMode(true)}>
        {uiText('ui.NewAnalysis.message002')}
      </Button>
      <p>{uiText('ui.NewAnalysis.message003')}</p>
      {create.error ? (
        <Banner tone="error" lead={uiText('ui.NewAnalysis.message018')}>
          {describeError(create.error)}
          {draftId ? (
            <Link to={`/app/workspaces/${workspaceId}/analyses/${draftId}`}>
              {uiText('ui.NewAnalysis.message004')}
            </Link>
          ) : null}
        </Banner>
      ) : null}
      {!selected ? (
        <Panel title={uiText('ui.NewAnalysis.message005')}>
          <Illustration scene="sources" />
          <p>{uiText('ui.NewAnalysis.message006')}</p>
          <Link to={`/app/workspaces/${workspaceId}/sources`}>
            {uiText('ui.NewAnalysis.message007')}
          </Link>
        </Panel>
      ) : (
        <div className={styles.stack}>
          <Select
            label={uiText('ui.DatasetPreviewPanel.message009')}
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
  useUiLocale();
  const preview = useDatasetPreviewQuery(
    workspaceId,
    dataset.sourceId,
    dataset.sourceVersionId,
  );
  const [sheetName, setSheet] = useState('');
  const [selected, setSelected] = useState<readonly number[] | null>(null);
  if (preview.isPending)
    return <p role="status">{uiText('ui.NewAnalysis.message008')}</p>;
  if (preview.error)
    return (
      <Banner tone="error" lead={uiText('ui.NewAnalysis.message019')}>
        {describeError(preview.error)}
      </Banner>
    );
  const sheet =
    preview.data.sheets.find((s) => s.name === sheetName) ?? preview.data.sheets[0];
  if (!sheet) return <p>{uiText('ui.NewAnalysis.message009')}</p>;
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
      <Panel title={uiText('ui.NewAnalysis.message010')}>
        <Select
          label={uiText('ui.DatasetPreviewPanel.message038')}
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
          <legend>{uiText('ui.NewAnalysis.message011')}</legend>
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
          caption={uiText('ui.NewAnalysis.message012')}
        />
        <p className={styles.meta}>
          {uiText('ui.AnalysisStudio.message004')} {preview.data.versionNumber} ·{' '}
          {preview.data.originalFilename}
          {preview.data.truncated ? ' ' + uiText('ui.NewAnalysis.message013') : ''}
        </p>
      </Panel>
      <Panel title={uiText('ui.NewAnalysis.message014')}>
        <Textarea
          label={uiText('ui.AnalysisProvenance.message008')}
          value={prompt}
          maxLength={4000}
          required
          disabled={pending}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={uiText('ui.NewAnalysis.message015')}
        />
        <p className={styles.meta}>{uiText('ui.NewAnalysis.message016')}</p>
        <Button
          type="submit"
          icon="play"
          disabled={pending || !prompt.trim() || columns.length === 0}
        >
          {pending
            ? uiText('ui.NewAnalysis.message017')
            : uiText('ui.AnalysisStudio.message011')}
        </Button>
      </Panel>
    </form>
  );
}
