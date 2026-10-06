import { randomUUID } from 'node:crypto';
import type { Presence } from './presence.js';
import type { Config } from './config.js';
export interface Access { workspaceId: string; documentId: string; userId: string; expiresAt: string; user: Presence; epoch?: number }
export interface State { sequence: number; state: string | null; title: string; content: string; revision: number; savedAt: string; stateSha256: string | null }
export class BackendError extends Error {
  constructor(public readonly status: number, public readonly transient: boolean, public readonly code?: string) {
    super(transient ? 'Collaboration persistence unavailable' : 'Collaboration request denied');
  }
}
export class Backend {
  constructor(private readonly config: Config) {}
  async call<T>(path: string, body: unknown): Promise<T> {
    try {
      const response = await fetch(`${this.config.backendUrl}/internal/collaboration/${path}`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-Collaboration-Service-Token': this.config.serviceToken},
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const problem=await response.json().catch(() => ({})) as {code?: string};
        throw new BackendError(response.status,response.status>=500,problem.code);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(0, true); // Transport/response failure can occur after commit.
    }
  }
  authorize(token: string, room: string): Promise<Access> { return this.call('authorize', {token, room}); }
  load(token: string, room: string): Promise<State> { return this.call('load', {token, room}); }
  async save(token: string, room: string, sequence: number, state: Uint8Array, title: string, content: unknown): Promise<State> {
    const body = {token, sequence, snapshotId: randomUUID(), state: Buffer.from(state).toString('base64'), title, content: JSON.stringify(content)};
    const path = `rooms/${encodeURIComponent(room)}/snapshot`;
    try { return await this.call(path, body); }
    catch (error) {
      if (!(error instanceof BackendError) || !error.transient) throw error;
      // One bounded retry, with an unchanged identity/body. Spring returns the previous receipt after lost responses.
      return await this.call(path, body);
    }
  }
}

export const accessRoom = (access: Access): string => `document:${access.documentId}${access.epoch ? `:${access.epoch}` : ''}`;
