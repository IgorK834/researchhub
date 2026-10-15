import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../../../../../contracts/analysis/parameters/v1/run.schema.json';
import definitionSchema from '../../../../../contracts/analysis/parameters/v1/definition.schema.json';
import fixture from '../../../../../contracts/analysis/parameters/v1/run.json';
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
it('validates the versioned example and rejects code, coercion and unsafe plot shapes', () => {
  expect(validate(fixture)).toBe(true);
  for (const value of [2, true, null, '1e2', '1.0', '-0']) {
    expect(
      validate({
        ...fixture,
        parameters: { distance: { type: 'DECIMAL', value, unit: 'cm' } },
      }),
    ).toBe(false);
  }
  expect(validate({ ...fixture, code: 'print(1)' })).toBe(false);
  expect(validate({ ...fixture, inputMode: 'AUTO' })).toBe(false);
  expect(
    validate({
      ...fixture,
      plot: {
        parameter: 'distance',
        start: '0',
        end: '1',
        points: 202,
        output: 'result',
      },
    }),
  ).toBe(false);
});
it('requires typed versioned parameter definitions', () => {
  const check = ajv.compile(definitionSchema);
  const definition = {
    schemaVersion: '1.0',
    name: 'distance',
    type: 'DECIMAL',
    unit: 'cm',
    bounds: { minimum: '-1000000000000', maximum: '1000000000000' },
    defaultValue: '100',
    required: true,
  };
  expect(check(definition)).toBe(true);
  expect(check({ ...definition, schemaVersion: '2.0' })).toBe(false);
  expect(check({ ...definition, type: 'CODE' })).toBe(false);
});
