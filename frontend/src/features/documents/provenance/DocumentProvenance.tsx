import { getIntlLocale } from '../../../shared/i18n';
import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useState, type ReactElement } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { useQuery } from '@tanstack/react-query';
import { apiClient, describeError } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import { Icon } from '../../../shared/components/icons';
import { citationPath, type Citation } from '../../ai/api/generationApi';
import styles from './DocumentProvenance.module.css';
import type { DocumentTemplateOrigin } from '../api/documentTemplateApi';

export type OriginCategory =
  'HUMAN' | 'AI_GENERATED' | 'AI_REWRITTEN' | 'IMPORTED' | 'ANALYSIS_DERIVED';
export interface OriginOperation {
  id: string;
  blockId: string;
  category: OriginCategory;
  actorUserId: string | null;
  actorName: string;
  operationType: string;
  sourceOperationId: string | null;
  documentRevision: number;
  createdAt: string;
  metadata: {
    documentTemplate?: DocumentTemplateOrigin;
    citations?: Citation[];
    model?: { provider?: string; name?: string; version?: string };
    templateId?: string;
    templateHash?: string;
    editedBeforeAcceptance?: boolean;
    analysis?: {
      analysisId: string;
      executionId: string;
      outputId: string;
      renderMode: string;
    };
  };
}
const labels: Record<OriginCategory, string> = {
  get HUMAN() {
    return uiText('ui.DocumentOutline.message004');
  },
  get AI_GENERATED() {
    return uiText('ui.DocumentProvenance.message022');
  },
  get AI_REWRITTEN() {
    return uiText('ui.DocumentProvenance.message023');
  },
  get IMPORTED() {
    return uiText('ui.DocumentOutline.message006');
  },
  get ANALYSIS_DERIVED() {
    return uiText('ui.DocumentOutline.message007');
  },
};
export function DocumentProvenance({
  workspaceId,
  documentId,
  editor,
  onExplainOperation,
}: {
  readonly workspaceId: string;
  readonly documentId: string;
  readonly editor: Editor | null;
  readonly onExplainOperation?: (id: string, sourceVersionIds: readonly string[]) => void;
}): ReactElement {
  useUiLocale();
  const [block, setBlock] = useState<{
    id: string | null;
    text: string;
    type: string;
  } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const selected = (): void => {
      const selection = editor.state.selection;
      let node: ProseMirrorNode | null =
        selection instanceof NodeSelection ? selection.node : null;
      if (!node)
        for (let depth = selection.$from.depth; depth > 0; depth--) {
          const parent = selection.$from.node(depth);
          if (
            ['paragraph', 'heading', 'codeBlock', 'figure'].includes(parent.type.name)
          ) {
            node = parent;
            break;
          }
        }
      setBlock(
        node
          ? {
              id: node.attrs['blockId'] as string | null,
              text: node.textContent.slice(0, 500),
              type: node.type.name,
            }
          : null,
      );
    };
    selected();
    editor.on('transaction', selected);
    return () => {
      editor.off('transaction', selected);
    };
  }, [editor]);
  const history = useQuery({
    queryKey: ['document-provenance', workspaceId, documentId, block?.id],
    queryFn: ({ signal }) =>
      apiClient.get<OriginOperation[]>(
        `/api/workspaces/${workspaceId}/documents/${documentId}/blocks/${block?.id}/provenance`,
        { signal },
      ),
    enabled: !!block?.id,
    refetchInterval: 5000,
    staleTime: 0,
  });
  return (
    <section
      aria-label={uiText('ui.DocumentProvenance.message001')}
      className={styles.inspector}
    >
      <h2>{uiText('ui.DocumentProvenance.message002')}</h2>
      <p className={styles.note}>{uiText('ui.DocumentProvenance.message003')}</p>
      {!block ? (
        <p>{uiText('ui.DocumentProvenance.message004')}</p>
      ) : (
        <>
          <blockquote aria-label={uiText('ui.DocumentProvenance.message005')}>
            {block.text || block.type}
          </blockquote>
          {!block.id ? (
            <p>{uiText('ui.DocumentProvenance.message006')}</p>
          ) : (
            <>
              {history.isPending ? (
                <p role="status">{uiText('ui.DocumentProvenance.message007')}</p>
              ) : null}
              {history.error ? (
                <p role="alert">
                  {uiText('ui.DocumentProvenance.message008')}{' '}
                  {describeError(history.error)}
                </p>
              ) : null}
              {history.data?.length === 0 ? (
                <p>{uiText('ui.DocumentProvenance.message009')}</p>
              ) : null}
              {history.data?.length === 200 ? (
                <p>{uiText('ui.DocumentProvenance.message010')}</p>
              ) : null}
              <ol aria-label={uiText('ui.DocumentProvenance.message011')}>
                {history.data?.map((operation) => (
                  <li key={operation.id} data-origin={operation.category}>
                    <strong>
                      <Icon
                        name={
                          operation.category.startsWith('AI_')
                            ? 'sparkle'
                            : operation.category === 'ANALYSIS_DERIVED'
                              ? 'chart'
                              : operation.category === 'IMPORTED'
                                ? 'download'
                                : 'pencil'
                        }
                        size={16}
                      />{' '}
                      {labels[operation.category]}
                    </strong>
                    <p>
                      {operation.operationType === 'TEMPLATE_APPLIED'
                        ? uiText('templates.origin')
                        : operation.operationType === 'AI_ACCEPTED'
                          ? uiText('ui.DocumentProvenance.message012')
                          : operation.operationType === 'CITATION_ADDED'
                            ? uiText('ui.DocumentProvenance.message013')
                            : operation.operationType === 'INSERTED'
                              ? uiText('ui.DocumentProvenance.message014')
                              : operation.operationType === 'TRACKED'
                                ? uiText('ui.DocumentProvenance.message015')
                                : uiText('ui.DocumentProvenance.message016')}{' '}
                      · v{operation.documentRevision}
                    </p>
                    {operation.metadata.documentTemplate ? (
                      <p>
                        {operation.metadata.documentTemplate.templateId} ·{' '}
                        {uiText('templates.version', {
                          version: operation.metadata.documentTemplate.version,
                        })}{' '}
                        · {operation.metadata.documentTemplate.locale.toUpperCase()}
                      </p>
                    ) : null}
                    <p>
                      {operation.actorName} ·{' '}
                      <time dateTime={operation.createdAt}>
                        {new Date(operation.createdAt).toLocaleString(getIntlLocale())}
                      </time>
                    </p>
                    {operation.metadata.editedBeforeAcceptance ? (
                      <p>{uiText('ui.DocumentProvenance.message017')}</p>
                    ) : null}
                    {operation.metadata.model?.name ? (
                      <p>
                        {operation.metadata.model.provider} ·{' '}
                        {operation.metadata.model.name}
                      </p>
                    ) : null}
                    {operation.sourceOperationId ? (
                      <p className={styles.identity}>
                        {uiText('ui.DocumentProvenance.message018')}{' '}
                        {operation.sourceOperationId}
                      </p>
                    ) : null}
                    {operation.operationType === 'AI_ACCEPTED' &&
                    operation.sourceOperationId &&
                    onExplainOperation ? (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          onExplainOperation(operation.sourceOperationId!, [
                            ...new Set(
                              operation.metadata.citations?.flatMap((citation) =>
                                citation.sourceVersionId
                                  ? [citation.sourceVersionId]
                                  : [],
                              ) ?? [],
                            ),
                          ])
                        }
                      >
                        {uiText('ui.DocumentProvenance.message019')}
                      </Button>
                    ) : null}
                    {operation.metadata.citations?.length ? (
                      <ul aria-label={uiText('ui.DocumentProvenance.message020')}>
                        {operation.metadata.citations.map((citation) => (
                          <li key={citation.chunkId}>
                            <a href={citationPath(citation)}>
                              {citation.title || uiText('ui.ResearchEvidence.message003')}
                              {citation.pageStart === null
                                ? ''
                                : ` · p. ${citation.pageStart}`}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {operation.metadata.analysis ? (
                      <p>
                        <a
                          href={`/app/workspaces/${workspaceId}/analyses/${operation.metadata.analysis.analysisId}?execution=${operation.metadata.analysis.executionId}`}
                        >
                          {uiText('ui.GroundedAnswer.message021')}
                        </a>
                        <br />
                        {uiText('ui.DocumentProvenance.message021')}{' '}
                        {operation.metadata.analysis.outputId}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
