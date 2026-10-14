import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../../../shared/components/Button';
import { Keycap } from '../../../shared/components/content';
import { SlideOver } from '../../../shared/components/overlays';
import type { WorkspaceSearchResult } from '../api/workspaceSearchApi';
import { WorkspaceSearchDialog } from './WorkspaceSearchDialog';
import styles from './WorkspaceSearch.module.css';

export function WorkspaceCommandSearch({
  workspaceId,
  compact = false,
}: {
  readonly workspaceId?: string;
  readonly compact?: boolean;
}): ReactElement {
  const location = useLocation();
  return (
    <WorkspaceSearchSession
      key={`${workspaceId ?? ''}:${location.key}`}
      workspaceId={workspaceId}
      compact={compact}
    />
  );
}

function WorkspaceSearchSession({
  workspaceId,
  compact,
}: {
  readonly workspaceId?: string;
  readonly compact: boolean;
}): ReactElement {
  useUiLocale();
  const [open, setOpen] = useState(false);
  const [beside, setBeside] = useState<WorkspaceSearchResult | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
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
      if (!open && document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (!open && document.activeElement instanceof HTMLElement)
        returnFocus.current = document.activeElement;
      setOpen((current) => !current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, workspaceId]);
  return (
    <>
      <Button
        variant="ghost"
        icon="search"
        className={styles.trigger}
        disabled={!workspaceId}
        aria-label={uiText('ui.WorkspaceCommandSearch.message001')}
        title={
          workspaceId
            ? uiText('ui.WorkspaceCommandSearch.message001')
            : uiText('ui.WorkspaceCommandSearch.message002')
        }
        onClick={(event) => {
          returnFocus.current = event.currentTarget;
          setOpen(true);
        }}
      >
        {compact ? null : (
          <>
            {uiText('ui.WorkspaceCommandSearch.message003')}
            <Keycap>{uiText('ui.WorkspaceCommandSearch.message004')}</Keycap>
          </>
        )}
      </Button>
      {open && workspaceId ? (
        <WorkspaceSearchDialog
          workspaceId={workspaceId}
          returnFocusRef={returnFocus}
          onClose={() => setOpen(false)}
          onOpen={(path, preview) => {
            setOpen(false);
            if (preview) setBeside(preview);
            else void navigate(path);
          }}
        />
      ) : null}
      {beside ? (
        <SlideOver
          open
          title={beside.title}
          description={uiText('ui.WorkspaceCommandSearch.message005')}
          onClose={() => setBeside(null)}
          returnFocusRef={returnFocus}
        >
          <p>{beside.snippet}</p>
          <p>
            {uiText('ui.WorkspaceCommandSearch.message006')}{' '}
            {beside.sourceVersion ?? uiText('ui.WorkspaceCommandSearch.message007')}
          </p>
          <p>{uiText('ui.WorkspaceCommandSearch.message008')}</p>
          <Button
            onClick={() => {
              setBeside(null);
              void navigate(beside.location);
            }}
          >
            {uiText('ui.GroundedAnswer.message006')}
          </Button>
        </SlideOver>
      ) : null}
    </>
  );
}
