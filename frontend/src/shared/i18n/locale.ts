import { useSyncExternalStore } from 'react';
import { en, pl, type MessageKey, type Message } from './dictionaries';

export type Locale = 'en' | 'pl';
export const LOCALE_STORAGE_KEY = 'researchhub.ui.locale.v1';
const listeners = new Set<() => void>();
let current: Locale | undefined;
export function getLocale(): Locale {
  if (current) return current;
  try {
    current =
      typeof window !== 'undefined' &&
      window.sessionStorage.getItem(LOCALE_STORAGE_KEY) === 'pl'
        ? 'pl'
        : 'en';
  } catch {
    current = 'en';
  }
  return current;
}
export function setLocale(locale: Locale): void {
  if (locale !== 'en' && locale !== 'pl') return;
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  try {
    if (typeof window !== 'undefined')
      window.sessionStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* Private browsing/storage denial must not block the product. */
  }
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'en');
}
export function getIntlLocale(locale: Locale = getLocale()): string {
  return locale === 'pl' ? 'pl-PL' : 'en-US';
}
export function translate(
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
  locale: Locale = getLocale(),
): string {
  const dictionary: Readonly<Record<string, Message>> = locale === 'pl' ? pl : en;
  const message = dictionary[key] ?? en[key] ?? dictionary['common.fallback']!;
  const text =
    typeof message === 'string'
      ? message
      : (message[
          new Intl.PluralRules(getIntlLocale(locale)).select(
            Number(values['count'] ?? 0),
          ) as keyof typeof message
        ] ?? message.other);
  return text.replace(/\{(\w+)\}/g, (_match, name: string) =>
    values[name] === undefined
      ? '…'
      : name === 'count' && typeof values[name] === 'number'
        ? formatNumber(values[name], {}, locale)
        : String(values[name]),
  );
}
export const t = translate;
export function useI18n(): { locale: Locale; t: typeof translate } {
  const locale = useLocale();
  return { locale, t: (key, values) => translate(key, values, locale) };
}
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {},
  locale: Locale = getLocale(),
): string {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 20,
    ...options,
  }).format(value);
}
export function formatDate(
  value: Date | string,
  options: Intl.DateTimeFormatOptions = {},
  locale: Locale = getLocale(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(getIntlLocale(locale), options).format(date);
}
