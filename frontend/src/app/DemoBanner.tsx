import { t as uiText, useLocale as useUiLocale } from '../shared/i18n';
import type { ReactElement } from 'react';
import { Banner } from '../shared/components/feedback';
import { usePublicConfig } from './PublicConfig';
import styles from './DemoBanner.module.css';

export function DemoBanner(): ReactElement | null {
  useUiLocale();
  const { config, failed } = usePublicConfig();
  if (config?.demo)
    return (
      <div className={styles.banner}>
        <Banner tone="warning" lead={uiText('ui.DemoBanner.message001')} />
      </div>
    );
  if (failed)
    return (
      <div className={styles.banner}>
        <Banner tone="error" lead={uiText('ui.DemoBanner.message002')} />
      </div>
    );
  return null;
}
