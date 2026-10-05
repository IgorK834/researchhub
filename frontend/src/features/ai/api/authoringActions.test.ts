import { authoringCommand } from './authoringActions';
const base = {
  kind: 'DRAFT',
  action: 'EXPAND',
  revision: 8,
  selection: { from: 3, to: 15, text: 'Human claim.', placementBlock: 2 },
  placement: 'selection',
  instruction: '  Theory  ',
  selected: ['s'],
  all: true,
  length: 700,
  style: 'PLAIN',
  required: false,
} as const;
test('draft has explicit placement, sources, saved revision and mandatory citations', () => {
  expect(authoringCommand(base)).toEqual({
    kind: 'DRAFT',
    expectedRevision: 8,
    placementBlock: 2,
    from: null,
    to: null,
    action: null,
    instruction: 'Theory',
    selectedSourceIds: ['s'],
    lengthTarget: 700,
    stylePreset: 'PLAIN',
    citationRequired: true,
  });
  expect(authoringCommand({ ...base, placement: '0' }).placementBlock).toBe(0);
});
test('plain rewrites use the selected range and no sources; grounded expansion respects the citation control', () => {
  expect(
    authoringCommand({ ...base, kind: 'REWRITE', action: 'SHORTEN', instruction: '' }),
  ).toMatchObject({
    from: 3,
    to: 15,
    selectedSourceIds: [],
    action: 'SHORTEN',
    citationRequired: false,
    instruction: 'Rewrite the selected fragment.',
  });
  expect(
    authoringCommand({ ...base, kind: 'REWRITE', required: true }).citationRequired,
  ).toBe(true);
  expect(
    authoringCommand({ ...base, kind: 'REWRITE', selected: [], required: true })
      .citationRequired,
  ).toBe(false);
  expect(authoringCommand({ ...base, kind: 'REWRITE' }).citationRequired).toBe(false);
});
test('evidence distinguishes all workspace sources from an explicit empty scope', () => {
  expect(authoringCommand({ ...base, kind: 'EVIDENCE', instruction: '' })).toMatchObject({
    action: null,
    placementBlock: null,
    selectedSourceIds: null,
    citationRequired: false,
    instruction: 'Find evidence for this claim.',
  });
  expect(
    authoringCommand({ ...base, kind: 'EVIDENCE', all: false, selected: [] })
      .selectedSourceIds,
  ).toEqual([]);
});
