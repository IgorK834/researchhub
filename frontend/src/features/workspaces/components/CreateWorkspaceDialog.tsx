import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { Dialog } from '../../../shared/components/overlays';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import styles from './Workspaces.module.css';

interface CreateWorkspaceContext {
  readonly openCreateWorkspace: (opener: HTMLElement) => void;
  readonly defaultTriggerRef: RefObject<HTMLButtonElement | null>;
}
const Context = createContext<CreateWorkspaceContext | null>(null);

export function useCreateWorkspaceDialog(): CreateWorkspaceContext {
  const context = useContext(Context);
  if (context === null)
    throw new Error('Create workspace requires CreateWorkspaceDialogProvider.');
  return context;
}

/** One instance per authenticated shell: all openers share the dialog, not separate drafts. */
export function CreateWorkspaceDialogProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement>(null);
  const defaultTriggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const created = useRef(false);
  useLayoutEffect(() => {
    if (!open && created.current) {
      created.current = false;
      // Creating the first workspace removes the empty-state opener. Use the stable top-bar action.
      if (!returnFocusRef.current?.isConnected) defaultTriggerRef.current?.focus();
    }
  }, [open]);
  return (
    <Context.Provider
      value={{
        defaultTriggerRef,
        openCreateWorkspace: (opener) => {
          returnFocusRef.current = opener;
          setOpen(true);
        },
      }}
    >
      {children}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create workspace"
        description="A shared home for sources, documents and analyses."
        className={styles.createDialog}
        initialFocusRef={initialFocusRef}
        returnFocusRef={returnFocusRef}
      >
        {open ? (
          <CreateWorkspaceForm
            initialFocusRef={initialFocusRef}
            onCancel={() => setOpen(false)}
            onCreated={() => {
              created.current = true;
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </Context.Provider>
  );
}
