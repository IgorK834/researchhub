import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';

import { useNarrowDesktop } from '../shared/hooks/useNarrowDesktop';
import { SlideOver } from '../shared/components/overlays';
import { ToolShell } from '../shared/components/shell';
import { SourceDetailPage } from './SourceDetailPage';
import { WorkspaceDetailPage } from './WorkspaceDetailPage';
import { workspaceSectionPath } from '../app/workspaceRoutes';

/** A direct/refreshed narrow URL has the same library backdrop as a link opened from the library. */
export function SourceRoutePage(): ReactElement {
  const narrow = useNarrowDesktop();
  const navigate = useNavigate();
  const { workspaceId } = useParams();
  const [host] = useState(() => document.createElement('div'));
  const attach = (element: HTMLDivElement | null): void => {
    if (element) element.appendChild(host);
  };
  return (
    <>
      {!narrow || workspaceId === undefined ? (
        <ToolShell label="Source reader">
          <div ref={attach} />
        </ToolShell>
      ) : (
        <>
          <WorkspaceDetailPage section="sources" />
          <SlideOver
            open
            title="Source details"
            onClose={() => {
              void navigate(
                `${workspaceSectionPath(workspaceId, 'sources')}#workspace-sources-heading`,
                { replace: true },
              );
            }}
          >
            <div ref={attach} />
          </SlideOver>
        </>
      )}
      {createPortal(<SourceDetailPage />, host)}
    </>
  );
}
