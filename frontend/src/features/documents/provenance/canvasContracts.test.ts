import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
const root = resolve(__dirname, '../../../../../contracts/ai/canvas/v1');
const read = (name: string) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
it('validates all shared contracts and rejects malformed future actions', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const schema = read('canvas.schema.json');
  ajv.addSchema(schema);
  const names = [
    'Capture',
    'Context',
    'FirstTurn',
    'Turn',
    'TurnState',
    'Proposal',
    'Execution',
    'Accept',
    'Receipt',
  ];
  for (const name of names) {
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` });
    expect(validate(read(`${name.toLowerCase()}.json`))).toBe(true);
  }
  for (const invalid of read('invalid.json')) {
    const name = names.find((n) => n.toLowerCase() === invalid.schema)!;
    expect(ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` })(invalid.payload)).toBe(
      false,
    );
  }
});
