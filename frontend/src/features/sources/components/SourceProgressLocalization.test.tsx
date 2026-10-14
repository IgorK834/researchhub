/** @jest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SourceProgress } from './SourceProgress';
import { SourceProcessing } from './SourceProcessing';
import { fetchSourceProcessing } from '../api/sourceApi';
import { setLocale } from '../../../shared/i18n';
jest.mock('../api/sourceApi', () => ({
  ...jest.requireActual('../api/sourceApi'),
  fetchSourceProcessing: jest.fn(),
}));
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  setLocale('en');
});
it.each([
  ['EXTRACT', 'Reading source', 'Odczytywanie źródła'],
  ['CHUNK', 'Preparing source fragments', 'Przygotowywanie fragmentów źródła'],
  ['EMBED', 'Making source searchable', 'Przygotowywanie wyszukiwania w źródle'],
  ['INDEX', 'Saving searchable fragments', 'Zapisywanie przeszukiwalnych fragmentów'],
  ['FINALIZE', 'Finishing processing', 'Kończenie przetwarzania'],
])(
  'displays the server stage %s in both locales without changing numeric progress',
  async (stage, en, pl) => {
    (fetchSourceProcessing as jest.Mock).mockResolvedValue({ stage, progress: 40 });
    for (const locale of ['en', 'pl'] as const) {
      setLocale(locale);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <SourceProgress workspaceId="w" sourceId="s" />
          <SourceProcessing workspaceId="w" sourceId="s" status="PROCESSING" canEdit />
        </QueryClientProvider>,
      );
      expect(
        await screen.findAllByText(`${locale === 'en' ? en : pl} · 40%`),
      ).toHaveLength(2);
      expect(screen.getAllByRole('progressbar')).toHaveLength(2);
      cleanup();
      client.clear();
    }
  },
);
