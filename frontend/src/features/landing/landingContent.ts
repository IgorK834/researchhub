import type { IconName } from '../../shared/components/icons';
import type { BrandTone } from '../../shared/components/identity';
import type { IllustrationScene } from '../../shared/components/Illustration';

/** Public marketing copy. Product claims here must match what the application actually does. */

export interface NavLink {
  readonly id: string;
  readonly label: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { id: 'product', label: 'Product' },
  { id: 'features', label: 'Features' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
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
    label: 'Workspace',
    title: 'One shared place for the whole group.',
    description:
      'Every workspace brings the team, the sources, the report and the AI history together, so nobody has to ask where the latest version lives.',
    points: [
      'Recent documents, sources and AI activity at a glance',
      'Owner, Editor and Viewer roles for every member',
      'Ask a question straight from the overview',
    ],
    alt: 'ResearchHub workspace overview for an electronics lab: recent documents, recent AI questions and a box to ask across all sources.',
    frame: 'Workspace overview',
  },
  {
    value: 'sources',
    label: 'Sources',
    title: 'Upload once. Everyone works from the same files.',
    description:
      'PDFs, Word files, spreadsheets, CSV data and plain text are processed and indexed, so AI can quote them and your team can open the exact passage.',
    points: [
      'PDF, DOCX, XLSX, CSV and TXT up to 50 MB',
      'Every upload is an immutable version; replacing a file keeps the old one',
      'Clear status for each file: uploaded, processing, ready or failed',
    ],
    alt: 'ResearchHub source library listing six lab files with type, uploader, date and ready status.',
    frame: 'Sources',
  },
  {
    value: 'ask',
    label: 'Ask AI',
    title: 'Answers that show their work.',
    description:
      'Choose which sources AI may use, ask in plain language and get an answer where every claim links back to the passage that supports it.',
    points: [
      'You always see the scope: which sources the answer is based on',
      'Citations open the exact fragment, not just the file',
      'When the sources are not enough, it says so instead of guessing',
    ],
    alt: 'ResearchHub Ask AI page with a grounded answer about the time constant of an RC circuit, citations S1 to S3 and a source scope panel.',
    frame: 'Ask AI',
  },
  {
    value: 'editor',
    label: 'Writing',
    title: 'Write the report with AI beside you, not instead of you.',
    description:
      'Draft a section from selected sources, rewrite a paragraph or look for evidence behind a claim. Suggestions change the document only after you accept them.',
    points: [
      'Comments, history and named snapshots for the whole team',
      'Content origin keeps human, AI, imported and analysis-derived text apart',
      'Research conversation next to the editor, with the same citations',
    ],
    alt: 'ResearchHub document editor with a lab report on the left and a research conversation with a grounded answer in the side panel.',
    frame: 'Lab report',
  },
  {
    value: 'analysis',
    label: 'Analyses',
    title: 'From a spreadsheet to a chart you can reproduce.',
    description:
      'Pick a dataset, describe the calculation and ResearchHub plans it, runs the code in an isolated sandbox and keeps the inputs, code and result together.',
    points: [
      'Inspect sheets, columns and sample rows before you run anything',
      'Python runs in a locked-down sandbox, never inside the app',
      'Insert the result into the report and trace it back to the data',
    ],
    alt: 'ResearchHub new analysis form with a measurements spreadsheet selected, its columns and sample rows, and a plain-language request.',
    frame: 'New analysis',
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
    title: 'Shared source library',
    text: 'One library per workspace for lectures, papers, instructions and datasets. Files are versioned and never silently overwritten.',
  },
  {
    icon: 'sparkle',
    tone: 'lavender',
    title: 'Grounded answers with citations',
    text: 'Ask across all or selected sources. Each claim links to its fragment, and weak evidence is reported as insufficient.',
  },
  {
    icon: 'pencil',
    tone: 'yellow',
    title: 'AI-assisted authoring',
    text: 'Generate a section from chosen sources, rewrite a selection or find support for a claim. You accept, edit or reject.',
  },
  {
    icon: 'users',
    tone: 'coral',
    title: 'Writing together',
    text: 'One report, many authors. Anchored comment threads, version history and named snapshots keep the group in sync.',
  },
  {
    icon: 'chart',
    tone: 'mint',
    title: 'Reproducible data analysis',
    text: 'Describe a calculation in plain language. Tables and charts keep their dataset, code and execution record.',
  },
  {
    icon: 'layers',
    tone: 'blue',
    title: 'Provenance for every block',
    text: 'See what was written by a person, drafted by AI, imported or derived from an analysis, and which sources it relied on.',
  },
  {
    icon: 'columns',
    tone: 'lavender',
    title: 'Compare sources',
    text: 'Put sources side by side to spot where they agree, differ or contradict each other, with the evidence for each side.',
  },
  {
    icon: 'shield',
    tone: 'coral',
    title: 'Built with safety in mind',
    text: 'Uploads are inspected, costly operations are rate limited, prompts are screened and AI code never runs in the app itself.',
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
    title: 'Grounded by default',
    text: 'AI works from the files your group chose. If the evidence is missing, you get “not enough evidence”, which is useful research information, not an error.',
  },
  {
    icon: 'check',
    tone: 'lavender',
    title: 'You stay in control',
    text: 'Suggestions never replace your text on their own. Every change is proposed first, with the evidence beside it.',
  },
  {
    icon: 'history',
    tone: 'yellow',
    title: 'Traceable and reproducible',
    text: 'A chart is more than an image. It remembers its data, code and run, so a result can be checked, repeated and trusted.',
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
    title: 'Create a workspace',
    text: 'Name it after the lab, course or paper and invite your group with the right roles.',
  },
  {
    icon: 'upload',
    tone: 'coral',
    title: 'Add your sources',
    text: 'Upload lectures, papers, instructions and data. Processing runs in the background and shows its progress.',
  },
  {
    icon: 'sparkle',
    tone: 'lavender',
    title: 'Ask, draft and analyze',
    text: 'Question the sources, draft sections with citations and turn measurements into charts.',
  },
  {
    icon: 'check',
    tone: 'mint',
    title: 'Review and finish',
    text: 'Accept what is right, comment on the rest and keep restore points as the report takes shape.',
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
    label: 'For students',
    title: 'Lab reports without the version chaos.',
    text: 'Share the instructions, lectures and measurements with your group, then write the report together and keep every number tied to its data.',
    items: [
      'Ask questions about lectures and instructions',
      'Draft sections from the right materials',
      'Analyze measurement files and insert the chart',
    ],
  },
  {
    scene: 'reading',
    tone: 'lavender',
    label: 'For researchers',
    title: 'Literature and data in one trail of evidence.',
    text: 'Collect papers and datasets, compare what they claim and write with every statement linked to where it came from.',
    items: [
      'Compare papers and surface contradictions',
      'Check a claim against your own sources',
      'Keep notes reproducible and reviewable',
    ],
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
    name: 'Free',
    tagline: 'Everything you need to run a course project or a small study.',
    price: '$0',
    period: 'forever',
    cta: 'Create free account',
    note: 'No credit card required.',
    highlight: false,
    features: [
      'Up to 2 workspaces',
      'Up to 5 members per workspace',
      '15 sources per workspace, up to 50 MB each',
      'Grounded questions with citations',
      'AI drafting, rewriting and evidence checks (fair use)',
      '10 data analyses per month',
      'Version history and content provenance',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    tagline: 'For research groups that live in ResearchHub every day.',
    price: '$12',
    period: 'per member / month',
    cta: 'Start free, upgrade later',
    note: 'Premium billing opens soon. Your workspaces carry over.',
    highlight: true,
    lead: 'Everything in Free, plus',
    features: [
      'Unlimited workspaces and members',
      'Unlimited sources and larger libraries',
      'Higher AI limits and priority processing',
      'Unlimited data analyses with full execution history',
      'Source comparison and contradiction checks',
      'Named snapshots and extended history',
      'Priority support',
    ],
  },
];

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Will the AI make things up?',
    answer:
      'ResearchHub answers from the sources you select and links every claim to the passage behind it. When the retrieved evidence is not enough, it tells you that instead of inventing an answer. You can always open the cited fragment and check it yourself.',
  },
  {
    question: 'Which files can I upload?',
    answer:
      'PDF, DOCX, XLSX, CSV and plain-text files up to 50 MB each. Uploads are inspected before processing, and a file that cannot be processed fails with a clear reason and a way to retry.',
  },
  {
    question: 'Who can see what is in my workspace?',
    answer:
      'Only the people you add. Owners manage the workspace, Editors upload sources and write, and Viewers can read and ask questions without changing anything. Access is checked on every request.',
  },
  {
    question: 'Can I run calculations on my own data?',
    answer:
      'Yes. Pick a spreadsheet or CSV, describe the calculation and ResearchHub plans and runs it in an isolated sandbox. The result keeps its inputs, code and run, and your original data stays unchanged.',
  },
  {
    question: 'Can I use it alone, without a group?',
    answer:
      'Of course. A workspace with one member works the same way: sources, grounded answers, drafting and analyses. Invite others whenever you are ready.',
  },
  {
    question: 'When does Premium become available?',
    answer:
      'Premium is on the way. Create a free account today and your workspaces, sources and documents stay exactly where they are when plans change.',
  },
];
