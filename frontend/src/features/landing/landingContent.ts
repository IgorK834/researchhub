import { t as uiText } from '../../shared/i18n';
import type { IconName } from '../../shared/components/icons';
import type { BrandTone } from '../../shared/components/identity';
import type { IllustrationScene } from '../../shared/components/Illustration';

/** Public marketing copy. Product claims here must match what the application actually does. */

export interface NavLink {
  readonly id: string;
  readonly label: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  {
    id: 'product',
    get label() {
      return uiText('ui.Sections.message004');
    },
  },
  {
    id: 'features',
    get label() {
      return uiText('ui.Sections.message007');
    },
  },
  {
    id: 'how-it-works',
    get label() {
      return uiText('ui.Sections.message009');
    },
  },
  {
    id: 'pricing',
    get label() {
      return uiText('ui.Pricing.message002');
    },
  },
  {
    id: 'faq',
    get label() {
      return uiText('ui.Sections.message013');
    },
  },
];

export type TourScreen = 'overview' | 'sources' | 'ask' | 'editor' | 'analysis';

export interface TourStep {
  readonly value: TourScreen;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly points: readonly string[];
  readonly alt: string;
  /** Short caption shown in the browser frame. */
  readonly frame: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    value: 'overview',
    get label() {
      return uiText('ui.landingContent.message001');
    },
    get title() {
      return uiText('ui.landingContent.message002');
    },
    get description() {
      return uiText('ui.landingContent.message003');
    },
    get points() {
      return [
        uiText('ui.landingContent.message036'),
        uiText('ui.landingContent.message037'),
        uiText('ui.landingContent.message038'),
      ];
    },
    get alt() {
      return uiText('ui.landingContent.message004');
    },
    get frame() {
      return uiText('ui.landingContent.message039');
    },
  },
  {
    value: 'sources',
    get label() {
      return uiText('ui.landingContent.message005');
    },
    get title() {
      return uiText('ui.landingContent.message006');
    },
    get description() {
      return uiText('ui.landingContent.message007');
    },
    get points() {
      return [
        uiText('ui.landingContent.message040'),
        uiText('ui.landingContent.message041'),
        uiText('ui.landingContent.message042'),
      ];
    },
    get alt() {
      return uiText('ui.landingContent.message008');
    },
    get frame() {
      return uiText('ui.landingContent.message005');
    },
  },
  {
    value: 'ask',
    get label() {
      return uiText('ui.ResearchPanel.message007');
    },
    get title() {
      return uiText('ui.landingContent.message009');
    },
    get description() {
      return uiText('ui.landingContent.message010');
    },
    get points() {
      return [
        uiText('ui.landingContent.message043'),
        uiText('ui.landingContent.message044'),
        uiText('ui.landingContent.message045'),
      ];
    },
    get alt() {
      return uiText('ui.landingContent.message011');
    },
    get frame() {
      return uiText('ui.ResearchPanel.message007');
    },
  },
  {
    value: 'editor',
    get label() {
      return uiText('ui.landingContent.message012');
    },
    get title() {
      return uiText('ui.landingContent.message013');
    },
    get description() {
      return uiText('ui.landingContent.message014');
    },
    get points() {
      return [
        uiText('ui.landingContent.message046'),
        uiText('ui.landingContent.message047'),
        uiText('ui.landingContent.message048'),
      ];
    },
    get alt() {
      return uiText('ui.landingContent.message015');
    },
    get frame() {
      return uiText('ui.landingContent.message049');
    },
  },
  {
    value: 'analysis',
    get label() {
      return uiText('ui.AnalysisList.message001');
    },
    get title() {
      return uiText('ui.landingContent.message016');
    },
    get description() {
      return uiText('ui.landingContent.message017');
    },
    get points() {
      return [
        uiText('ui.landingContent.message050'),
        uiText('ui.landingContent.message051'),
        uiText('ui.landingContent.message052'),
      ];
    },
    get alt() {
      return uiText('ui.landingContent.message018');
    },
    get frame() {
      return uiText('ui.AnalysisList.message003');
    },
  },
];

export interface Feature {
  readonly icon: IconName;
  readonly tone: BrandTone;
  readonly title: string;
  readonly text: string;
}

export const FEATURES: readonly Feature[] = [
  {
    icon: 'library',
    tone: 'blue',
    get title() {
      return uiText('ui.landingContent.message019');
    },
    get text() {
      return uiText('ui.landingContent.message053');
    },
  },
  {
    icon: 'sparkle',
    tone: 'lavender',
    get title() {
      return uiText('ui.landingContent.message020');
    },
    get text() {
      return uiText('ui.landingContent.message054');
    },
  },
  {
    icon: 'pencil',
    tone: 'yellow',
    get title() {
      return uiText('ui.AuthoringPanel.message027');
    },
    get text() {
      return uiText('ui.landingContent.message055');
    },
  },
  {
    icon: 'users',
    tone: 'coral',
    get title() {
      return uiText('ui.landingContent.message021');
    },
    get text() {
      return uiText('ui.landingContent.message056');
    },
  },
  {
    icon: 'chart',
    tone: 'mint',
    get title() {
      return uiText('ui.landingContent.message022');
    },
    get text() {
      return uiText('ui.landingContent.message057');
    },
  },
  {
    icon: 'layers',
    tone: 'blue',
    get title() {
      return uiText('ui.landingContent.message023');
    },
    get text() {
      return uiText('ui.landingContent.message058');
    },
  },
  {
    icon: 'columns',
    tone: 'lavender',
    get title() {
      return uiText('ui.SourceComparisonPanel.message001');
    },
    get text() {
      return uiText('ui.landingContent.message059');
    },
  },
  {
    icon: 'shield',
    tone: 'coral',
    get title() {
      return uiText('ui.landingContent.message024');
    },
    get text() {
      return uiText('ui.landingContent.message060');
    },
  },
];

export interface Principle {
  readonly icon: IconName;
  readonly tone: BrandTone;
  readonly title: string;
  readonly text: string;
}

export const PRINCIPLES: readonly Principle[] = [
  {
    icon: 'quote',
    tone: 'mint',
    get title() {
      return uiText('ui.landingContent.message025');
    },
    get text() {
      return uiText('ui.landingContent.message061');
    },
  },
  {
    icon: 'check',
    tone: 'lavender',
    get title() {
      return uiText('ui.landingContent.message026');
    },
    get text() {
      return uiText('ui.landingContent.message062');
    },
  },
  {
    icon: 'history',
    tone: 'yellow',
    get title() {
      return uiText('ui.landingContent.message027');
    },
    get text() {
      return uiText('ui.landingContent.message063');
    },
  },
];

export interface Step {
  readonly title: string;
  readonly text: string;
  readonly icon: IconName;
  readonly tone: BrandTone;
}

export const STEPS: readonly Step[] = [
  {
    icon: 'plus',
    tone: 'blue',
    get title() {
      return uiText('ui.landingContent.message028');
    },
    get text() {
      return uiText('ui.landingContent.message064');
    },
  },
  {
    icon: 'upload',
    tone: 'coral',
    get title() {
      return uiText('ui.landingContent.message029');
    },
    get text() {
      return uiText('ui.landingContent.message065');
    },
  },
  {
    icon: 'sparkle',
    tone: 'lavender',
    get title() {
      return uiText('ui.landingContent.message030');
    },
    get text() {
      return uiText('ui.landingContent.message066');
    },
  },
  {
    icon: 'check',
    tone: 'mint',
    get title() {
      return uiText('ui.landingContent.message031');
    },
    get text() {
      return uiText('ui.landingContent.message067');
    },
  },
];

export interface Audience {
  readonly scene: IllustrationScene;
  readonly tone: BrandTone;
  readonly label: string;
  readonly title: string;
  readonly text: string;
  readonly items: readonly string[];
}

export const AUDIENCES: readonly Audience[] = [
  {
    scene: 'team',
    tone: 'mint',
    get label() {
      return uiText('ui.landingContent.message032');
    },
    get title() {
      return uiText('ui.landingContent.message033');
    },
    get text() {
      return uiText('ui.landingContent.message068');
    },
    get items() {
      return [
        uiText('ui.landingContent.message069'),
        uiText('ui.landingContent.message070'),
        uiText('ui.landingContent.message071'),
      ];
    },
  },
  {
    scene: 'reading',
    tone: 'lavender',
    get label() {
      return uiText('ui.landingContent.message034');
    },
    get title() {
      return uiText('ui.landingContent.message035');
    },
    get text() {
      return uiText('ui.landingContent.message072');
    },
    get items() {
      return [
        uiText('ui.landingContent.message073'),
        uiText('ui.landingContent.message074'),
        uiText('ui.landingContent.message075'),
      ];
    },
  },
];

export interface PlanFeature {
  readonly text: string;
  readonly included: boolean;
}

export interface Plan {
  readonly id: 'free' | 'premium';
  readonly name: string;
  readonly tagline: string;
  readonly price: string;
  readonly period: string;
  readonly cta: string;
  readonly note: string;
  readonly highlight: boolean;
  readonly lead?: string;
  readonly features: readonly string[];
}

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    get name() {
      return uiText('ui.landingContent.message076');
    },
    get tagline() {
      return uiText('ui.landingContent.message077');
    },
    price: '$0',
    get period() {
      return uiText('ui.landingContent.message078');
    },
    get cta() {
      return uiText('ui.Hero.message004');
    },
    get note() {
      return uiText('ui.landingContent.message079');
    },
    highlight: false,
    get features() {
      return [
        uiText('ui.landingContent.message080'),
        uiText('ui.landingContent.message081'),
        uiText('ui.landingContent.message082'),
        uiText('ui.landingContent.message083'),
        uiText('ui.landingContent.message084'),
        uiText('ui.landingContent.message085'),
        uiText('ui.landingContent.message086'),
      ];
    },
  },
  {
    id: 'premium',
    get name() {
      return uiText('ui.landingContent.message087');
    },
    get tagline() {
      return uiText('ui.landingContent.message088');
    },
    price: '$12',
    get period() {
      return uiText('ui.landingContent.message089');
    },
    get cta() {
      return uiText('ui.landingContent.message090');
    },
    get note() {
      return uiText('ui.landingContent.message091');
    },
    highlight: true,
    get lead() {
      return uiText('ui.landingContent.message092');
    },
    get features() {
      return [
        uiText('ui.landingContent.message093'),
        uiText('ui.landingContent.message094'),
        uiText('ui.landingContent.message095'),
        uiText('ui.landingContent.message096'),
        uiText('ui.landingContent.message097'),
        uiText('ui.landingContent.message098'),
        uiText('ui.landingContent.message099'),
      ];
    },
  },
];

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    get question() {
      return uiText('ui.landingContent.message100');
    },
    get answer() {
      return uiText('ui.landingContent.message101');
    },
  },
  {
    get question() {
      return uiText('ui.landingContent.message102');
    },
    get answer() {
      return uiText('ui.landingContent.message103');
    },
  },
  {
    get question() {
      return uiText('ui.landingContent.message104');
    },
    get answer() {
      return uiText('ui.landingContent.message105');
    },
  },
  {
    get question() {
      return uiText('ui.landingContent.message106');
    },
    get answer() {
      return uiText('ui.landingContent.message107');
    },
  },
  {
    get question() {
      return uiText('ui.landingContent.message108');
    },
    get answer() {
      return uiText('ui.landingContent.message109');
    },
  },
  {
    get question() {
      return uiText('ui.landingContent.message110');
    },
    get answer() {
      return uiText('ui.landingContent.message111');
    },
  },
];
