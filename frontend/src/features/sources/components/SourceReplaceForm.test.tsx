/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SourceReplaceForm } from './SourceReplaceForm';

const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function view() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <SourceReplaceForm workspaceId="w" sourceId="s" />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

function choose(file: File): HTMLInputElement {
  const input = screen.getByLabelText('Replacement file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  document.cookie = 'XSRF-TOKEN=; Max-Age=0';
});

it('says that existing analyses keep their original bytes before anything is uploaded', () => {
  view();
  expect(
    screen.getByText('Existing analyses keep their original version and bytes.'),
  ).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Upload new version' })).not.toBeNull();
});

it('asks for a file and refuses an unsupported one without calling the server', () => {
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
  view();

  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }));
  expect(screen.getByRole('alert').textContent).toBe('Choose a replacement file');

  choose(new File(['x'], 'run.exe', { type: 'application/octet-stream' }));
  expect(screen.getByRole('alert').textContent).toContain('not supported');
  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }));
  expect(globalThis.fetch).not.toHaveBeenCalled();

  const cleared = screen.getByLabelText('Replacement file') as HTMLInputElement;
  Object.defineProperty(cleared, 'files', { value: [], configurable: true });
  fireEvent.change(cleared);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('uploads the replacement, announces the new version and refreshes the dependent queries', async () => {
  const calls: string[] = [];
  globalThis.fetch = jest.fn((url: unknown, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    return Promise.resolve(
      String(url).endsWith('/csrf')
        ? json(undefined, 204)
        : json({ id: 's', activeVersionNumber: 3, activeVersionId: 'v3' }),
    );
  }) as unknown as typeof fetch;
  const { client, invalidate } = view();

  choose(new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }));

  expect((await screen.findByRole('status')).textContent).toBe('Version 3 was uploaded.');
  expect(calls).toContain('POST /api/workspaces/w/sources/s/versions');
  expect(client.getQueryData(['sources', 'w', 's'])).toMatchObject({
    activeVersionNumber: 3,
  });
  const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
  expect(keys).toEqual(
    expect.arrayContaining([
      JSON.stringify(['sources', 'w']),
      JSON.stringify(['sources', 'w', 's', 'versions']),
      JSON.stringify(['analysis', 'w', 'datasets', 's', 'active']),
    ]),
  );
  expect((screen.getByLabelText('Replacement file') as HTMLInputElement).value).toBe('');
});

it('shows why an upload was refused', async () => {
  globalThis.fetch = jest.fn((url: unknown) =>
    Promise.resolve(
      String(url).endsWith('/csrf')
        ? json(undefined, 204)
        : json(
            {
              title: 'Conflict',
              detail: 'Source processing is already in progress',
              status: 409,
              code: 'CONFLICT',
            },
            409,
          ),
    ),
  ) as unknown as typeof fetch;
  view();

  choose(new File(['a'], 'data.csv', { type: 'text/csv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }));

  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'Source processing is already in progress',
    ),
  );
});

it('disables the form while the upload is in flight', async () => {
  let finish!: (value: Response) => void;
  globalThis.fetch = jest.fn((url: unknown) =>
    String(url).endsWith('/csrf')
      ? Promise.resolve(json(undefined, 204))
      : new Promise<Response>((done) => {
          finish = done;
        }),
  ) as unknown as typeof fetch;
  view();

  choose(new File(['a'], 'data.csv', { type: 'text/csv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Upload new version' }));

  const busy = (await screen.findByRole('button', {
    name: 'Uploading version…',
  })) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  expect((screen.getByLabelText('Replacement file') as HTMLInputElement).disabled).toBe(
    true,
  );
  finish(json({ id: 's', activeVersionNumber: 2 }));
  await screen.findByText('Version 2 was uploaded.');
});
