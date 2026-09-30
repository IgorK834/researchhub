/**
 * @jest-environment jsdom
 */
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DocumentDetailPage } from './DocumentDetailPage';
import { WorkspaceDetailPage } from './WorkspaceDetailPage';

jest.mock('../features/documents/autosave/autosaveTiming', () => ({
  AUTOSAVE_TIMING: { debounceMs: 30, maxWaitMs: 300 },
}));

/**
 * The report-writing path through the real routes, against an in-memory backend: an editor creates a report,
 * writes in it, leaves, comes back, and finds what they wrote. No router mocks — navigation is the router's own,
 * so a link or a redirect that pointed somewhere wrong would fail here.
 */

const WORKSPACE_ID = 'w-1';

interface StoredDocument {
  id: string;
  title: string;
  contentFormat: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  content: unknown;
}

function json(body: unknown, status = 200): Response {
  const payload = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: () => Promise.resolve(payload),
  } as unknown as Response;
}

function noContent(): Response {
  return {
    ok: true,
    status: 204,
    statusText: '',
    headers: { get: () => null },
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

/** Documents live here between page visits, exactly as they would in the database. */
function stubBackend(role: string): { documents: StoredDocument[] } {
  const documents: StoredDocument[] = [];
  const documentsPath = `/api/workspaces/${WORKSPACE_ID}/documents`;

  globalThis.fetch = jest.fn((url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';

    if (path === `/api/workspaces/${WORKSPACE_ID}/ai/conversations?offset=0`) {
      return Promise.resolve(json({ items: [], nextOffset: null }));
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/sources`) {
      return Promise.resolve(json([]));
    }
    const body =
      init?.body === undefined
        ? undefined
        : (JSON.parse(String(init.body)) as Record<string, unknown>);

    if (path === '/api/auth/csrf') {
      return Promise.resolve(noContent());
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}`) {
      return Promise.resolve(
        json({
          id: WORKSPACE_ID,
          name: 'Electronics Lab',
          description: null,
          role,
          createdAt: '2026-09-24T09:00:00Z',
          updatedAt: '2026-09-24T09:00:00Z',
          archivedAt: null,
        }),
      );
    }
    if (path === `/api/workspaces/${WORKSPACE_ID}/members`) {
      return Promise.resolve(json([]));
    }
    if (path === documentsPath && method === 'GET') {
      return Promise.resolve(
        json(documents.map(({ content: _content, ...summary }) => summary)),
      );
    }
    if (path === documentsPath && method === 'POST') {
      const created: StoredDocument = {
        id: `d-${String(documents.length + 1)}`,
        title: String(body?.['title']),
        contentFormat: 'PROSEMIRROR_JSON',
        revision: 1,
        createdAt: '2026-09-24T09:00:00Z',
        updatedAt: '2026-09-24T09:00:00Z',
        archivedAt: null,
        content: body?.['content'],
      };
      documents.push(created);
      return Promise.resolve(json(created, 201));
    }
    const match = new RegExp(`^${documentsPath}/([^/]+)(/versions)?$`).exec(path);
    const stored = documents.find((document) => document.id === match?.[1]);
    if (match !== null && match[2] !== undefined) {
      return Promise.resolve(json([]));
    }
    if (stored !== undefined && method === 'GET') {
      return Promise.resolve(json(stored));
    }
    if (stored !== undefined && method === 'PATCH') {
      stored.title = String(body?.['title']);
      stored.content = body?.['content'];
      stored.revision += 1;
      return Promise.resolve(json(stored));
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  }) as unknown as typeof fetch;

  return { documents };
}

function renderApp(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/workspaces/${WORKSPACE_ID}`]}>
        <Routes>
          <Route path="/app/workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route
            path="/app/workspaces/:workspaceId/documents/:documentId"
            element={<DocumentDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(app as ReactElement);
}

function bodyEditor(): Editor {
  const element = screen.getByRole('textbox', { name: 'Text' }) as HTMLElement & {
    editor?: Editor;
  };
  if (element.editor === undefined) {
    throw new Error('The document body is not a Tiptap editor');
  }
  return element.editor;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('writing a report in a workspace', () => {
  it('creates a report, writes in it, leaves, reopens it, and finds the text', async () => {
    const backend = stubBackend('EDITOR');
    renderApp();

    // Create from the workspace page: the new report opens straight away.
    fireEvent.change(await screen.findByLabelText('Document title'), {
      target: { value: 'Lab report' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lab report' }),
    ).not.toBeNull();

    // Write, and let autosave store it.
    await screen.findByRole('textbox', { name: 'Text' });
    act(() => {
      bodyEditor().commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Results' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'The circuit resonates at 1 kHz.' }],
          },
        ],
      });
    });
    await waitFor(() => {
      const states = screen.getAllByRole('status').map((element) => element.textContent);
      expect(states.some((state) => state?.startsWith('Saved'))).toBe(true);
    });

    // Leave for the workspace, then reopen the report from its list.
    fireEvent.click(screen.getByRole('link', { name: 'Back to the workspace' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Electronics Lab' }),
    ).not.toBeNull();
    const documentsSection = screen.getByRole('region', { name: 'Documents' });
    fireEvent.click(
      await within(documentsSection).findByRole('link', { name: 'Lab report' }),
    );

    const body = await screen.findByRole('textbox', { name: 'Text' });
    await waitFor(() => {
      expect(body.querySelector('h2')?.textContent).toBe('Results');
    });
    expect(body.textContent).toContain('The circuit resonates at 1 kHz.');
    expect(backend.documents[0]?.revision).toBe(2);
  });

  it('keeps typing that was still waiting for autosave when the editor left', async () => {
    const backend = stubBackend('OWNER');
    renderApp();

    fireEvent.change(await screen.findByLabelText('Document title'), {
      target: { value: 'Draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
    await screen.findByRole('textbox', { name: 'Text' });

    act(() => {
      bodyEditor().commands.setContent('Written a moment before leaving');
    });
    // Leave immediately, before the debounce: the page flushes rather than dropping it.
    fireEvent.click(screen.getByRole('link', { name: 'Back to the workspace' }));

    await waitFor(() => {
      expect(backend.documents[0]?.revision).toBe(2);
    });
    expect(JSON.stringify(backend.documents[0]?.content)).toContain(
      'Written a moment before leaving',
    );
  });
});
