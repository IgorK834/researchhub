/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CreateDocumentForm } from './CreateDocumentForm';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { TemplatePreview } from './TemplatePreview';
import {
  createDocumentFromTemplate,
  fetchDocumentTemplates,
  type DocumentTemplate,
} from '../api/documentTemplateApi';
import { createDocument } from '../api/documentApi';
import { setLocale } from '../../../shared/i18n';
import { ApiError } from '../../../shared/api';
import lab from '../../../../../backend/src/main/resources/templates/documents/lab-report.en.json';
import review from '../../../../../backend/src/main/resources/templates/documents/literature-review.pl.json';
import { readStoredDocument } from '../api/documentContent';

jest.mock('../api/documentTemplateApi');
jest.mock('../api/documentApi', () => ({
  ...jest.requireActual('../api/documentApi'),
  createDocument: jest.fn(),
}));
const catalog = [{ ...lab, sha256: 'a'.repeat(64) }] as unknown as DocumentTemplate[];
const saved = {
  id: 'new-id',
  workspaceId: 'w',
  title: 'A report',
  revision: 1,
  content: lab.content,
};
function show(element = <CreateDocumentForm workspaceId="w" />) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
async function choose() {
  fireEvent.change(screen.getByLabelText('Starting structure'), {
    target: { value: 'TEMPLATE' },
  });
  await screen.findByRole('region', { name: 'Template preview' });
}
beforeEach(() => {
  setLocale('en');
  (fetchDocumentTemplates as jest.Mock).mockResolvedValue(catalog);
  (createDocumentFromTemplate as jest.Mock).mockResolvedValue(saved);
  (createDocument as jest.Mock).mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  jest.resetAllMocks();
  setLocale('en');
});
it('creates a normal document with reviewed template identity and an explicit locale', async () => {
  const onCreated = jest.fn();
  show(<CreateDocumentForm workspaceId="w" onCreated={onCreated} />);
  expect(fetchDocumentTemplates).not.toHaveBeenCalled();
  await choose();
  expect(readStoredDocument(catalog[0]!.content)).not.toBeNull();
  expect(screen.getByText(/no generated results or citations/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'A report' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(saved));
  expect(createDocumentFromTemplate).toHaveBeenCalledWith(
    'w',
    expect.objectContaining({
      clientRequestId: expect.any(String),
      templateId: 'lab-report',
      version: 1,
      locale: 'en',
      title: 'A report',
    }),
  );
  expect(createDocument).not.toHaveBeenCalled();
});
it('retries an identical attempt with the same identity, but a changed title receives a fresh identity', async () => {
  (createDocumentFromTemplate as jest.Mock).mockRejectedValue(new Error('offline'));
  show();
  await choose();
  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'A report' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
  await waitFor(() => expect(createDocumentFromTemplate).toHaveBeenCalledTimes(2));
  const calls = (createDocumentFromTemplate as jest.Mock).mock.calls;
  expect(calls[1]?.[1].clientRequestId).toBe(calls[0]?.[1].clientRequestId);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create document' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'Changed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
  await waitFor(() => expect(createDocumentFromTemplate).toHaveBeenCalledTimes(3));
  expect(calls[2]?.[1].clientRequestId).not.toBe(calls[0]?.[1].clientRequestId);
});
it('shows catalog failures and permits an explicit retry; changing template language loads its variant', async () => {
  (fetchDocumentTemplates as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  show();
  fireEvent.change(screen.getByLabelText('Starting structure'), {
    target: { value: 'TEMPLATE' },
  });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('region', { name: 'Template preview' });
  (fetchDocumentTemplates as jest.Mock).mockResolvedValue([
    { ...review, sha256: 'b'.repeat(64) },
  ]);
  fireEvent.change(screen.getByLabelText('Template language'), {
    target: { value: 'pl' },
  });
  await waitFor(() =>
    expect(fetchDocumentTemplates).toHaveBeenCalledWith(
      'w',
      'pl',
      expect.any(AbortSignal),
    ),
  );
  fireEvent.change(await screen.findByLabelText('Template'), {
    target: { value: 'literature-review' },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Template preview' }).textContent,
    ).toContain(review.title),
  );
});
it('cancelled preview saves nothing; pending creation cannot be dismissed and completes normally', async () => {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  let finish!: (value: unknown) => void;
  const shown = show(
    <CreateDocumentDialog workspaceId="w" open onClose={onClose} onCreated={onCreated} />,
  );
  await choose();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(createDocumentFromTemplate).not.toHaveBeenCalled();
  shown.unmount();
  (createDocumentFromTemplate as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show(
    <CreateDocumentDialog workspaceId="w" open onClose={onClose} onCreated={onCreated} />,
  );
  await choose();
  fireEvent.change(screen.getByLabelText('Document title'), {
    target: { value: 'A report' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create document' }).getAttribute('aria-busy'),
    ).toBe('true'),
  );
  expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => finish(saved));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'));
});
it('shows the translated quota error without discarding the entered title', async () => {
  setLocale('pl');
  (createDocumentFromTemplate as jest.Mock).mockRejectedValue(
    new ApiError({
      type: 'about:blank',
      status: 409,
      title: 'limit',
      detail: 'private',
      code: 'DOCUMENT_LIMIT_REACHED',
      rawCode: 'DOCUMENT_LIMIT_REACHED',
    }),
  );
  show();
  fireEvent.change(screen.getByLabelText('Struktura początkowa'), {
    target: { value: 'TEMPLATE' },
  });
  await screen.findByRole('region', { name: 'Podgląd szablonu' });
  fireEvent.change(screen.getByLabelText('Tytuł dokumentu'), {
    target: { value: 'Moje dane' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Utwórz dokument' }));
  expect((await screen.findByRole('alert')).textContent).toContain('limit dokumentów');
  expect((screen.getByLabelText('Tytuł dokumentu') as HTMLInputElement).value).toBe(
    'Moje dane',
  );
});
it('renders invalid preview content as an error and inert HTML-like text as text', () => {
  show(
    <TemplatePreview
      template={{ ...catalog[0]!, content: { type: 'invalid' } as never }}
    />,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  cleanup();
  show(
    <TemplatePreview
      template={{
        ...catalog[0]!,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
            },
          ],
        },
      }}
    />,
  );
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
});
