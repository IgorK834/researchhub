/* Regenerates the product screenshots shown on the public landing page. */
/* global document */
/*
 * Drives the real application (dev server or any served build) against mocked API fixtures, so the
 * images are genuine renders of the shipped UI and no product database is involved.
 *
 *   npm start                       # in one terminal
 *   node e2e/landing-screenshots.cjs
 *
 * Output: src/features/landing/assets/*.png. Override the origin with LANDING_ORIGIN.
 */
const { chromium } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');

const origin = process.env.LANDING_ORIGIN ?? 'http://localhost:3000';
const out = path.resolve(__dirname, '../src/features/landing/assets');

const at = (day, time) => `2026-10-${day}T${time}:00Z`;
const people = [
  { userId: 'u1', email: 'ada@uni.example', displayName: 'Ada Okafor', role: 'OWNER' },
  {
    userId: 'u2',
    email: 'jonas@uni.example',
    displayName: 'Jonas Weber',
    role: 'EDITOR',
  },
  { userId: 'u3', email: 'mei@uni.example', displayName: 'Mei Tanaka', role: 'EDITOR' },
  {
    userId: 'u4',
    email: 'lucas@uni.example',
    displayName: 'Lucas Silva',
    role: 'VIEWER',
  },
];
const user = {
  id: 'u1',
  displayName: 'Ada Okafor',
  email: 'ada@uni.example',
  status: 'ACTIVE',
};
const workspace = {
  id: 'w',
  name: 'Electronics Lab 03 — RC circuits',
  description:
    'Shared sources, the lab report and our measurements for the RC step-response experiment.',
  role: 'OWNER',
  createdAt: at('01', '09:00'),
  updatedAt: at('07', '09:40'),
  archivedAt: null,
};
const sourceBase = {
  workspaceId: 'w',
  contentSha256: 'a'.repeat(64),
  failureSummary: null,
  uploadedBy: 'u1',
  activeVersionNumber: 1,
};
const sources = [
  [
    's1',
    'Lab 03 — instructions',
    'lab03_instructions.pdf',
    'PDF',
    412_000,
    '07',
    '09:12',
  ],
  [
    's2',
    'Lecture 02 — RC circuits',
    'lecture_02_rc_circuits.pdf',
    'PDF',
    2_840_000,
    '06',
    '17:30',
  ],
  ['s3', 'Theory of first-order systems', 'theory.docx', 'DOCX', 96_000, '06', '12:05'],
  ['s4', 'Measurements — run 1 to 4', 'measurements.xlsx', 'XLSX', 58_000, '05', '15:48'],
  ['s5', 'Oscilloscope samples', 'sample_data.csv', 'CSV', 1_320_000, '05', '15:20'],
  [
    's6',
    'Smith 2025 — transient response',
    'smith_2025.pdf',
    'PDF',
    3_940_000,
    '04',
    '10:02',
  ],
].map(([id, displayName, originalFilename, sourceType, sizeBytes, day, time]) => ({
  ...sourceBase,
  id,
  displayName,
  originalFilename,
  sourceType,
  sizeBytes,
  mediaType: 'application/octet-stream',
  status: 'READY',
  activeVersionId: `${id}v`,
  createdAt: at(day, time),
  updatedAt: at(day, time),
}));
const documents = [
  ['d1', 'Lab report — RC step response', 14, '07', '09:40'],
  ['d2', 'Theory notes', 6, '06', '18:15'],
  ['d3', 'Measurement log', 3, '05', '16:10'],
].map(([id, title, revision, day, time]) => ({
  id,
  title,
  contentFormat: 'PROSEMIRROR_JSON',
  revision,
  createdAt: at('01', '10:00'),
  updatedAt: at(day, time),
  archivedAt: null,
}));
const text = (value, marks) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content) => ({ type: 'paragraph', content });
const heading = (value) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [text(value)],
});
const reportContent = {
  type: 'doc',
  content: [
    heading('1. Objective'),
    paragraph(
      text(
        'Determine the time constant of a first-order RC circuit from the step response and compare it with the value predicted from the component values.',
      ),
    ),
    heading('2. Theory'),
    paragraph(
      text(
        'When a step voltage is applied to a series RC circuit, the capacitor voltage rises exponentially towards the supply voltage. The product of resistance and capacitance, τ = RC, is the time constant: after one τ the capacitor has reached about 63% of its final value.',
      ),
    ),
    paragraph(
      text(
        'The transient response is fully described by this single parameter, which is why it can be read directly from the oscilloscope trace.',
      ),
    ),
    heading('3. Methodology'),
    paragraph(
      text(
        'A 10 kΩ resistor and a 100 nF capacitor were driven by a 5 V square wave at 100 Hz. Four runs were recorded with the oscilloscope and exported as CSV for analysis.',
      ),
    ),
  ],
};
const doc = { ...documents[0], content: reportContent };

const citation = (chunkId, sourceId, title, page, section) => ({
  chunkId,
  sourceId,
  title,
  pageStart: page,
  pageEnd: page,
  sectionTitle: section,
  processingVersion: 'retrieval-1:fixture',
  spans: [{ unitId: `unit-${page}`, characterStart: 0, characterEnd: 120 }],
  workspaceId: 'w',
  sourceVersionId: `${sourceId}v`,
  contentHash: 'b'.repeat(64),
});
const evidence = [
  citation('c'.repeat(64), 's2', 'Lecture 02 — RC circuits', 14, 'Step response'),
  citation('d'.repeat(64), 's3', 'Theory of first-order systems', 3, 'Time constant'),
  citation('e'.repeat(64), 's1', 'Lab 03 — instructions', 5, 'Procedure'),
];
const answerText =
  'The time constant τ equals R × C and is the time the capacitor needs to reach about 63% of the supply voltage [1]. With 10 kΩ and 100 nF the predicted value is 1.0 ms [2]. The lab instructions ask you to read τ from the oscilloscope trace at the 63% crossing and compare it with this prediction [3].';
const claims = [
  {
    text: 'The time constant τ equals R × C and is the time the capacitor needs to reach about 63% of the supply voltage.',
    evidenceIds: [evidence[0].chunkId],
  },
  {
    text: 'With 10 kΩ and 100 nF the predicted value is 1.0 ms.',
    evidenceIds: [evidence[1].chunkId],
  },
  {
    text: 'The lab instructions ask you to read τ from the oscilloscope trace at the 63% crossing and compare it with this prediction.',
    evidenceIds: [evidence[2].chunkId],
  },
];
const generation = {
  result: {
    schemaVersion: '1.0',
    requestId: 'r1',
    templateId: 'workspace-question:1',
    templateHash: 'f'.repeat(64),
    model: {
      provider: 'deterministic',
      name: 'fixture',
      version: '1',
      structuredOutput: true,
      streaming: false,
    },
    usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020, estimated: true },
    providerRequestId: 'p1',
    answer: { status: 'SUPPORTED', claims },
  },
  evidence,
  context: {
    builderVersion: '1.0',
    tokenPolicy: 'utf8-conservative-v1',
    budget: { maxTokens: 32768, maxBytes: 24576, collapseExactDuplicates: true },
    contextHash: '1'.repeat(64),
    contextBytes: 1200,
    tokenUpperBound: 900,
    citations: evidence.map((item, index) => ({
      citationKey: `S${index + 1}`,
      chunkId: item.chunkId,
      textReference: null,
    })),
  },
};
const conversation = {
  id: 'c1',
  workspaceId: 'w',
  createdBy: 'u1',
  title: 'What is the time constant of our circuit?',
  createdAt: at('07', '09:20'),
  updatedAt: at('07', '09:24'),
};
const conversationList = [
  conversation,
  {
    ...conversation,
    id: 'c2',
    title: 'Which sources describe the 63% rule?',
    updatedAt: at('06', '17:40'),
  },
  {
    ...conversation,
    id: 'c3',
    title: 'Compare Smith 2025 with Lecture 02',
    updatedAt: at('05', '16:20'),
  },
];
const messages = [
  {
    id: 'm1',
    clientRequestId: 'q1',
    sequence: 1,
    role: 'USER',
    status: 'COMPLETED',
    authorId: 'u1',
    content: 'What is the time constant of our RC circuit and how do we measure it?',
    selectedSourceIds: ['s1', 's2', 's3'],
    response: null,
    errorCode: null,
    createdAt: at('07', '09:21'),
    completedAt: at('07', '09:21'),
  },
  {
    id: 'm2',
    clientRequestId: 'q1',
    sequence: 2,
    role: 'ASSISTANT',
    status: 'COMPLETED',
    authorId: null,
    content: answerText,
    selectedSourceIds: null,
    errorCode: null,
    createdAt: at('07', '09:21'),
    completedAt: at('07', '09:22'),
    response: {
      status: 'SUPPORTED',
      reason: null,
      answer: answerText,
      citations: evidence,
      generation,
    },
  },
];

const column = (index, name, inferredType) => ({
  index,
  name,
  inferredType,
  missingValues: 0,
  profiledValues: 480,
  missingValuesExact: true,
});
const datasetPreview = {
  schemaVersion: '1.0',
  sourceId: 's4',
  sourceVersionId: 's4v',
  versionNumber: 1,
  originalFilename: 'measurements.xlsx',
  sizeBytes: 58_000,
  contentSha256: 'a'.repeat(64),
  format: 'XLSX',
  formulasEvaluated: false,
  truncated: false,
  limits: {
    maxResponseBytes: 262144,
    maxSheets: 8,
    maxColumns: 40,
    maxSampleRows: 20,
    maxCells: 800,
    maxCellBytes: 256,
  },
  warnings: [],
  sheets: [
    {
      name: 'Run 1',
      state: 'visible',
      headerRow: 1,
      formulaPresence: false,
      dimensions: {
        usedRange: 'A1:D481',
        rowCount: 481,
        dataRowCount: 480,
        rowCountEstimated: false,
        scannedRows: 481,
        columnCount: 4,
      },
      columns: [
        column(1, 'time_ms', 'NUMBER'),
        column(2, 'input_V', 'NUMBER'),
        column(3, 'output_V', 'NUMBER'),
        column(4, 'run', 'INTEGER'),
      ],
      sampleRows: [0, 1, 2, 3].map((i) => ({
        rowNumber: i + 2,
        cells: [
          (i * 0.25).toFixed(2),
          '5.00',
          (5 * (1 - Math.exp(-i * 0.25))).toFixed(3),
          '1',
        ],
      })),
      truncated: false,
    },
  ],
};

const server = (state) => async (route) => {
  const p = new URL(route.request().url()).pathname;
  const json = (body) => route.fulfill({ json: body });
  if (p === '/api/me') return json(user);
  if (p === '/api/auth/csrf') return route.fulfill({ status: 204 });
  if (p === '/api/workspaces') return json([workspace]);
  if (p === '/api/workspaces/w') return json(workspace);
  if (p.endsWith('/members')) return json(people);
  if (p.endsWith('/sources')) return json(sources);
  if (/\/sources\/s\d$/.test(p)) return json(sources.find((s) => p.endsWith(s.id)));
  if (p.endsWith('/documents')) return json(documents);
  if (/\/documents\/d1$/.test(p)) return json(doc);
  if (/\/documents\/d\d$/.test(p))
    return json({ ...documents[1], content: reportContent });
  if (/\/(versions|analyses|comments|provenance|snapshots)$/.test(p)) return json([]);
  if (p.endsWith('/ai/conversations'))
    return json({ items: conversationList, nextOffset: null });
  if (/\/ai\/conversations\/c\d$/.test(p))
    return json({ conversation, messages, nextBeforeSequence: null });
  if (p.includes('/retrieval/chunks/'))
    return json({
      ...evidence[0],
      content:
        'The time constant τ = RC is the time needed for the capacitor voltage to reach 63.2% of its final value after a step input.',
    });
  if (p.endsWith('/preview')) return json(datasetPreview);
  state.unhandled.push(p);
  return route.fulfill({
    status: 404,
    json: { status: 404, code: 'RESOURCE_NOT_FOUND', detail: 'fixture' },
  });
};

const shots = [
  { name: 'overview', route: '/app/workspaces/w', ready: 'text=Grounded in' },
  {
    name: 'sources',
    route: '/app/workspaces/w/sources',
    ready: 'text=Oscilloscope samples',
  },
  { name: 'ask', route: '/app/workspaces/w/ask', ready: 'text=predicted value' },
  {
    name: 'editor',
    route: '/app/workspaces/w/documents/d1',
    ready: 'text=2. Theory',
    before: (page) => page.getByRole('tab', { name: 'Ask AI', exact: true }).click(),
  },
  {
    name: 'analysis',
    route: '/app/workspaces/w/analyses/new',
    ready: 'text=Describe what to calculate',
    viewport: { width: 1800, height: 1125 },
    scale: 1.6,
    before: async (page) => {
      await page
        .getByLabel('Analysis request')
        .fill(
          'Fit an exponential to the output voltage of run 1, estimate the time constant and plot measured versus fitted values.',
        );
      await page.getByLabel('Analysis request').blur();
      await page.evaluate(() =>
        document.querySelectorAll('*').forEach((el) => {
          if (el.scrollTop > 0) el.scrollTop = 0;
        }),
      );
    },
  },
];

(async () => {
  await mkdir(out, { recursive: true });
  const browser = await chromium
    .launch({ headless: true, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: true }));
  const state = { unhandled: [] };
  const only = process.argv.slice(2);
  for (const shot of shots) {
    if (only.length && !only.includes(shot.name)) continue;
    const context = await browser.newContext({
      viewport: shot.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: shot.scale ?? 2,
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    await page.route('**/api/**', server(state));
    await page.goto(origin + shot.route);
    await page.waitForSelector(shot.ready, { timeout: 15000 }).catch(() => {
      console.warn(`${shot.name}: marker "${shot.ready}" not found`);
    });
    await shot.before?.(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${shot.name}.png`) });
    console.log('captured', shot.name);
    await context.close();
  }
  if (state.unhandled.length)
    console.warn('Unhandled API paths:', [...new Set(state.unhandled)]);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
