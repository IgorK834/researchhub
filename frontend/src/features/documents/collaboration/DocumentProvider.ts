import { HocuspocusProvider } from '@hocuspocus/provider';

/** Hocuspocus 3 echoes remote removals when it clears awareness on disconnect.
 * Publish only our own Yjs client; the server still enforces identity/ownership for untrusted clients.
 */
export class DocumentProvider extends HocuspocusProvider {
  override awarenessUpdateHandler(
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void {
    const own = (client: number): boolean => client === this.document.clientID;
    const local = {
      added: changes.added.filter(own),
      updated: changes.updated.filter(own),
      removed: changes.removed.filter(own),
    };
    if (local.added.length + local.updated.length + local.removed.length > 0)
      super.awarenessUpdateHandler(local, origin);
  }
}
