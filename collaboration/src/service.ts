import { resolveCanvas, type ResolveRequest } from './canvas.js';
import { timingSafeEqual } from 'node:crypto';
import { PresenceGuard, PresenceError } from './presence.js';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import { Backend, BackendError, accessRoom, type Access, type State } from './backend.js';
import type { Config } from './config.js';
import {prepareEmptyText} from './emptyText.js';
import {stateHash} from './snapshot.js';
import { editorSnapshot, reconstruct } from './snapshot.js';

export type Logger = (event: string, fields?: Record<string, unknown>) => void;
export const log: Logger = (event, fields = {}) => process.stdout.write(`${JSON.stringify({time: new Date().toISOString(), event, ...fields})}\n`);
interface Session { token: string; access: Access; closed?: boolean }
class AccessChanged extends Error { constructor(public readonly code: string) { super(code); } }

export function createService(config: Config, backend = new Backend(config), logger: Logger = log): Server {
  const presence = new Map<string, PresenceGuard>();
  const sequences = new Map<string, number>();
  const savedStates = new Map<string, State>();
  const queues = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const serialized = async (room: string, task: () => Promise<void>): Promise<void> => {
    const previous = queues.get(room) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    queues.set(room, current);
    try { await current; } finally { if (queues.get(room) === current) queues.delete(room); }
  };
  const revalidate = async (session: Session, room: string): Promise<void> => {
    if (session.closed) throw new AccessChanged('SESSION_CLOSED');
    if (Date.parse(session.access.expiresAt) <= Date.now()) throw new AccessChanged('ACCESS_EXPIRED');
    try { await backend.authorize(session.token, room); }
    catch (error) {
      if (error instanceof BackendError && error.code==='COLLABORATION_STATE_REPLACED') throw new AccessChanged('STATE_REPLACED');
      if (error instanceof BackendError && [401, 403, 404, 409].includes(error.status)) throw new AccessChanged('ACCESS_REVOKED');
      throw error;
    }
    if (session.closed) throw new AccessChanged('SESSION_CLOSED');
  };
  const endAccess = (session: Session, connection: {sendStateless: (payload: string) => void; close: (event: {code: number; reason: string}) => void}, code: string): void => {
    session.closed = true;
    logger('connection.access.ended', {documentId: session.access.documentId, userId: session.access.userId, code});
    if (code === 'STATE_REPLACED') connection.sendStateless(JSON.stringify({event:'stateReplaced'}));
    if (code === 'ACCESS_REVOKED') connection.sendStateless(JSON.stringify({event: 'accessRevoked'}));
    connection.close({code: code === 'ACCESS_REVOKED' ? 4403 : code === 'ACCESS_EXPIRED' ? 4401 : code === 'STATE_REPLACED' ? 4409 : 1013, reason: code});
  };
  const server = new Server({
    port: config.port, address: config.host ?? '0.0.0.0', stopOnSignals: false, quiet: true, timeout: 10000,
    maxDebounce: 1000, debounce: 500,
    async onUpgrade({request, socket}) {
      const origin = request.headers.origin;
      if ((origin && !config.allowedOrigins.includes(origin)) || new URL(request.url ?? '/', 'http://localhost').search) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        throw null;
      }
    },
    async onRequest({request, response}) {
      if (request.url === '/internal/canvas/resolve') {
        const supplied = Buffer.from(String(request.headers['x-collaboration-service-token'] ?? ''));
        const expected = Buffer.from(config.serviceToken);
        if (request.method !== 'POST' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          response.writeHead(403); response.end(); throw null;
        }
        try {
          let size = 0; const chunks: Buffer[] = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 5_500_000) throw new Error('Request too large');
            chunks.push(Buffer.from(chunk));
          }
          const result = resolveCanvas(JSON.parse(Buffer.concat(chunks).toString()) as ResolveRequest);
          response.setHeader('Content-Type','application/json');
          response.setHeader('Cache-Control','no-store');
          response.writeHead(200); response.end(JSON.stringify(result));
        } catch { response.writeHead(409); response.end('{}'); }
        throw null;
      }
      response.setHeader('Content-Type', 'application/json');
      response.writeHead(request.url === '/health' ? 200 : 404);
      response.end(JSON.stringify({status: request.url === '/health' ? 'UP' : 'NOT_FOUND'}));
      throw null; // Hocuspocus documented handled-response convention.
    },
    async onAuthenticate({token, documentName}) {
      const access = await backend.authorize(token, documentName);
      if (documentName !== accessRoom(access) || Date.parse(access.expiresAt) <= Date.now()) throw new Error('Access denied');
      logger('connection.authorized', {documentId: access.documentId, userId: access.userId});
      return {token, access} satisfies Session;
    },
    async onLoadDocument({document, documentName, context}) {
      const {token} = context as Session;
      try {
        const state = await backend.load(token, documentName);
        const restored = reconstruct(state);
        try {
          prepareEmptyText(restored);
          const encoded = Y.encodeStateAsUpdate(restored);
          const projection = editorSnapshot(restored);
          const saved = state.state === null || stateHash(encoded) !== state.stateSha256
            ? await backend.save(token, documentName, state.sequence, encoded, projection.title, projection.content)
            : state;
          Y.applyUpdate(document, Y.encodeStateAsUpdate(restored));
          sequences.set(documentName, saved.sequence);
          savedStates.set(documentName, saved);
          logger('document.loaded', {documentId: (context as Session).access.documentId, sequence: saved.sequence, initialized: state.state === null});
        } finally {restored.destroy();}
      } catch (error) {
        logger('document.load.failed', {documentId: (context as Session).access.documentId});
        throw error;
      }
      return document;
    },
    async connected({connection, context, socketId, documentName}) {
      const session = context as Session;
      const saved = savedStates.get(documentName)!;
      connection.sendStateless(JSON.stringify({event: 'persisted', sequence: saved.sequence, revision: saved.revision, savedAt: saved.savedAt}));
      let checking = false;
      const check = async (): Promise<void> => {
        if (checking || session.closed) return;
        checking = true;
        try { await revalidate(session, documentName); }
        catch (error) { endAccess(session, connection, error instanceof AccessChanged ? error.code : 'ACCESS_UNAVAILABLE'); }
        finally { checking = false; }
      };
      const timer = setInterval(() => { void check(); }, Math.min(config.recheckMs, Math.max(100, Date.parse(session.access.expiresAt) - Date.now())));
      timer.unref(); timers.set(`${socketId}:${documentName}`, timer);
    },
    // beforeSync in Hocuspocus 3 is not awaited. The awaited message hook is the durability boundary.
    async beforeHandleMessage({document, documentName, update, context, connection, socketId}) {
      const session = context as Session;
      if (update.length > 4_000_000) throw new Error('Message too large');
      await serialized(documentName, async () => {
        await revalidate(session, documentName);
        if (!document.hasConnection(connection)) throw new AccessChanged('SESSION_CLOSED');
        const reader = decoding.createDecoder(update);
        if (decoding.readVarString(reader) !== documentName) throw new Error('Room mismatch');
        const type = decoding.readVarUint(reader);
        // Only Yjs sync, awareness, awareness query and close are exposed. Stateless broadcast is not a domain API.
        if (![0, 1, 3, 4, 7].includes(type)) throw new Error('Message type denied');
        if (type === 1) {
          const guard = presence.get(documentName) ?? new PresenceGuard();
          presence.set(documentName, guard);
          const awarenessUpdate = decoding.readVarUint8Array(reader);
          guard.validate(awarenessUpdate, socketId, session.access.user, document.awareness);
          // Apply while the connection is still registered. A later duplicate from Hocuspocus is a no-op,
          // even if disconnect removed the state in between; queued frames cannot create ghost presence.
          document.applyAwarenessUpdate(connection, awarenessUpdate);
        }
        if (type !== 0 && type !== 4) return;
        const subtype = decoding.readVarUint(reader);
        if (subtype === 0) return;
        if (subtype !== 1 && subtype !== 2) throw new Error('Sync type denied');
        const delta = decoding.readVarUint8Array(reader);
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
          Y.applyUpdate(candidate, delta);
          const state = Y.encodeStateAsUpdate(candidate);
          if (Buffer.from(state).equals(Buffer.from(Y.encodeStateAsUpdate(document)))) return;
          const {title, content} = editorSnapshot(candidate);
          const saved = await backend.save(session.token, documentName, sequences.get(documentName)!, state, title, content);
          sequences.set(documentName, saved.sequence);
          savedStates.set(documentName, saved);
          // Commit happened. Applying inside the room queue also prevents concurrent candidates losing changes.
          // Hocuspocus subsequently applies the same update idempotently and acknowledges it.
          Y.applyUpdate(document, delta, connection);
          document.getConnections().forEach(peer => peer.sendStateless(JSON.stringify({event: 'persisted', sequence: saved.sequence, revision: saved.revision, savedAt: saved.savedAt})));
          logger('document.persisted', {documentId: session.access.documentId, sequence: saved.sequence});
        } finally { candidate.destroy(); }
       }).catch(error => {
        if (error instanceof BackendError && error.code==='COLLABORATION_STATE_REPLACED') error=new AccessChanged('STATE_REPLACED');
        if (error instanceof AccessChanged) {
          if (error.code === 'SESSION_CLOSED') throw {code: 1013, reason: 'SESSION_CLOSED'};
          endAccess(session, connection, error.code);
          throw {code: error.code==='STATE_REPLACED' ? 4409 : 4403, reason: error.code};
        }
        const code = error instanceof BackendError && error.transient ? 'PERSISTENCE_UNAVAILABLE'
          : error instanceof BackendError && error.status === 409 ? 'SNAPSHOT_CONFLICT'
          : error instanceof BackendError && [401,403,404].includes(error.status) ? 'ACCESS_DENIED' : 'UPDATE_REJECTED';
        logger(code === 'PERSISTENCE_UNAVAILABLE' ? 'document.persistence.failed' : 'message.rejected', {documentId: session.access.documentId, code, reason: error instanceof PresenceError ? error.message : undefined});
        connection.sendStateless(JSON.stringify({event: 'persistenceFailed', code}));
        throw {code: code === 'ACCESS_DENIED' ? 4403 : 1013, reason: code};
      });
    },
    async onDisconnect({socketId, documentName, context}) {
      const key = `${socketId}:${documentName}`;
      clearInterval(timers.get(key)); timers.delete(key);
      (context as Session).closed = true;
      presence.get(documentName)?.disconnect(socketId);
    },
    async afterUnloadDocument({documentName}) { sequences.delete(documentName); savedStates.delete(documentName); presence.delete(documentName); },
    async onDestroy() { timers.forEach(clearInterval); timers.clear(); },
  }, {maxPayload: 4_000_000});
  return server;
}
