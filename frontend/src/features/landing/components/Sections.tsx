import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { Link } from 'react-router-dom';

import { Icon } from '../../../shared/components/icons';
import { IconTile } from '../../../shared/components/content';
import { Illustration } from '../../../shared/components/Illustration';
import { Badge, Sticker } from '../../../shared/components/identity';
import {
  AUDIENCES,
  FAQ,
  FEATURES,
  NAV_LINKS,
  PRINCIPLES,
  STEPS,
} from '../landingContent';
import { LinkButton } from './LinkButton';
import { ProductTour } from './ProductTour';
import styles from './Landing.module.css';
import { usePublicConfig } from '../../../app/PublicConfig';

function SectionHeader({
  id,
  label,
  title,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <header className={styles.sectionHeader}>
      <p className={styles.eyebrow}>{label}</p>
      <h2 id={id}>{title}</h2>
      {children === undefined ? null : <p className={styles.sectionLead}>{children}</p>}
    </header>
  );
}

export function WhySection(): ReactElement {
  useUiLocale();
  return (
    <section className={styles.section} aria-labelledby="why-title">
      <div className={styles.container}>
        <SectionHeader
          id="why-title"
          label={uiText('ui.Sections.message001')}
          title={uiText('ui.Sections.message002')}
        >
          {uiText('ui.Sections.message003')}
        </SectionHeader>
        <ul className={styles.principles}>
          {PRINCIPLES.map((principle) => (
            <li key={principle.title} className={styles.card}>
              <IconTile icon={principle.icon} tone={principle.tone} size="large" />
              <h3>{principle.title}</h3>
              <p>{principle.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ProductSection(): ReactElement {
  useUiLocale();
  return (
    <section
      id="product"
      className={[styles.section, styles.band].join(' ')}
      aria-labelledby="product-title"
    >
      <div className={styles.container}>
        <SectionHeader
          id="product-title"
          label={uiText('ui.Sections.message004')}
          title={uiText('ui.Sections.message005')}
        >
          {uiText('ui.Sections.message006')}
        </SectionHeader>
        <ProductTour />
      </div>
    </section>
  );
}

export function FeaturesSection(): ReactElement {
  useUiLocale();
  return (
    <section id="features" className={styles.section} aria-labelledby="features-title">
      <div className={styles.container}>
        <SectionHeader
          id="features-title"
          label={uiText('ui.Sections.message007')}
          title={uiText('ui.Sections.message008')}
        />
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature.title} className={styles.card}>
              <IconTile icon={feature.icon} tone={feature.tone} />
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HowItWorksSection(): ReactElement {
  useUiLocale();
  return (
    <section
      id="how-it-works"
      className={[styles.section, styles.band].join(' ')}
      aria-labelledby="how-title"
    >
      <div className={styles.container}>
        <SectionHeader
          id="how-title"
          label={uiText('ui.Sections.message009')}
          title={uiText('ui.Sections.message010')}
        />
        <ol className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <IconTile icon={step.icon} tone={step.tone} />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function AudienceSection(): ReactElement {
  useUiLocale();
  return (
    <section className={styles.section} aria-labelledby="audience-title">
      <div className={styles.container}>
        <SectionHeader
          id="audience-title"
          label={uiText('ui.Sections.message011')}
          title={uiText('ui.Sections.message012')}
        />
        <div className={styles.audiences}>
          {AUDIENCES.map((audience) => (
            <article
              key={audience.label}
              className={[styles.audience, styles[audience.tone]].join(' ')}
            >
              <div className={styles.audienceCopy}>
                <Sticker label={audience.label} tone={audience.tone} />
                <h3>{audience.title}</h3>
                <p>{audience.text}</p>
                <ul>
                  {audience.items.map((item) => (
                    <li key={item}>
                      <Icon name="check" size={16} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Illustration scene={audience.scene} size="default" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FaqSection(): ReactElement {
  useUiLocale();
  const base = useId();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section
      id="faq"
      className={[styles.section, styles.band].join(' ')}
      aria-labelledby="faq-title"
    >
      <div className={[styles.container, styles.faqLayout].join(' ')}>
        <SectionHeader
          id="faq-title"
          label={uiText('ui.Sections.message013')}
          title={uiText('ui.Sections.message014')}
        />
        <div className={styles.faq}>
          {FAQ.map((item, index) => {
            const expanded = open === index;
            return (
              <div key={item.question} className={styles.faqItem}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`${base}-${index}`}
                    className={styles.faqButton}
                    onClick={() => setOpen(expanded ? null : index)}
                  >
                    {item.question}
                    <Icon name={expanded ? 'minus' : 'plus'} size={18} />
                  </button>
                </h3>
                <div
                  id={`${base}-${index}`}
                  hidden={!expanded}
                  className={styles.faqAnswer}
                >
                  <p>{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FinalCta(): ReactElement {
  useUiLocale();
  return (
    <section className={styles.section} aria-labelledby="cta-title">
      <div className={styles.container}>
        <div className={styles.cta}>
          <div className={styles.ctaCopy}>
            <Badge
              label={uiText('ui.Sections.message015')}
              icon="sparkle"
              tone="yellow"
            />
            <h2 id="cta-title">{uiText('ui.Sections.message016')}</h2>
            <p>{uiText('ui.Sections.message017')}</p>
            <div className={styles.ctaRow}>
              <LinkButton to="/register" size="large" icon="arrowRight">
                {uiText('ui.Hero.message004')}
              </LinkButton>
              <LinkButton to="/login" variant="secondary" size="large">
                {uiText('ui.AccountLink.message007')}
              </LinkButton>
            </div>
          </div>
          <Illustration scene="workspace" size="default" />
        </div>
      </div>
    </section>
  );
}

export function LandingFooter(): ReactElement {
  useUiLocale();
  const { config } = usePublicConfig();
  return (
    <footer className={styles.footer}>
      <div className={[styles.container, styles.footerGrid].join(' ')}>
        <p className={styles.footerBrand}>
          <strong>ResearchHub</strong>
          <span>{uiText('ui.Sections.message018')}</span>
        </p>
        <nav aria-label={uiText('ui.Sections.message019')}>
          <ul className={styles.footerLinks}>
            {NAV_LINKS.map((link) => (
              <li key={link.id}>
                <a href={`#${link.id}`}>{link.label}</a>
              </li>
            ))}
            <li>
              <Link to="/login">{uiText('ui.AccountLink.message007')}</Link>
            </li>
            {config?.registrationMode === 'open' ? (
              <li>
                <Link to="/register">{uiText('ui.LandingHeader.message001')}</Link>
              </li>
            ) : null}
          </ul>
        </nav>
        <p className={styles.footerLegal}>{uiText('ui.Sections.message020')}</p>
      </div>
    </footer>
  );
}
