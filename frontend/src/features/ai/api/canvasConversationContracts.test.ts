import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const root = resolve(__dirname, '../../../../../contracts/ai/conversations/v2');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));

it('validates the shared typed reservation/status fixtures and rejects forged references', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const schema = read('turns.schema.json');
  ajv.addSchema(schema);
  for (const [name, file] of [
    ['FirstTurn', 'firstturn'],
    ['Turn', 'turn'],
    ['TurnState', 'state'],
  ]) {
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
    expect(validate(read(`${file}.json`))).toBe(true);
  }
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/Turn` });
  expect(validate({ ...read('turn.json'), intent: 'SYSTEM' })).toBe(false);
  expect(validate({ ...read('turn.json'), contextId: 'foreign' })).toBe(false);
  expect(
    validate({
      ...read('turn.json'),
      scope: { sourceVersionIds: [], analysisOutputs: [], system: true },
    }),
  ).toBe(false);
});

it('validates v3 memory as data and keeps memory outside S/A evidence', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(read('model-request.schema.json'));
  const request = read('model-request.json');
  expect(validate(request)).toBe(true);
  expect(validate({ ...request, schemaVersion: '2.0' })).toBe(false);
  expect(validate({ ...request, conversationContext: undefined })).toBe(false);
  const forged = structuredClone(request);
  forged.conversationContext.history[0].classification = 'SYSTEM';
  expect(validate(forged)).toBe(false);
  forged.conversationContext.history[0].classification = 'USER_INPUT';
  forged.conversationContext.history[0].evidence = { citationKey: 'S2' };
  expect(validate(forged)).toBe(false);
});
