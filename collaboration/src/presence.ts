import * as decoding from 'lib0/decoding';
import type { Awareness } from 'y-protocols/awareness';

export class PresenceError extends Error {}
export interface Presence { userId: string; displayName: string; colorId: string }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): boolean => value == null || (record(value) && keys(value, ['client', 'clock']) && integer(value.client) && integer(value.clock));
const position = (value: unknown): boolean => record(value) && keys(value, ['type', 'tname', 'item', 'assoc']) && id(value.type) && id(value.item)
  && (value.tname == null || value.tname === 'default') && (value.assoc === undefined || (Number.isSafeInteger(value.assoc) && Math.abs(value.assoc as number) <= 1));
function validState(state: unknown, user: Presence): boolean {
  if (state === null) return true;
  if (!record(state) || !keys(state, ['user', 'cursor'])) return false;
  if (state.user !== undefined && (!record(state.user) || Object.keys(state.user).length !== 3 || !keys(state.user, ['userId', 'displayName', 'colorId'])
    || state.user.userId !== user.userId || state.user.displayName !== user.displayName || state.user.colorId !== user.colorId)) return false;
  return state.cursor == null || (state.user !== undefined && record(state.cursor) && Object.keys(state.cursor).length === 2
    && keys(state.cursor, ['anchor', 'head']) && position(state.cursor.anchor) && position(state.cursor.head));
}

/** Validate before Hocuspocus broadcasts. One awareness client belongs to one authenticated connection.
 * Providers echo remote frames; only stale/no-op echoes are allowed, never a remote removal or newer clock.
 * This registry and Awareness live only in memory, independently of the persisted Y.Doc.
 */
export class PresenceGuard {
  private owners = new Map<number, string>();
  private clients = new Map<string, number>();
  validate(payload: Uint8Array, connectionId: string, user: Presence, awareness: Awareness): void {
    if (payload.length > 16_384) throw new PresenceError('Presence too large');
    const reader = decoding.createDecoder(payload);
    const count = decoding.readVarUint(reader);
    if (count > 64) throw new PresenceError('Too many presence states');
    let client = this.clients.get(connectionId);
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(reader), clock = decoding.readVarUint(reader);
      const state: unknown = JSON.parse(decoding.readVarString(reader));
      if (!integer(clientId) || clientId > 0xffffffff || !integer(clock)) throw new PresenceError('Invalid presence clock');
      const owner = this.owners.get(clientId);
      if (owner === connectionId || (owner === undefined && client === undefined && state !== null)) {
        if (!validState(state, user)) throw new PresenceError('Invalid presence state');
        client = clientId;
      } else {
        const meta = awareness.meta.get(clientId);
        if (!meta || clock > meta.clock || (clock === meta.clock && state === null && awareness.getStates().has(clientId)))
          throw new PresenceError('Presence client is owned by another connection');
      }
    }
    if (decoding.hasContent(reader)) throw new PresenceError('Unexpected presence payload');
    if (client !== undefined) { this.owners.set(client, connectionId); this.clients.set(connectionId, client); }
  }
  disconnect(connectionId: string): void {
    const client = this.clients.get(connectionId);
    if (client !== undefined && this.owners.get(client) === connectionId) this.owners.delete(client);
    this.clients.delete(connectionId);
  }
}
