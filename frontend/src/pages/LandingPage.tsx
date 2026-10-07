import type { ReactElement } from 'react';

import { Hero } from '../features/landing/components/Hero';
import { LandingHeader } from '../features/landing/components/LandingHeader';
import { PricingSection } from '../features/landing/components/Pricing';
import {
  AudienceSection,
  FaqSection,
  FeaturesSection,
  FinalCta,
  HowItWorksSection,
  LandingFooter,
  ProductSection,
  WhySection,
} from '../features/landing/components/Sections';
import styles from '../features/landing/components/Landing.module.css';

/** Public marketing page at `/`. Everything here is static; the only request is the session check in the header. */
export function LandingPage(): ReactElement {
  return (
    <div className={styles.page}>
      <LandingHeader />
      <main id="landing-main" tabIndex={-1}>
        <Hero />
        <WhySection />
        <ProductSection />
        <FeaturesSection />
        <HowItWorksSection />
        <AudienceSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
