import type { ReactElement } from 'react';

import { Button } from '../../../shared/components/Button';
import { Illustration } from '../../../shared/components/Illustration';
import { Badge, Sticker } from '../../../shared/components/identity';
import { SOURCE_TYPES, SOURCE_TYPE_VISUALS } from '../../sources/api/sourceTypes';
import { LinkButton } from './LinkButton';
import styles from './Landing.module.css';

export function Hero(): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={[styles.container, styles.heroGrid].join(' ')}>
        <div className={styles.heroCopy}>
          <Sticker label="Grounded in your sources" tone="yellow" icon="sparkle" />
          <h1 id="landing-title" className={styles.display}>
            Research together. <em>Cite everything.</em>
          </h1>
          <p className={styles.lead}>
            ResearchHub is a shared workspace for students and researchers. Collect your
            sources, write the report side by side and ask AI questions that stay grounded
            in your own files, with every claim traceable to where it came from.
          </p>
          <div className={styles.ctaRow}>
            <LinkButton to="/register" size="large" icon="arrowRight">
              Create free account
            </LinkButton>
            <Button href="#product" variant="secondary" size="large">
              See how it works
            </Button>
          </div>
          <p className={styles.fine}>
            No credit card required. Free plan, no time limit.
          </p>
          <ul className={styles.fileTypes} aria-label="Supported file types">
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
            <Sticker label="Every claim has a source" tone="mint" icon="check" />
          </div>
          <Illustration scene="hero" size="hero" />
          <p className={styles.heroCaption}>Read. Question. Cite.</p>
        </div>
      </div>
    </section>
  );
}
