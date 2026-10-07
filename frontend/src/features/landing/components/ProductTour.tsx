import { useState, type ReactElement } from 'react';

import { Icon } from '../../../shared/components/icons';
import { Tabs } from '../../../shared/components/navigation';
import { TOUR_STEPS, type TourScreen } from '../landingContent';
import analysis from '../assets/analysis.png';
import ask from '../assets/ask.png';
import editor from '../assets/editor.png';
import overview from '../assets/overview.png';
import sources from '../assets/sources.png';
import styles from './ProductTour.module.css';

const screens: Readonly<Record<TourScreen, string>> = {
  overview,
  sources,
  ask,
  editor,
  analysis,
};

/** Tabbed walkthrough built from real renders of the application (see e2e/landing-screenshots.cjs). */
export function ProductTour(): ReactElement {
  const [value, setValue] = useState<TourScreen>('overview');
  return (
    <Tabs
      label="Product walkthrough"
      value={value}
      onChange={setValue}
      items={TOUR_STEPS.map((step) => ({
        value: step.value,
        label: step.label,
        content: (
          <div className={styles.step}>
            <div className={styles.copy}>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <ul className={styles.points}>
                {step.points.map((point) => (
                  <li key={point}>
                    <Icon name="check" size={16} />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className={styles.frame}>
              <div className={styles.chrome} aria-hidden="true">
                <span className={styles.dots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.chromeTitle}>{step.frame}</span>
              </div>
              <img
                src={screens[step.value]}
                alt={step.alt}
                width={2880}
                height={1800}
                loading={step.value === 'overview' ? 'eager' : 'lazy'}
                decoding="async"
              />
            </figure>
          </div>
        ),
      }))}
    />
  );
}
