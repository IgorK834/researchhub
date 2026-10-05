import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../../shared/components/overlays';
import { Button } from '../../../shared/components/Button';
import { describeError, queryKeys } from '../../../shared/api';
import {
  fetchDocuments,
  fetchDocument,
  updateDocument,
} from '../../documents/api/documentApi';
import { readStoredDocument } from '../../documents/api/documentContent';
import { analysisBlock } from '../../documents/api/analysisReference';
import type { ExecutionRecord } from '../api/analysisApi';
import styles from './InsertAnalysisResult.module.css';

export function InsertAnalysisResult({
  record,
  onClose,
}: {
  readonly record: ExecutionRecord;
  readonly onClose: () => void;
}): ReactElement {
  const workspaceId = record.execution.workspaceId;
  const client = useQueryClient();
  const navigate = useNavigate();
  const [documentId, setDocumentId] = useState('');
  const outputs = record.execution.result?.outputs ?? [];
  const [outputId, setOutputId] = useState(
    outputs.find((output) => output.kind === 'CHART')?.name ?? outputs[0]?.name ?? '',
  );
  const [caption, setCaption] = useState('');
  const [position, setPosition] = useState(-1);
  const [blockId] = useState(() => crypto.randomUUID());
  const documents = useQuery({
    queryKey: queryKeys.documents(workspaceId),
    queryFn: ({ signal }) => fetchDocuments(workspaceId, signal),
  });
  const document = useQuery({
    queryKey: queryKeys.document(workspaceId, documentId),
    queryFn: ({ signal }) => fetchDocument(workspaceId, documentId, signal),
    enabled: !!documentId,
  });
  const selected = outputs.find((output) => output.name === outputId);
  const body = document.data ? readStoredDocument(document.data.content) : null;
  const insert = useMutation({
    mutationFn: async () => {
      if (!document.data || !body || !selected)
        throw new Error('Choose an available document and saved output.');
      const blocks = [...(body.content ?? [])];
      const at = position < 0 ? blocks.length : position;
      blocks.splice(
        at,
        0,
        analysisBlock(
          {
            analysisId: record.execution.analysisId,
            executionId: record.execution.id,
            outputId: selected.name,
            renderMode: selected.kind === 'TEXT' ? 'SUMMARY' : selected.kind,
          },
          caption,
          blockId,
        ),
      );
      const saved = await updateDocument(workspaceId, documentId, {
        title: document.data.title,
        content: { type: 'doc', content: blocks },
        revision: document.data.revision,
        saveKind: 'MANUAL',
      });
      return { saved, at };
    },
    onSuccess: async ({ saved, at }) => {
      client.setQueryData(queryKeys.document(workspaceId, saved.id), saved);
      await client.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
      onClose();
      await navigate(
        `/app/workspaces/${workspaceId}/documents/${saved.id}#analysis-${blockId}`,
        { state: { focusBlock: at } },
      );
    },
  });
  const error = documents.error ?? document.error;
  return (
    <Dialog
      open
      onClose={() => {
        if (!insert.isPending) onClose();
      }}
      closeDisabled={insert.isPending}
      dismissible={!insert.isPending}
      title="Insert result"
      description="Insert a saved output with its exact execution and source provenance."
      className={styles.dialog}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!insert.isPending) insert.mutate();
        }}
      >
        <fieldset disabled={insert.isPending}>
          <legend>Destination and saved output</legend>
          <label>
            Document
            <select
              value={documentId}
              onChange={(event) => {
                setDocumentId(event.target.value);
                setPosition(-1);
              }}
            >
              <option value="">Choose a report</option>
              {documents.data?.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formats} role="radiogroup" aria-label="Output format">
            {outputs.map((output) => (
              <label key={output.name} data-selected={outputId === output.name}>
                <input
                  type="radio"
                  name="analysis-output"
                  value={output.name}
                  checked={outputId === output.name}
                  onChange={() => setOutputId(output.name)}
                />
                <strong>
                  {output.kind === 'TEXT'
                    ? 'Summary'
                    : output.kind === 'CHART'
                      ? 'Chart'
                      : 'Table'}
                </strong>
                <span>{output.name}</span>
              </label>
            ))}
          </div>
          <label>
            Caption
            <input
              value={caption}
              maxLength={1000}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          {body ? (
            <label>
              Insert position
              <select
                value={position}
                onChange={(event) => setPosition(Number(event.target.value))}
              >
                <option value={-1}>End of document</option>
                {body.content?.map((block, index) => (
                  <option key={index} value={index}>
                    Before block {index + 1}
                    {block.type === 'heading'
                      ? ` · ${block.content?.map((text) => text.text ?? '').join('')}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
        <p>
          Execution {record.execution.id} · {selected?.name}. Source versions and the
          analysis link stay attached. A later rerun will not replace this reference.
        </p>
        {error ? (
          <p role="alert">Could not load the destination: {describeError(error)}</p>
        ) : null}
        {document.data && !body ? (
          <p role="alert">This document cannot be opened safely by this editor.</p>
        ) : null}
        {insert.error ? (
          <p role="alert">
            Could not insert the result: {describeError(insert.error)}{' '}
            <Button
              variant="ghost"
              disabled={document.isFetching}
              onClick={() => {
                void document.refetch();
              }}
            >
              Reload destination
            </Button>
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={insert.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !body ||
              document.isFetching ||
              !selected ||
              !!error ||
              insert.isPending ||
              document.data?.archivedAt !== null
            }
            busy={insert.isPending}
          >
            Insert
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
