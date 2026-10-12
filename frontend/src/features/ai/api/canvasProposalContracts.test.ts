import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
const root = resolve(__dirname, '../../../../../contracts/ai/authoring/v2');
const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
it('validates shared reviewed proposals, commands, receipts and discriminated results', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const schema = read('authoring.schema.json');
  ajv.addSchema(schema);
  for (const [type, file] of [
    ['Proposal', 'proposal'],
    ['Accept', 'accept'],
    ['Undo', 'undo'],
    ['Receipt', 'receipt'],
    ['CanvasResult', 'result'],
  ]) {
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${type}` });
    expect(validate(read(`${file}.json`))).toBe(true);
  }
  const proposal = ajv.compile({ $ref: `${schema.$id}#/$defs/Proposal` });
  expect(proposal({ ...read('proposal.json'), mode: 'REPLACE_DOCUMENT' })).toBe(false);
  expect(proposal({ ...read('proposal.json'), paragraphs: [], html: '<script>' })).toBe(
    false,
  );
  const result = ajv.compile({ $ref: `${schema.$id}#/$defs/CanvasResult` });
  expect(result({ ...read('result.json'), kind: 'EXECUTE_TOOL' })).toBe(false);
  expect(result({ ...read('result.json'), kind: 'PROBLEM_HANDOFF' })).toBe(false);
  expect(
    result({
      kind: 'PROBLEM_HANDOFF',
      proposalId: null,
      analysisId: '00000000-0000-4000-8000-000000000001',
      text: 'Saved problem',
    }),
  ).toBe(true);
});
