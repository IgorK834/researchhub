import type { ReactElement } from 'react';

import { Icon } from '../../../shared/components/icons';
import { Badge } from '../../../shared/components/identity';
import { PLANS, type Plan } from '../landingContent';
import { LinkButton } from './LinkButton';
import landing from './Landing.module.css';
import styles from './Pricing.module.css';

function PlanCard({ plan }: { readonly plan: Plan }): ReactElement {
  const titleId = `plan-${plan.id}`;
  return (
    <article
      className={[styles.plan, plan.highlight ? styles.highlight : '']
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={titleId}
    >
      <header className={styles.planHeader}>
        <h3 id={titleId}>{plan.name}</h3>
        {plan.highlight ? (
          <Badge label="Most popular" icon="star" tone="lavender" />
        ) : null}
      </header>
      <p className={styles.tagline}>{plan.tagline}</p>
      <p className={styles.price}>
        <span className={styles.amount}>{plan.price}</span>
        <span className={styles.period}>{plan.period}</span>
      </p>
      <LinkButton
        to="/register"
        size="large"
        variant={plan.highlight ? 'primary' : 'secondary'}
        className={styles.cta}
      >
        {plan.cta}
      </LinkButton>
      <p className={styles.note}>{plan.note}</p>
      {plan.lead === undefined ? null : (
        <p className={styles.featuresLead}>{plan.lead}</p>
      )}
      <ul className={styles.features}>
        {plan.features.map((feature) => (
          <li key={feature}>
            <Icon name="check" size={16} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PricingSection(): ReactElement {
  return (
    <section id="pricing" className={landing.section} aria-labelledby="pricing-title">
      <div className={landing.container}>
        <header className={landing.sectionHeader}>
          <p className={landing.eyebrow}>Pricing</p>
          <h2 id="pricing-title">Simple plans that grow with your research.</h2>
          <p className={landing.sectionLead}>
            Start free with your group. Move to Premium when your libraries, analyses and
            team outgrow the basics.
          </p>
        </header>
        <div className={styles.plans}>
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
        <p className={styles.footnote}>
          Prices in USD. Fair-use limits keep ResearchHub fast for all groups; you will
          see a clear message and a retry time if you reach one.
        </p>
      </div>
    </section>
  );
}
