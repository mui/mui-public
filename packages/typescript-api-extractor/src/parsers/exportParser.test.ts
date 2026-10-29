import { expect, it } from 'vitest';
import { parseFromProgram } from '../parser';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

it('emits a merged owner export before its namespace members', () => {
  const inputPath = '/virtual/input.ts';
  const program = createInMemoryProgram(
    inputPath,
    `export function Root(): void {}

export namespace Root {
  export interface Props {
    value: string;
  }
}`,
  );

  const moduleDefinition = parseFromProgram(inputPath, program);

  expect(moduleDefinition.exports.map((exportNode) => exportNode.name)).toEqual([
    'Root',
    'Root.Props',
  ]);
});
