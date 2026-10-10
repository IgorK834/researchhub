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
    citations?: Citation[];
    model?: { provider?: string; name?: string };
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
  HUMAN: 'Human contribution',
  AI_GENERATED: 'AI generated',
  AI_REWRITTEN: 'AI rewritten',
  IMPORTED: 'Imported content',
  ANALYSIS_DERIVED: 'Analysis derived',
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
    <section aria-label="Block provenance" className={styles.inspector}>
      <h2>Provenance</h2>
      <p className={styles.note}>
        Recorded operations for this block. Later edits may change its wording. This is
        not AI detection or a percentage of authorship.
      </p>
      {!block ? (
        <p>
          Select a paragraph, heading, code block, figure or analysis result to inspect
          its origin.
        </p>
      ) : (
        <>
          <blockquote aria-label="Selected block">{block.text || block.type}</blockquote>
          {!block.id ? (
            <p>
              No origin was recorded for this legacy block. Its authorship cannot be
              inferred.
            </p>
          ) : (
            <>
              {history.isPending ? <p role="status">Loading provenance…</p> : null}
              {history.error ? (
                <p role="alert">
                  Could not load provenance: {describeError(history.error)}
                </p>
              ) : null}
              {history.data?.length === 0 ? (
                <p>No saved operations yet. Provenance becomes available after saving.</p>
              ) : null}
              {history.data?.length === 200 ? (
                <p>Showing the latest 200 recorded operations.</p>
              ) : null}
              <ol aria-label="Recorded block operations">
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
                      {operation.operationType === 'AI_ACCEPTED'
                        ? 'Suggestion accepted'
                        : operation.operationType === 'CITATION_ADDED'
                          ? 'Citation added manually'
                          : operation.operationType === 'INSERTED'
                            ? 'Block inserted'
                            : operation.operationType === 'TRACKED'
                              ? 'Tracking started'
                              : 'Block edited'}{' '}
                      · v{operation.documentRevision}
                    </p>
                    <p>
                      {operation.actorName} ·{' '}
                      <time dateTime={operation.createdAt}>
                        {new Date(operation.createdAt).toLocaleString()}
                      </time>
                    </p>
                    {operation.metadata.editedBeforeAcceptance ? (
                      <p>Edited by a person before acceptance.</p>
                    ) : null}
                    {operation.metadata.model?.name ? (
                      <p>
                        {operation.metadata.model.provider} ·{' '}
                        {operation.metadata.model.name}
                      </p>
                    ) : null}
                    {operation.sourceOperationId ? (
                      <p className={styles.identity}>
                        Source operation: {operation.sourceOperationId}
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
                        Explain accepted text in chat
                      </Button>
                    ) : null}
                    {operation.metadata.citations?.length ? (
                      <ul aria-label="Operation sources">
                        {operation.metadata.citations.map((citation) => (
                          <li key={citation.chunkId}>
                            <a href={citationPath(citation)}>
                              {citation.title || 'Open source'}
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
                          Open analysis provenance
                        </a>
                        <br />
                        Output: {operation.metadata.analysis.outputId}
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
