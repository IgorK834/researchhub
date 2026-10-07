import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { Keycap } from '../../../shared/components/content';
import { SlideOver } from '../../../shared/components/overlays';
import { describeError, queryKeys } from '../../../shared/api';
import { fetchCitationFragment } from '../../ai/api/citationEvidence';
import {
  passagePath,
  passageLocation,
  type SourceTextHit,
} from '../api/sourceTextSearch';
import { SourceSearchDialog } from './SourceSearchDialog';
import styles from './SourceSearch.module.css';

/** Workspace context comes only from the authorized shell; closing restores the invoking focus. */
interface CommandSearchProps {
  readonly workspaceId?: string;
  readonly titles: ReadonlyMap<string, string>;
  readonly compact?: boolean;
}

export function SourceCommandSearch(props: CommandSearchProps): ReactElement {
  const location = useLocation();
  return (
    <CommandSearchSession key={`${props.workspaceId ?? ''}:${location.key}`} {...props} />
  );
}

function CommandSearchSession({
  workspaceId,
  titles,
  compact = false,
}: CommandSearchProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [beside, setBeside] = useState<SourceTextHit | null>(null);
  const navigate = useNavigate();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        !workspaceId ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      // Another modal owns its own keyboard/focus contract. Search can toggle its own dialog.
      if (!open && document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (!open && document.activeElement instanceof HTMLElement)
        returnFocusRef.current = document.activeElement;
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [workspaceId, open]);
  return (
    <>
      <Button
        variant="ghost"
        icon="search"
        className={styles.trigger}
        disabled={!workspaceId}
        aria-label="Search source text (Cmd or Ctrl K)"
        title={
          workspaceId
            ? 'Search source text (Cmd or Ctrl K)'
            : 'Choose a workspace to search its sources'
        }
        onClick={(event) => {
          returnFocusRef.current = event.currentTarget;
          setOpen(true);
        }}
      >
        {compact ? null : (
          <>
            Search <Keycap>Cmd/Ctrl K</Keycap>
          </>
        )}
      </Button>
      {open && workspaceId ? (
        <SourceSearchDialog
          workspaceId={workspaceId}
          titles={titles}
          onClose={() => setOpen(false)}
          onOpen={(hit, asBeside) => {
            setOpen(false);
            if (asBeside) setBeside(hit);
            else void navigate(passagePath(hit));
          }}
        />
      ) : null}
      {beside && workspaceId ? (
        <PassageBeside
          hit={beside}
          title={titles.get(beside.chunk.sourceId) ?? 'Workspace source'}
          onClose={() => setBeside(null)}
          returnFocusRef={returnFocusRef}
          onOpen={() => {
            setBeside(null);
            void navigate(passagePath(beside));
          }}
        />
      ) : null}
    </>
  );
}

function PassageBeside({
  hit,
  title,
  onClose,
  onOpen,
  returnFocusRef,
}: {
  readonly hit: SourceTextHit;
  readonly title: string;
  readonly onClose: () => void;
  readonly onOpen: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const chunk = hit.chunk;
  const fragment = useQuery({
    queryKey: queryKeys.citationFragment(
      chunk.workspaceId,
      chunk.sourceId,
      chunk.processingVersion,
      chunk.chunkId,
      chunk.sourceVersionId,
      chunk.contentHash,
    ),
    queryFn: ({ signal }) => fetchCitationFragment(chunk, signal),
    retry: false,
    staleTime: 0,
  });
  return (
    <SlideOver
      open
      title={`${title} · ${passageLocation(hit)}`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      description="Workspace source · opened beside your current page"
      className={styles.beside}
    >
      {fragment.isPending ? (
        <p role="status">Checking source passage…</p>
      ) : fragment.error ? (
        <p role="alert">
          This source passage is unavailable or has changed:{' '}
          {describeError(fragment.error)}. Search again to open its current version.
        </p>
      ) : (
        <>
          <blockquote>{fragment.data.content}</blockquote>
          <p>Source version: {chunk.sourceVersionId}</p>
          <Button onClick={onOpen}>Open page</Button>
        </>
      )}
    </SlideOver>
  );
}
