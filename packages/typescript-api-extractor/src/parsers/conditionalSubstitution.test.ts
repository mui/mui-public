import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

it('resolves conditional aliases in a project that reports unused parameters', () => {
  const filePath = '/virtual/unused-parameters.ts';
  const program = createInMemoryProgram(
    filePath,
    `type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };`,
    { noUnusedParameters: true },
  );

  const moduleDefinition = JSON.parse(JSON.stringify(parseFromProgram(filePath, program)));

  expect(moduleDefinition.exports[0].type).toMatchObject({
    kind: 'object',
    properties: [
      { name: 'row', type: { kind: 'typeParameter', name: 'Row' } },
      { name: 'columnId', type: { kind: 'intrinsic', intrinsic: 'string' } },
    ],
  });
});
