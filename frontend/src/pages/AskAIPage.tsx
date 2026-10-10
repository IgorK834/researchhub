import { useState, type ReactElement } from 'react';
import { ResearchPanel } from '../features/ai/components/ResearchPanel';
import { SourceComparisonPanel } from '../features/ai/components/SourceComparisonPanel';
import type { WorkspaceQuestion } from '../features/ai/api/questionApi';
import type { QuestionFocus } from '../features/ai/components/WorkspaceQuestions';
import { useSourcesQuery } from '../features/sources/api/useSources';
import { describeError } from '../shared/api';
import { Button } from '../shared/components/Button';
import { Dialog } from '../shared/components/overlays';
import comparisonStyles from '../features/ai/components/SourceComparisonPanel.module.css';

/** The page and the editor panel share the same conversations and streaming controller. */
export function AskAIPage({
  workspaceId,
  initialSourceId,
  initialQuestion,
  onInitialQuestionUsed,
  focus,
  initialConversationId,
  canEdit,
}: {
  readonly initialConversationId?: string;
  readonly canEdit?: boolean;
  readonly workspaceId: string;
  readonly initialSourceId?: string;
  readonly initialQuestion?: WorkspaceQuestion;
  readonly onInitialQuestionUsed?: () => void;
  readonly focus?: QuestionFocus;
}): ReactElement {
  const sources = useSourcesQuery(workspaceId);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const starter =
    focus === undefined
      ? undefined
      : `Describe the columns, data types and data-quality issues in this dataset.${focus.sheetName === null || focus.sheetName === 'CSV' ? '' : ` Focus on the "${focus.sheetName}" sheet.`}`;
  return (
    <>
      <ResearchPanel
        key={`${workspaceId}:${initialSourceId ?? focus?.sourceId ?? ''}:${focus?.sheetName ?? ''}`}
        workspaceId={workspaceId}
        initialConversationId={initialConversationId}
        canEdit={canEdit}
        variant="page"
        initialSourceId={initialSourceId ?? focus?.sourceId}
        starterQuestion={starter}
        initialQuestion={initialQuestion}
        onInitialQuestionUsed={onInitialQuestionUsed}
        actions={
          <Button variant="ghost" icon="columns" onClick={() => setComparisonOpen(true)}>
            Compare sources
          </Button>
        }
        sources={{
          sources:
            sources.error === null
              ? (sources.data ?? []).map((source) => ({
                  id: source.id,
                  title: source.displayName,
                  ready: source.status === 'READY',
                  status: source.status,
                  sourceType: source.sourceType,
                }))
              : [],
          loading: sources.isPending,
          error: sources.error === null ? null : describeError(sources.error),
        }}
      />
      <Dialog
        className={comparisonStyles.dialog}
        open={comparisonOpen}
        title="Compare sources"
        onClose={() => setComparisonOpen(false)}
      >
        <SourceComparisonPanel workspaceId={workspaceId} />
      </Dialog>
    </>
  );
}
