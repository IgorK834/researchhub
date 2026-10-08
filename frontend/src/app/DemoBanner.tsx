import type { ReactElement } from 'react';
import { Banner } from '../shared/components/feedback';
import { usePublicConfig } from './PublicConfig';
import styles from './DemoBanner.module.css';

export function DemoBanner(): ReactElement | null {
  const { config, failed } = usePublicConfig();
  if (config?.demo)
    return (
      <div className={styles.banner}>
        <Banner
          tone="warning"
          lead="Portfolio demo environment. Data may be reset periodically. Do not upload confidential, personal or sensitive information."
        />
      </div>
    );
  if (failed)
    return (
      <div className={styles.banner}>
        <Banner
          tone="error"
          lead="Runtime configuration is unavailable. Reload to verify this environment and AI mode."
        />
      </div>
    );
  return null;
}
