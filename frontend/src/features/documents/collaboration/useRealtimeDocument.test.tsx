/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useRealtimeDocument } from './useRealtimeDocument';
import { apiClient } from '../../../shared/api';
import { ApiError } from '../../../shared/api/apiError';
import type { WorkspaceDocument } from '../api/documentApi';
import type { HocuspocusProviderConfiguration } from '@hocuspocus/provider';
let mockOptions: HocuspocusProviderConfiguration;
const mockDestroy = jest.fn();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
let mockUnsynced = false;
jest.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: jest.fn().mockImplementation((options) => {
    mockOptions = options;
    return {
      awareness: { setLocalStateField: jest.fn() },
      destroy: mockDestroy,
      connect: mockConnect,
      disconnect: mockDisconnect,
      get hasUnsyncedChanges() {
        return mockUnsynced;
      },
    };
  }),
}));
jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: jest
    .fn()
    .mockImplementation(() => ({ whenSynced: Promise.resolve(), destroy: jest.fn() })),
}));
jest.mock('../../../shared/api', () => ({
  hasApiErrorCode: jest.requireActual('../../../shared/api').hasApiErrorCode,
  apiClient: { get: jest.fn(), post: jest.fn() },
  CSRF_PRIMING_PATH: '/api/auth/csrf',
}));
const document: WorkspaceDocument = {
  id: 'document',
  title: 'Report',
  content: { type: 'doc' },
  contentFormat: 'PROSEMIRROR_JSON',
  revision: 1,
  createdAt: 'now',
  updatedAt: 'stored-time',
  archivedAt: null,
};
const credential = {
  user: { userId: 'user', displayName: 'Author', colorId: 'blue' },
  token: 'opaque',
  room: 'document:document',
  websocketUrl: 'ws://localhost:8091',
  expiresAt: 'later',
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUnsynced = false;
  jest.mocked(apiClient.get).mockResolvedValue({});
  jest.mocked(apiClient.post).mockResolvedValue(credential);
});
it('gets a scoped token, binds title, tracks durable acknowledgements and checkpoints', async () => {
  const { result, unmount } = renderHook(() =>
    useRealtimeDocument('workspace', document, true),
  );
  await waitFor(() => expect(mockOptions).toBeDefined());
  expect(mockOptions.name).toBe('document:document');
  await act(async () => {
    expect(await (mockOptions.token as () => Promise<string>)()).toBe('opaque');
  });
  act(() => {
    mockOptions.onSynced!({ state: true });
    mockOptions.onStatus!({ status: 'connected' as never });
  });
  expect(result.current.ready).toBe(true);
  act(() =>
    result.current.autosave.edit({ title: 'Shared title', content: { type: 'doc' } }),
  );
  expect(result.current.title).toBe('Shared title');
  act(() => mockOptions.onUnsyncedChanges!({ number: 1 }));
  expect(result.current.autosave.status).toBe('saving');
  act(() => {
    mockOptions.onStateless!({
      payload: JSON.stringify({
        event: 'persisted',
        revision: 4,
        savedAt: 'server-time',
      }),
    });
    mockOptions.onUnsyncedChanges!({ number: 0 });
  });
  expect(result.current.autosave.revision).toBe(4);
  expect(result.current.autosave.savedAt).toBe('server-time');
  jest.mocked(apiClient.post).mockResolvedValueOnce({
    summary: document,
    content: JSON.stringify(document.content),
  });
  act(() => result.current.autosave.saveNow());
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/workspaces/workspace/documents/document/collaboration/checkpoint',
  );
  act(() => result.current.autosave.retry());
  expect(mockConnect).toHaveBeenCalled();
  unmount();
  expect(mockDestroy).toHaveBeenCalled();
});
it('retains unsaved state on disconnection, reports denied access and checkpoint failures', async () => {
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  act(() => mockOptions.onStatus!({ status: 'disconnected' as never }));
  expect(result.current.autosave.status).toBe('unsaved');
  act(() => result.current.autosave.saveNow());
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  act(() => mockOptions.onAuthenticationFailed!({ reason: 'denied' }));
  expect(result.current.autosave.status).toBe('failed');
  act(() => {
    mockOptions.onStatus!({ status: 'connected' as never });
    mockOptions.onSynced!({ state: true });
  });
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('checkpoint unavailable'));
  act(() => result.current.autosave.saveNow());
  await waitFor(() =>
    expect(result.current.autosave.error).toEqual(new Error('checkpoint unavailable')),
  );
  mockUnsynced = true;
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
it('does not open a transport for viewers or a disabled deployment and reports credential errors', async () => {
  const disabled = renderHook(() => useRealtimeDocument('workspace', document, false));
  expect(apiClient.post).not.toHaveBeenCalled();
  disabled.unmount();
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('denied'));
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(result.current.autosave.status).toBe('failed'));
});
it('ignores blank metadata and unknown notifications and waits for initial synchronization', async () => {
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  act(() => result.current.autosave.retry());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  act(() => {
    mockOptions.onSynced!({ state: false });
    result.current.doc.getMap('metadata').set('title', 3);
    result.current.autosave.edit({ title: ' ', content: { type: 'doc' } });
    mockOptions.onStateless!({ payload: JSON.stringify({ event: 'other' }) });
  });
  expect(result.current.title).toBe(' ');
  expect(result.current.doc.getMap('metadata').get('title')).toBe(3);
  expect(result.current.ready).toBe(false);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  act(() => {
    mockOptions.onStatus!({ status: 'connected' as never });
    mockOptions.onSynced!({ state: true });
  });
  mockUnsynced = true;
  act(() => result.current.autosave.saveNow());
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
it('does not create a transport if credential retrieval finishes after unmount', async () => {
  let resolve!: (value: unknown) => void;
  jest.mocked(apiClient.post).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { unmount } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  unmount();
  await act(async () => {
    resolve(credential);
  });
  expect(mockDestroy).not.toHaveBeenCalled();
});

it('reports persistence failures until a connected, synced durable acknowledgement arrives', async () => {
  const checkpoint = jest.fn();
  const { result } = renderHook(() =>
    useRealtimeDocument('workspace', document, true, checkpoint),
  );
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  act(() => {
    mockOptions.onStatus!({ status: 'connected' as never });
    mockOptions.onSynced!({ state: true });
    mockOptions.onStateless!({
      payload: JSON.stringify({
        event: 'persistenceFailed',
        code: 'PERSISTENCE_UNAVAILABLE',
      }),
    });
    mockOptions.onStatus!({ status: 'disconnected' as never });
    mockOptions.onUnsyncedChanges!({ number: 0 });
  });
  expect(result.current.autosave.status).toBe('failed');
  expect(result.current.failureDetail).toContain('unavailable');
  act(() => {
    mockOptions.onStateless!({ payload: 'malformed' });
    mockOptions.onStateless!({
      payload: JSON.stringify({ event: 'persistenceFailed', code: 'UPDATE_REJECTED' }),
    });
    mockOptions.onStatus!({ status: 'connected' as never });
    mockOptions.onSynced!({ state: true });
    mockOptions.onStateless!({
      payload: JSON.stringify({ event: 'persisted', revision: 5, savedAt: 'durable' }),
    });
  });
  expect(result.current.autosave.status).toBe('saved');
  expect(result.current.failureDetail).toBeUndefined();
  jest.mocked(apiClient.post).mockResolvedValueOnce({
    summary: document,
    content: JSON.stringify(document.content),
  });
  act(() => result.current.autosave.saveNow());
  await waitFor(() => expect(checkpoint).toHaveBeenCalledWith(document));
});
it('retries initial credential failures through the explicit action and online event', async () => {
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('temporarily unavailable'));
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(result.current.autosave.status).toBe('failed'));
  act(() => result.current.autosave.retry());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  act(() => window.dispatchEvent(new Event('online')));
  expect(mockConnect).toHaveBeenCalled();
});

it('reopens the physical socket after a Hocuspocus document close and retains the failed buffer', async () => {
  const { result, unmount } = renderHook(() =>
    useRealtimeDocument('workspace', document, true),
  );
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  jest.useFakeTimers();
  act(() => {
    mockOptions.onStateless!({
      payload: JSON.stringify({
        event: 'persistenceFailed',
        code: 'PERSISTENCE_UNAVAILABLE',
      }),
    });
    mockOptions.onClose!({ event: { reason: 'PERSISTENCE_UNAVAILABLE' } as CloseEvent });
  });
  expect(mockDisconnect).toHaveBeenCalled();
  expect(result.current.connected).toBe(false);
  expect(result.current.autosave.status).toBe('failed');
  act(() => jest.advanceTimersByTime(1000));
  expect(mockConnect).toHaveBeenCalled();
  act(() => mockOptions.onClose!({ event: { reason: '' } as CloseEvent }));
  unmount();
  jest.useRealTimers();
});

it('keeps the editor disconnected until sync and stops the socket after authorization renewal fails', async () => {
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  act(() => mockOptions.onStatus!({ status: 'connected' as never }));
  expect(result.current.connected).toBe(false);
  act(() => mockOptions.onSynced!({ state: true }));
  expect(result.current.connected).toBe(true);
  act(() => mockOptions.onAuthenticationFailed!({ reason: 'membership removed' }));
  expect(result.current.connected).toBe(false);
  expect(mockDisconnect).toHaveBeenCalled();
  expect(result.current.autosave.blocked).toBe(true);
});

it('tracks ephemeral participants and stops reconnecting or sending edits after access is revoked', async () => {
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(result.current.provider).not.toBeNull());
  act(() => {
    mockOptions.onStatus!({ status: 'connected' as never });
    mockOptions.onSynced!({ state: true });
    mockOptions.onAwarenessChange!({
      states: [
        { clientId: 1, user: credential.user },
        { clientId: 2, user: { userId: 'peer', displayName: 'Peer', colorId: 'coral' } },
      ],
    });
  });
  expect(result.current.participants).toHaveLength(2);
  act(() => {
    mockOptions.onUnsyncedChanges!({ number: 1 });
    mockOptions.onStateless!({ payload: JSON.stringify({ event: 'accessRevoked' }) });
  });
  expect(result.current.accessRevoked).toBe(true);
  expect(result.current.connected).toBe(false);
  expect(result.current.participants).toEqual([]);
  expect(result.current.autosave.status).toBe('failed');
  act(() => {
    result.current.autosave.edit({ title: 'Rejected', content: { type: 'doc' } });
    result.current.autosave.saveNow();
    result.current.autosave.retry();
    window.dispatchEvent(new Event('online'));
    mockOptions.onSynced!({ state: true });
    mockOptions.onStatus!({ status: 'connected' as never });
  });
  expect(result.current.doc.getMap('metadata').get('title')).toBeUndefined();
  expect(mockConnect).not.toHaveBeenCalled();
});
it('recognizes protocol revocation without retrying and preserves a saved checkpoint', async () => {
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(result.current.provider).not.toBeNull());
  act(() => mockOptions.onClose!({ event: { reason: 'ACCESS_REVOKED' } as CloseEvent }));
  expect(result.current.accessRevoked).toBe(true);
  expect(mockDisconnect).toHaveBeenCalled();
  expect(mockConnect).not.toHaveBeenCalled();
});

it('isolates restored epochs from earlier IndexedDB updates and stops an offline replica on token renewal', async () => {
  jest
    .mocked(apiClient.post)
    .mockResolvedValue({ ...credential, room: 'document:document:2' });
  const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
  await waitFor(() => expect(mockOptions.name).toBe('document:document:2'));
  expect(IndexeddbPersistence).toHaveBeenCalledWith(
    'researchhub:workspace:document:epoch:2',
    result.current.doc,
  );
  jest
    .mocked(apiClient.post)
    .mockResolvedValueOnce({ ...credential, room: 'document:document:3' });
  await act(async () => {
    await expect((mockOptions.token as () => Promise<string>)()).rejects.toThrow(
      'STATE_REPLACED',
    );
  });
  expect(result.current.stateReplaced).toBe(true);
  expect(result.current.accessRevoked).toBe(true);
  expect(result.current.connected).toBe(false);
  expect(mockDisconnect).toHaveBeenCalled();
});
it.each(['stateless', 'close', 'api'])(
  'recognizes a restored state through %s without reconnecting its old CRDT',
  async (signal) => {
    const { result } = renderHook(() => useRealtimeDocument('workspace', document, true));
    await waitFor(() => expect(IndexeddbPersistence).toHaveBeenCalled());
    act(() => {
      if (signal === 'stateless')
        mockOptions.onStateless!({ payload: JSON.stringify({ event: 'stateReplaced' }) });
      if (signal === 'close')
        mockOptions.onClose!({ event: { reason: 'STATE_REPLACED' } as CloseEvent });
    });
    if (signal === 'api') {
      const failure = new ApiError({
        type: 'about:blank',
        status: 409,
        code: 'COLLABORATION_STATE_REPLACED',
        rawCode: 'COLLABORATION_STATE_REPLACED',
        title: 'Restored',
        detail: 'Load new state',
      });
      jest.mocked(apiClient.post).mockRejectedValueOnce(failure);
      await act(async () => {
        await expect((mockOptions.token as () => Promise<string>)()).rejects.toBe(
          failure,
        );
      });
    }
    expect(result.current.stateReplaced).toBe(true);
    expect(result.current.participants).toEqual([]);
  },
);
