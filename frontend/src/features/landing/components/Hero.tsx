import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';

import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { Badge, Sticker } from '../../../shared/components/identity';
import { SOURCE_TYPES, SOURCE_TYPE_VISUALS } from '../../sources/api/sourceTypes';
import { LinkButton } from './LinkButton';
import styles from './Landing.module.css';

export function Hero(): ReactElement {
  useUiLocale();
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={[styles.container, styles.heroGrid].join(' ')}>
        <div className={styles.heroCopy}>
          <Sticker
            label={uiText('ui.AuthLayout.message001')}
            tone="yellow"
            icon="sparkle"
          />
          <h1 id="landing-title" className={styles.display}>
            {uiText('ui.Hero.message001')} <em>{uiText('ui.Hero.message002')}</em>
          </h1>
          <p className={styles.lead}>{uiText('ui.Hero.message003')}</p>
          <div className={styles.ctaRow}>
            <LinkButton to="/register" size="large" icon="arrowRight">
              {uiText('ui.Hero.message004')}
            </LinkButton>
            <Button href="#product" variant="secondary" size="large">
              {uiText('ui.Hero.message005')}
            </Button>
          </div>
          <p className={styles.fine}>{uiText('ui.Hero.message006')}</p>
          <ul className={styles.fileTypes} aria-label={uiText('ui.Hero.message007')}>
            {SOURCE_TYPES.map((type) => (
              <li key={type}>
                <Badge
                  label={type}
                  icon={SOURCE_TYPE_VISUALS[type].icon}
                  tone={SOURCE_TYPE_VISUALS[type].tone}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <div className={styles.heroSticker}>
            <Sticker label={uiText('ui.Hero.message008')} tone="mint" icon="check" />
          </div>
          <Illustration scene="hero" size="hero" />
          <p className={styles.heroCaption}>{uiText('ui.AuthLayout.message003')}</p>
        </div>
      </div>
    </section>
  );
}
