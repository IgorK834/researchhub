/** @jest-environment jsdom */
import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { DocumentProvider } from './DocumentProvider';
it('publishes only the local awareness client, including its removal, and ignores remote cleanup/echoes', () => {
  const socket = new HocuspocusProviderWebsocket({
    url: 'ws://localhost:8091',
    autoConnect: false,
  });
  const doc = new Y.Doc();
  const provider = new DocumentProvider({
    name: 'document:temporary',
    document: doc,
    websocketProvider: socket,
  });
  const send = jest.spyOn(provider, 'send').mockImplementation(() => {});
  provider.awarenessUpdateHandler(
    { added: [doc.clientID, 123], updated: [456], removed: [789] },
    null,
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![1].clients).toEqual([doc.clientID]);
  send.mockClear();
  provider.awarenessUpdateHandler(
    { added: [123], updated: [456], removed: [789] },
    provider,
  );
  expect(send).not.toHaveBeenCalled();
  provider.awarenessUpdateHandler(
    { added: [], updated: [doc.clientID], removed: [] },
    null,
  );
  provider.awarenessUpdateHandler(
    { added: [], updated: [], removed: [doc.clientID] },
    null,
  );
  expect(send.mock.calls.map((call) => call[1].clients)).toEqual([
    [doc.clientID],
    [doc.clientID],
  ]);
  provider.destroy();
  socket.destroy();
  doc.destroy();
});
