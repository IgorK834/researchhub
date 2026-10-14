import { useEffect, type ReactElement } from 'react';
import { setLocale, useI18n, type Locale } from './locale';
import styles from './LanguageSwitcher.module.css';

/** Session-only preference: never writes to the user account or shared demo profile. */
export function LanguageSwitcher(): ReactElement {
  const { locale, t } = useI18n();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <label className={styles.switcher}>
      {t('language.label')}
      <select
        aria-label={t('language.label')}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="pl" lang="pl">
          Polski
        </option>
      </select>
    </label>
  );
}
