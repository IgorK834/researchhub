import { useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog } from '../../../shared/components/overlays';
import { CreateDocumentForm } from './CreateDocumentForm';
import { useI18n } from '../../../shared/i18n';
import { Button } from '../../../shared/components/Button';

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
  const { t } = useI18n();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fragmentOpen =
    location.hash === '#create-document-heading' && dismissedKey !== location.key;
  const close = (): void => {
    setDismissedKey(location.key);
    onClose();
  };
  return (
    <Dialog
      open={open || fragmentOpen}
      onClose={() => close()}
      dismissible={!pending}
      closeDisabled={pending}
      footer={
        <Button variant="secondary" disabled={pending} onClick={() => close()}>
          {t('common.cancel')}
        </Button>
      }
      title={t('documents.create.heading')}
      description={t('documents.create.description')}
    >
      <CreateDocumentForm
        workspaceId={workspaceId}
        onPendingChange={setPending}
        onCreated={(created) => {
          close();
          onCreated?.(created.id);
        }}
      />
    </Dialog>
  );
}
