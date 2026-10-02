import { useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeError, queryKeys } from '../../../shared/api';
import { Button } from '../../../shared/components/Button';
import {
  CitationChip,
  type CitationVariant,
} from '../../../shared/components/CitationChip';
import { AnchoredPopover } from '../../../shared/components/overlays/Popover';
import { citationPath, type Citation } from '../api/generationApi';
import { fetchCitationFragment } from '../api/citationEvidence';
import styles from './Citations.module.css';

/** Same shape as a source citation, with legacy source-level citations explicitly supported. */
export type PreviewCitation = Omit<Citation, 'chunkId'> & {
  readonly chunkId?: string | null;
  readonly label?: string;
};
export function citationLocation(citation: PreviewCitation): string {
  if (citation.pageStart !== null)
    return citation.pageEnd !== null && citation.pageEnd !== citation.pageStart
      ? `Pages ${String(citation.pageStart)}–${String(citation.pageEnd)}`
      : `Page ${String(citation.pageStart)}`;
  return citation.sectionTitle ?? 'Source fragment';
}
export function citationVariant(sourceType?: string): CitationVariant {
  return sourceType === 'CSV' || sourceType === 'XLSX' ? 'dataset' : 'document';
}
export function CitationQuote({
  citation,
  quote,
}: {
  readonly citation: PreviewCitation;
  readonly quote?: string;
}): ReactElement {
  if (quote !== undefined)
    return <blockquote className={styles.quote}>{quote}</blockquote>;
  if (!citation.chunkId) return <p>No quoted passage is available for this citation.</p>;
  return <StoredQuote citation={{ ...citation, chunkId: citation.chunkId }} />;
}
function StoredQuote({ citation }: { readonly citation: Citation }): ReactElement {
  const fragment = useQuery({
    queryKey: queryKeys.citationFragment(
      citation.workspaceId,
      citation.sourceId,
      citation.processingVersion,
      citation.chunkId,
      citation.sourceVersionId,
      citation.contentHash,
    ),
    queryFn: ({ signal }) => fetchCitationFragment(citation, signal),
    staleTime: 0,
  });
  if (fragment.isPending) return <p role="status">Loading cited passage…</p>;
  if (fragment.error !== null)
    return (
      <p role="alert">
        Could not load the cited passage: {describeError(fragment.error)}
      </p>
    );
  return <blockquote className={styles.quote}>{fragment.data.content}</blockquote>;
}
export function CitationPopover({
  citation,
  number,
  anchor,
  onClose,
  onNavigate,
  quote,
}: {
  readonly citation: PreviewCitation;
  readonly number: string | number;
  readonly anchor: HTMLElement;
  readonly onClose: () => void;
  readonly onNavigate?: (path: string) => void;
  readonly quote?: string;
}): ReactElement {
  const path = citationPath({ ...citation, chunkId: citation.chunkId ?? '' });
  return (
    <AnchoredPopover
      anchor={anchor}
      title={`Citation ${String(number)}`}
      onClose={onClose}
      className={styles.popover}
    >
      <strong>
        {citation.label ?? citation.title ?? citation.sectionTitle ?? 'Source'}
      </strong>
      <p className={styles.location}>
        {citation.title ?? 'Source'} · {citationLocation(citation)}
      </p>
      <CitationQuote citation={citation} quote={quote} />
      <div className={styles.actions}>
        {(['Open source', 'View context'] as const).map((label) => (
          <Button
            key={label}
            href={path}
            variant="secondary"
            size="compact"
            onClick={(event) => {
              if (onNavigate !== undefined) {
                event.preventDefault();
                onNavigate(path);
              }
              onClose();
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </AnchoredPopover>
  );
}
export function CitationReference({
  citation,
  number,
  variant,
  label,
  children,
  onInspect,
  quote,
  inline,
}: {
  readonly citation: PreviewCitation;
  readonly number: string | number;
  readonly variant?: CitationVariant;
  readonly label?: string;
  readonly children?: ReactNode;
  readonly onInspect?: () => void;
  readonly quote?: string;
  readonly inline?: boolean;
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null);
  return (
    <>
      <CitationChip
        href={citationPath({ ...citation, chunkId: citation.chunkId ?? '' })}
        number={number}
        variant={variant}
        label={label}
        inline={inline}
        expanded={anchor !== null}
        onOpen={(target) => {
          setAnchor(target);
          onInspect?.();
        }}
      >
        {children}
      </CitationChip>
      {anchor === null ? null : (
        <CitationPopover
          citation={citation}
          number={number}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          quote={quote}
        />
      )}
    </>
  );
}
