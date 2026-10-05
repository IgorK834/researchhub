import { useEffect, useRef, useState } from 'react';
import { DocumentProvider } from './DocumentProvider';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { collaborators, type Collaborator } from './presence';
import { apiClient, CSRF_PRIMING_PATH, hasApiErrorCode } from '../../../shared/api';
import type { DocumentSummary, WorkspaceDocument } from '../api/documentApi';
import type { UseDocumentAutosave } from '../autosave/useDocumentAutosave';

interface Credential {
  user: Collaborator;
  token: string;
  room: string;
  websocketUrl: string;
  expiresAt: string;
}
/** Collaboration checkpoint returns the application snapshot, with serialized JSON content. */
interface Checkpoint {
  summary: DocumentSummary;
  content: string;
}
export interface RealtimeDocument {
  provider: HocuspocusProvider | null;
  user: Collaborator | undefined;
  participants: Collaborator[];
  accessRevoked: boolean;
  doc: Y.Doc;
  ready: boolean;
  connected: boolean;
  title: string;
  autosave: UseDocumentAutosave;
  failureDetail: string | undefined;
}
/** The server initializes the fragment exactly once. No browser seeds or replaces CRDT content. */
export function useRealtimeDocument(
  workspaceId: string,
  document: WorkspaceDocument,
  enabled: boolean,
  onCheckpoint?: (document: WorkspaceDocument) => void,
): RealtimeDocument {
  const [doc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [user, setUser] = useState<Collaborator>();
  const [participants, setParticipants] = useState<Collaborator[]>([]);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryRef = useRef<() => void>(() => {});
  const invalidTitle = useRef(false);
  const [failureDetail, setFailureDetail] = useState<string>();
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [state, setState] = useState<
    Pick<UseDocumentAutosave, 'status' | 'error' | 'revision' | 'savedAt'>
  >({
    status: 'saving',
    error: null,
    revision: document.revision,
    savedAt: document.updatedAt,
  });
  const path = `/api/workspaces/${workspaceId}/documents/${document.id}/collaboration`;
  useEffect(() => {
    if (!enabled) return;
    let revoked = false;
    let disposed = false;
    let transport: HocuspocusProvider | null = null;
    let active = false;
    let synced = false;
    let acknowledged = false;
    let pending = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const acknowledge = (): void => {
      if (
        !disposed &&
        active &&
        synced &&
        acknowledged &&
        pending === 0 &&
        !invalidTitle.current
      ) {
        setFailureDetail(undefined);
        setState((previous) => ({ ...previous, status: 'saved', error: null }));
      }
    };
    const local = new IndexeddbPersistence(
      `researchhub:${workspaceId}:${document.id}`,
      doc,
    );
    const metadata = doc.getMap('metadata');
    const updateTitle = (): void => {
      const next = metadata.get('title');
      if (typeof next === 'string') {
        invalidTitle.current = false;
        setTitle(next);
      }
    };
    metadata.observe(updateTitle);
    const revoke = (): void => {
      revoked = true;
      active = false;
      synced = false;
      acknowledged = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      setAccessRevoked(true);
      setConnected(false);
      setParticipants([]);
      transport?.disconnect();
      setFailureDetail(
        'Editing access has changed. Local changes are retained on this device.',
      );
      setState((previous) => ({
        ...previous,
        status: pending > 0 ? 'failed' : previous.status,
        error: pending > 0 ? new Error('ACCESS_REVOKED') : previous.error,
      }));
    };
    const fail = (error: unknown): void => {
      if (
        !disposed &&
        ['FORBIDDEN', 'RESOURCE_NOT_FOUND', 'CONFLICT'].some((code) =>
          hasApiErrorCode(error, code as 'FORBIDDEN'),
        )
      )
        revoke();
      if (!disposed) setState((previous) => ({ ...previous, status: 'failed', error }));
    };
    const synchronized = (value: boolean): void => {
      synced = value;
      setConnected(active && synced);
      acknowledge();
    };
    const credential = async (): Promise<Credential> => {
      await apiClient.get(CSRF_PRIMING_PATH);
      return apiClient.post<Credential>(`${path}/credential`);
    };
    void local.whenSynced
      .then(credential)
      .then((first) => {
        if (disposed || revoked) return;
        transport = new DocumentProvider({
          url: first.websocketUrl,
          name: first.room,
          document: doc,
          token: async () => {
            try {
              const next = await credential();
              if (!disposed && !revoked) setUser(next.user);
              return next.token;
            } catch (error) {
              fail(error);
              throw error;
            }
          },
          onAwarenessChange: ({ states }) => {
            if (!disposed && !revoked) setParticipants(collaborators(states));
          },
          onSynced: ({ state: synced }) => {
            if (disposed || revoked) return;
            if (synced) setReady(true);
            // Initial synchronization does not seed or replace the document.
            synchronized(synced);
          },
          onStatus: ({ status }) => {
            if (disposed || revoked) return;
            active = status === 'connected';
            setConnected(active && synced);
            if (!active) {
              acknowledged = false;
              synced = false;
              setState((previous) => ({
                ...previous,
                status: previous.status === 'failed' ? 'failed' : 'unsaved',
              }));
            }
          },
          onClose: ({ event }) => {
            if (disposed || revoked) return;
            active = false;
            synced = false;
            acknowledged = false;
            setConnected(false);
            setState((previous) => ({
              ...previous,
              status: previous.status === 'failed' ? 'failed' : 'unsaved',
            }));
            // Hocuspocus closes a document with a protocol frame while keeping the socket open.
            // A plain connect() would then do nothing. Close our dedicated socket and renew authentication.
            if (event.reason === 'ACCESS_REVOKED' || event.reason === 'ACCESS_DENIED') {
              revoke();
              return;
            }
            if (event.reason) {
              transport?.disconnect();
              clearTimeout(reconnectTimer);
              reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined;
                void Promise.resolve(transport?.connect()).catch(fail);
              }, 1000);
            }
          },
          onAuthenticationFailed: () => {
            if (disposed || revoked) return;
            active = false;
            synced = false;
            acknowledged = false;
            setConnected(false);
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
            transport?.disconnect();
            setFailureDetail(
              'Document access could not be renewed. Local changes are retained.',
            );
            fail(
              new Error(
                'Document access could not be renewed. Local changes are retained.',
              ),
            );
          },
          onUnsyncedChanges: ({ number }) => {
            pending = number;
            if (disposed || revoked) return;
            if (number > 0)
              setState((previous) => ({
                ...previous,
                status: previous.status === 'failed' ? 'failed' : 'saving',
              }));
            acknowledge();
          },
          onStateless: ({ payload }) => {
            if (disposed || revoked) return;
            let message: {
              event?: string;
              revision?: number;
              savedAt?: string;
              code?: string;
            };
            try {
              message = JSON.parse(payload);
            } catch {
              return;
            }
            if (
              message.event === 'persisted' &&
              typeof message.revision === 'number' &&
              typeof message.savedAt === 'string'
            ) {
              acknowledged = true;
              setState((previous) => ({
                ...previous,
                revision: message.revision!,
                savedAt: message.savedAt!,
              }));
              acknowledge();
            } else if (message.event === 'accessRevoked') {
              revoke();
            } else if (message.event === 'persistenceFailed') {
              acknowledged = false;
              setFailureDetail(
                message.code === 'PERSISTENCE_UNAVAILABLE'
                  ? 'The save service is unavailable. Reconnecting will retry your local changes.'
                  : 'The server could not accept these changes. Reconnect to verify access and synchronize.',
              );
              fail(new Error(message.code));
            }
          },
        });
        transport.awareness?.setLocalStateField('user', first.user);
        setUser(first.user);
        setProvider(transport);
      })
      .catch(fail);
    const warn = (event: BeforeUnloadEvent): void => {
      if (transport?.hasUnsyncedChanges) event.preventDefault();
    };
    retryRef.current = () => {
      if (revoked) return;
      if (transport) void Promise.resolve(transport.connect()).catch(fail);
      else setAttempt((previous) => previous + 1);
    };
    const online = (): void => {
      if (!revoked) retryRef.current();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('online', online);
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      metadata.unobserve(updateTitle);
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('online', online);
      transport?.destroy();
      void local.destroy();
    };
  }, [doc, enabled, path, workspaceId, document.id, attempt]);
  return {
    provider,
    user,
    accessRevoked,
    participants: connected ? participants : [],
    doc,
    ready,
    connected,
    title,
    failureDetail,
    autosave: {
      ...state,
      blocked: accessRevoked || !ready || !connected || !title.trim(),
      edit: (draft) => {
        if (accessRevoked) return;
        invalidTitle.current = !draft.title.trim();
        setTitle(draft.title);
        if (!draft.title.trim())
          setState((previous) => ({ ...previous, status: 'unsaved' }));
        if (draft.title.trim()) doc.getMap('metadata').set('title', draft.title);
      },
      saveNow: () => {
        if (
          accessRevoked ||
          !ready ||
          !connected ||
          !title.trim() ||
          provider?.hasUnsyncedChanges
        )
          return;
        void apiClient
          .post<Checkpoint>(`${path}/checkpoint`)
          .then((stored) =>
            onCheckpoint?.({ ...stored.summary, content: JSON.parse(stored.content) }),
          )
          .catch((error) =>
            setState((previous) => ({ ...previous, status: 'failed', error })),
          );
      },
      retry: () => retryRef.current(),
    },
  };
}
