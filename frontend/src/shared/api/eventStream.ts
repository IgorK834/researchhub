import { ApiTransportError } from './apiError';

export interface ServerEvent {
  readonly event: string;
  readonly id: string | null;
  readonly data: unknown;
}

/** Bounded UTF-8 SSE parser. Returning false from onEvent closes this one-way request. */
export async function readEventStream(
  response: Response,
  onEvent: (event: ServerEvent) => boolean,
): Promise<void> {
  if (
    !response.headers.get('content-type')?.includes('text/event-stream') ||
    response.body === null
  ) {
    throw new ApiTransportError('The server did not return a research event stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let received = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === 'AbortError')
          throw failure;
        throw new ApiTransportError(
          'The research connection was interrupted. Reload history before retrying.',
          { cause: failure },
        );
      }
      received += chunk.value?.byteLength ?? 0;
      if (received > 4 * 1024 * 1024)
        throw new ApiTransportError('The research stream exceeded its size limit');
      try {
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      } catch {
        throw new ApiTransportError('The research stream contained invalid text');
      }
      if (buffer.length > 1024 * 1024)
        throw new ApiTransportError('A research event exceeded its size limit');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let name = 'message';
        let id: string | null = null;
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith(':')) continue;
          const separator = line.indexOf(':');
          const field = separator < 0 ? line : line.slice(0, separator);
          const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
          if (field === 'event') name = value;
          if (field === 'id') id = value;
          if (field === 'data') data.push(value);
        }
        if (data.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.join('\n'));
        } catch {
          throw new ApiTransportError('The server returned a malformed research event');
        }
        if (!onEvent({ event: name, id, data: parsed })) return;
      }
      if (chunk.done) {
        if (buffer.trim())
          throw new ApiTransportError('The research stream ended inside an event');
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
