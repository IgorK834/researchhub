import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isAnalysisReference,
  analysisBlock,
} from '../../documents/api/analysisReference';
const root = resolve(__dirname, '../../../../../contracts/analysis');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
test('closed saved solution and document/provenance contracts reject invented verification and refs', () => {
  for (const [schema, fixture] of [
    ['execution/v3/solution.schema.json', 'execution/v3/solution.json'],
    ['document-block/v2/block.schema.json', 'document-block/v2/block.json'],
    ['document-block/v2/request.schema.json', 'document-block/v2/request.json'],
    ['provenance/v2/problem.schema.json', 'provenance/v2/problem.json'],
  ]) {
    const validate = ajv.compile(read(schema!));
    expect(validate(read(fixture!))).toBe(true);
    expect(validate({ ...read(fixture!), html: '<script>' })).toBe(false);
  }
  const validate = ajv.compile(read('execution/v3/solution.schema.json'));
  const saved = read('execution/v3/solution.json');
  expect(
    validate({
      ...saved,
      interpretation: { ...saved.interpretation, status: 'CHECKED' },
    }),
  ).toBe(false);
  expect(validate({ ...saved, codeHashes: {} })).toBe(false);
  expect(validate({ ...saved, steps: [] })).toBe(false);
  const block = read('document-block/v2/block.json');
  expect(isAnalysisReference(block.attrs.reference)).toBe(true);
  expect(
    analysisBlock(block.attrs.reference, 'caption', block.attrs.blockId),
  ).toMatchObject({ type: 'analysisResult' });
  expect(isAnalysisReference({ ...block.attrs.reference, stepId: null })).toBe(false);
  expect(isAnalysisReference({ ...block.attrs.reference, workload: 'DATASET' })).toBe(
    false,
  );
  expect(
    isAnalysisReference({ ...block.attrs.reference, conversationId: 'invalid' }),
  ).toBe(false);
  const refs = ajv.compile(read('document-block/v2/block.schema.json'));
  expect(
    refs({
      ...block,
      attrs: { ...block.attrs, reference: { ...block.attrs.reference, stepId: null } },
    }),
  ).toBe(false);
});
