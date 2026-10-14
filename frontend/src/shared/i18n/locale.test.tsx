/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { en, pl, type MessageKey } from './dictionaries';
import {
  getLocale,
  setLocale,
  translate,
  formatDate,
  formatNumber,
  useI18n,
  LOCALE_STORAGE_KEY,
  getIntlLocale,
} from './locale';
import { LanguageSwitcher } from './LanguageSwitcher';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProblemForm } from '../../features/analysis/components/ProblemForm';
import { describeError, ApiError } from '../api';
import { parseMath, mathPlain } from '../../features/documents/api/mathAst';
import {
  REWRITE_ACTIONS,
  authoringCommand,
} from '../../features/ai/api/authoringActions';

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setLocale('en');
  sessionStorage.clear();
});
it('has complete dictionaries and matching interpolation slots, never exposing unknown keys', () => {
  expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  const slots = (s: string): string[] =>
    [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
  for (const key of Object.keys(en) as MessageKey[]) {
    const a = en[key],
      b = pl[key];
    if (typeof a === 'string' && typeof b === 'string') {
      expect(b.trim()).not.toBe('');
      expect(slots(b)).toEqual(slots(a));
    } else {
      expect(typeof b).toBe('object');
      for (const category of ['one', 'few', 'many', 'other'] as const) {
        expect(slots((b as (typeof en)['documents.count'])[category])).toEqual(
          slots((a as (typeof en)['documents.count'])[category]),
        );
      }
    }
  }
  expect(translate('unknown.key' as MessageKey, {}, 'pl')).toBe(pl['common.fallback']);
  expect(translate('templates.version', {}, 'en')).toBe('Version …');
  // An incomplete translation has a readable English fallback, not its internal identifier.
  const original = pl['common.retry'];
  delete (pl as Partial<typeof pl>)['common.retry'];
  try {
    expect(translate('common.retry', {}, 'pl')).toBe(en['common.retry']);
  } finally {
    pl['common.retry'] = original;
  }
});
it.each([
  [0, '0 dokumentów'],
  [1, '1 dokument'],
  [2, '2 dokumenty'],
  [5, '5 dokumentów'],
  [12, '12 dokumentów'],
  [22, '22 dokumenty'],
  [1.5, '1,5 dokumentu'],
])('selects Polish plural category for %s', (count, expected) => {
  expect(translate('documents.count', { count }, 'pl')).toBe(expected);
});
it('formats display numbers and dates explicitly without changing canonical scientific notation', () => {
  expect(formatNumber(1234.5, {}, 'en')).toBe('1,234.5');
  expect(formatNumber(1234.5, {}, 'pl')).toBe('1234,5');
  expect(formatNumber(1.23456789, {}, 'pl')).toBe('1,23456789');
  const date = '2026-10-14T23:45:00Z';
  expect(formatDate(date, { dateStyle: 'long', timeZone: 'UTC' }, 'en')).toBe(
    'October 14, 2026',
  );
  expect(formatDate(new Date(date), { dateStyle: 'long', timeZone: 'UTC' }, 'pl')).toBe(
    '14 października 2026',
  );
  expect(formatDate('invalid')).toBe('—');
  expect(getIntlLocale('pl')).toBe('pl-PL');
  const before = parseMath('1.25 + 2.5');
  setLocale('pl');
  expect(parseMath('1.25 + 2.5')).toEqual(before);
  expect(mathPlain(before)).toContain('1.25');
  expect(() => parseMath('1,25')).toThrow();
  expect(translate('documents.count', { count: 2 }, 'en')).toBe('2 documents');
});
it('reactively switches labels and HTML language, preserving mounted inputs and session-only preference', () => {
  function Probe() {
    const { t } = useI18n();
    return (
      <>
        <LanguageSwitcher />
        <label>
          {t('documents.create.title')}
          <input defaultValue="My unchanged 1.25 results" />
        </label>
      </>
    );
  }
  render(<Probe />);
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), {
    target: { value: 'pl' },
  });
  expect(screen.getByLabelText('Tytuł dokumentu')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('My unchanged 1.25 results');
  expect(document.documentElement.lang).toBe('pl');
  expect(sessionStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  act(() => setLocale('invalid' as 'en'));
  expect(getLocale()).toBe('pl');
  expect(REWRITE_ACTIONS[0]?.[1]).toBe('Popraw styl');
  act(() => setLocale('en'));
  expect(REWRITE_ACTIONS[0]?.[1]).toBe('Improve writing');
});
it('does not translate a canonical default authoring command when interface labels change', () => {
  const input = {
    kind: 'EVIDENCE' as const,
    action: 'SHORTEN' as const,
    revision: 1,
    selection: { from: 0, to: 4, text: '1.25', placementBlock: 0 },
    placement: '0',
    instruction: '',
    selected: [],
    all: true,
    length: 400,
    style: 'ACADEMIC',
    required: true,
  };
  const before = authoringCommand(input);
  setLocale('pl');
  expect(authoringCommand(input)).toEqual(before);
});
it('relabels a local scientific-input error without replacing the entered parameters', () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProblemForm workspaceId="w" onCreated={jest.fn()} />
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText('Problem parameters');
  fireEvent.change(screen.getByLabelText('Problem statement'), {
    target: { value: 'Evaluate my own inputs' },
  });
  fireEvent.change(screen.getByLabelText('Problem formula'), {
    target: { value: '1.25' },
  });
  fireEvent.change(input, { target: { value: 'bad;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save problem' }));
  expect(screen.getByRole('alert').textContent).toContain('symbol;value;unit');
  act(() => setLocale('pl'));
  expect(screen.getByRole('alert').textContent).toContain('kropką dziesiętną');
  expect(screen.getByLabelText('Parametry problemu')).toBe(input);
  expect(input).toHaveProperty('value', 'bad;');
});
it('loads the session choice on a fresh module and tolerates blocked storage', () => {
  sessionStorage.setItem(LOCALE_STORAGE_KEY, 'pl');
  jest.isolateModules(() => {
    const locale = require('./locale') as typeof import('./locale');
    expect(locale.getLocale()).toBe('pl');
    expect(locale.getLocale()).toBe('pl');
  });
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.isolateModules(() => {
    const locale = require('./locale') as typeof import('./locale');
    expect(locale.getLocale()).toBe('en');
    expect(() => locale.setLocale('pl')).not.toThrow();
    expect(locale.getLocale()).toBe('pl');
  });
});
it('uses stable API error codes in Polish without translating scientific data or provider details', () => {
  setLocale('pl');
  const error = new ApiError({
    type: 'about:blank',
    title: 'private',
    status: 409,
    code: 'DOCUMENT_LIMIT_REACHED',
    rawCode: 'DOCUMENT_LIMIT_REACHED',
    detail: 'private backend detail',
  });
  expect(describeError(error)).toBe(pl['errors.DOCUMENT_LIMIT_REACHED']);
  expect(describeError(error)).not.toContain('private');
  expect(describeError(new Error('private raw diagnostic'))).toBe(
    pl['errors.INTERNAL_ERROR'],
  );
});
