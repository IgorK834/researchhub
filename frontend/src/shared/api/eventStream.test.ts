import { readEventStream } from './eventStream';
import { requestEventStream } from './apiClient';
import { ApiError, ApiTransportError } from './apiError';

function stream(
  chunks: readonly Uint8Array[],
  contentType: string | null = 'text/event-stream',
) {
  let index = 0;
  const reader = {
    read: jest.fn(async () =>
      index < chunks.length
        ? { done: false, value: chunks[index++] }
        : { done: true, value: undefined },
    ),
    cancel: jest.fn(async () => undefined),
    releaseLock: jest.fn(),
  };
  const response = {
    headers: { get: () => contentType },
    body: { getReader: () => reader },
  } as unknown as Response;
  return { response, reader };
}
it('handles split UTF-8, CRLF, comments and multiline JSON without losing events', async () => {
  const text =
    ': keepalive\r\n\r\nevent:delta\r\nid:1\r\ndata:{"text":\r\ndata: "中文 😀"}\r\nretry: 200\r\n\r\ndata: {"done":true}\n\n';
  const bytes = new TextEncoder().encode(text);
  const { response, reader } = stream([...bytes].map((byte) => new Uint8Array([byte])));
  const events: unknown[] = [];
  await readEventStream(response, (event) => {
    events.push(event);
    return true;
  });
  expect(events).toEqual([
    { event: 'delta', id: '1', data: { text: '中文 😀' } },
    { event: 'message', id: null, data: { done: true } },
  ]);
  expect(reader.cancel).toHaveBeenCalled();
  expect(reader.releaseLock).toHaveBeenCalled();
});
it('stops reading on the terminal event and cleans up the reader', async () => {
  const { response, reader } = stream([
    new TextEncoder().encode('event: completed\ndata: {}\n\n'),
    new Uint8Array([1]),
  ]);
  await readEventStream(response, () => false);
  expect(reader.read).toHaveBeenCalledTimes(1);
  expect(reader.cancel).toHaveBeenCalledTimes(1);
});
it.each(['data: {bad}\n\n', 'event:delta\ndata: {}', 'data: {}\nno-colon\n\ntrailing'])(
  'rejects malformed or truncated frames: %s',
  async (text) => {
    const { response } = stream([new TextEncoder().encode(text)]);
    await expect(readEventStream(response, () => true)).rejects.toBeInstanceOf(
      ApiTransportError,
    );
  },
);
it('rejects invalid encoding, missing SSE bodies and bounded event/stream overflows', async () => {
  await expect(
    readEventStream(stream([new Uint8Array([255])]).response, () => true),
  ).rejects.toBeInstanceOf(ApiTransportError);
  await expect(
    readEventStream(stream([], null).response, () => true),
  ).rejects.toBeInstanceOf(ApiTransportError);
  const missing = stream([]).response;
  Object.assign(missing, { body: null });
  await expect(readEventStream(missing, () => true)).rejects.toBeInstanceOf(
    ApiTransportError,
  );
  await expect(
    readEventStream(
      stream([new TextEncoder().encode('x'.repeat(1024 * 1024 + 1))]).response,
      () => true,
    ),
  ).rejects.toBeInstanceOf(ApiTransportError);
  const large = new TextEncoder().encode(':' + 'x'.repeat(900000) + '\n\n');
  await expect(
    readEventStream(stream([large, large, large, large, large]).response, () => true),
  ).rejects.toBeInstanceOf(ApiTransportError);
});
it('propagates reader failures and closes its resources', async () => {
  const { response, reader } = stream([]);
  reader.read.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
  await expect(readEventStream(response, () => true)).rejects.toHaveProperty(
    'name',
    'AbortError',
  );
  expect(reader.releaseLock).toHaveBeenCalled();
});
it('maps a dropped connection to a retryable transport failure and closes its reader', async () => {
  const { response, reader } = stream([]);
  reader.read.mockRejectedValueOnce(new TypeError('Network interrupted'));
  reader.cancel.mockRejectedValueOnce(new Error('Reader already closed'));
  await expect(readEventStream(response, () => true)).rejects.toBeInstanceOf(
    ApiTransportError,
  );
  expect(reader.releaseLock).toHaveBeenCalled();
});
it('shares ordinary HTTP error policy and rejects multipart stream input', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not found',
    headers: { get: () => 'application/problem+json' },
    text: async () =>
      JSON.stringify({
        status: 404,
        title: 'Missing',
        code: 'RESOURCE_NOT_FOUND',
        detail: 'Missing',
      }),
  });
  try {
    await expect(
      requestEventStream('/api/test', { body: {} }, () => true),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      requestEventStream('/api/test', { formData: new FormData() }, () => true),
    ).rejects.toBeInstanceOf(TypeError);
  } finally {
    globalThis.fetch = original;
  }
});
