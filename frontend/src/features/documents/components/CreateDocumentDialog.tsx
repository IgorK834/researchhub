import { useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog } from '../../../shared/components/overlays';
import { CreateDocumentForm } from './CreateDocumentForm';

export interface CreateDocumentDialogProps {
  readonly workspaceId: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated?: (id: string) => void;
}

/** The existing shell's creation fragment is also an opener for this dialog. */
export function CreateDocumentDialog({
  workspaceId,
  open,
  onClose,
  onCreated,
}: CreateDocumentDialogProps): ReactElement {
  const location = useLocation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const fragmentOpen =
    location.hash === '#create-document-heading' && dismissedKey !== location.key;
  const close = (): void => {
    setDismissedKey(location.key);
    onClose();
  };
  return (
    <Dialog
      open={open || fragmentOpen}
      onClose={close}
      title="New document"
      description="Give your document a title, then start writing."
    >
      <CreateDocumentForm
        workspaceId={workspaceId}
        onCreated={(created) => {
          close();
          onCreated?.(created.id);
        }}
      />
    </Dialog>
  );
}
