import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
const read = (name: string) =>
  JSON.parse(readFileSync(`../contracts/document/report/v2/${name}`, 'utf8'));
test('frozen report v2 preserves controlled math and closed immutable receipt', () => {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(read('report.schema.json'));
  const fixture = read('report.json');
  expect(validate(fixture)).toBe(true);
  expect(validate({ ...fixture, html: '<script>' })).toBe(false);
  const hostile = read('report.json');
  hostile.blocks[0].content[1].math.ast = { op: 'symbol', name: '\\input{evil}' };
  expect(validate(hostile)).toBe(false);
  const invented = read('report.json');
  invented.blocks[2].provenance.solution.interpretation = 'CHECKED';
  expect(validate(invented)).toBe(false);
  const receipt = read('report.json');
  receipt.blocks[2].provenance.solution.receipt.html = 'evil';
  expect(validate(receipt)).toBe(false);
});
