import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import type { ParserWarning } from '../index';
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

it('resolves conditional aliases across files of a program that is not on disk', () => {
  const program = createInMemoryProgram({
    '/virtual/types.ts': `type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type RowCell<Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { columnId: any } : { columnId: string };`,
    '/virtual/input.ts': `import type { RowCell } from './types';

export type Cell<Columns extends readonly { id: string }[]> = RowCell<Columns>;`,
  });
  const warnings: ParserWarning[] = [];

  const moduleDefinition = JSON.parse(
    JSON.stringify(
      parseFromProgram('/virtual/input.ts', program, {
        onWarning: (warning) => warnings.push(warning),
      }),
    ),
  );

  expect(warnings).toEqual([]);
  expect(moduleDefinition.exports[0].type).toMatchObject({
    kind: 'object',
    properties: [{ name: 'columnId', type: { kind: 'intrinsic', intrinsic: 'string' } }],
  });
});

it('keeps the union and warns when a generated alias does not type-check', () => {
  // `Internal` isn't exported, so the `import()` type the probe next to `MiddleCell` writes
  // can't reach the probe next to `Internal.RowCell`.
  const program = createInMemoryProgram({
    '/virtual/types.ts': `type IsAny<Value> = 0 extends 1 & Value ? true : false;

namespace Internal {
  export type RowCell<Columns extends readonly { id: string }[]> =
    IsAny<Columns> extends true ? { columnId: any } : { columnId: string };
}

export import RowCell = Internal.RowCell;`,
    '/virtual/middle.ts': `import type { RowCell } from './types';

export type MiddleCell<Columns extends readonly { id: string }[]> = RowCell<Columns>;`,
    '/virtual/input.ts': `import type { MiddleCell } from './middle';

type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type Cell<Columns extends readonly { id: string }[]> = MiddleCell<Columns>;

export type LocalCell<Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { columnId: any } : { columnId: string };`,
  });
  const warnings: ParserWarning[] = [];

  const moduleDefinition = JSON.parse(
    JSON.stringify(
      parseFromProgram('/virtual/input.ts', program, {
        onWarning: (warning) => warnings.push(warning),
      }),
    ),
  );

  expect(warnings).toMatchObject([
    {
      code: 'conditional-substitution-failed',
      typeName: 'Cell',
      // The declaration whose generated alias doesn't type-check, not the export.
      filePath: '/virtual/middle.ts',
      line: 3,
      column: 13,
    },
  ]);
  const [cell, localCell] = moduleDefinition.exports;
  expect(cell.type.properties).toEqual([
    expect.objectContaining({ name: 'columnId', type: { kind: 'intrinsic', intrinsic: 'any' } }),
  ]);
  // A failure in one export's aliases leaves the others in the module resolved.
  expect(localCell.type.properties).toEqual([
    expect.objectContaining({ name: 'columnId', type: { kind: 'intrinsic', intrinsic: 'string' } }),
  ]);
});

it('keeps conditionals in `declare global` and ambient module blocks without a warning', () => {
  const program = createInMemoryProgram({
    '/virtual/globals.d.ts': `export {};

declare global {
  type AugmentedCell<Columns extends readonly { id: string }[]> =
    0 extends 1 & Columns ? { columnId: any } : { columnId: string };
}`,
    '/virtual/ambient.d.ts': `declare module 'ambient-cells' {
  export type Cell<Columns extends readonly { id: string }[]> =
    0 extends 1 & Columns ? { columnId: any } : { columnId: string };
}`,
    '/virtual/input.ts': `import type { Cell } from 'ambient-cells';

export type GlobalCell<Columns extends readonly { id: string }[]> = AugmentedCell<Columns>;

export type ModuleCell<Columns extends readonly { id: string }[]> = Cell<Columns>;`,
  });
  const warnings: ParserWarning[] = [];

  const moduleDefinition = JSON.parse(
    JSON.stringify(
      parseFromProgram('/virtual/input.ts', program, {
        onWarning: (warning) => warnings.push(warning),
      }),
    ),
  );

  // An `import()` type of the file can't name these blocks, so they aren't probed.
  expect(warnings).toEqual([]);
  expect(moduleDefinition.exports).toHaveLength(2);
  for (const exportNode of moduleDefinition.exports) {
    expect(exportNode.type.properties).toEqual([
      expect.objectContaining({ name: 'columnId', type: { kind: 'intrinsic', intrinsic: 'any' } }),
    ]);
  }
});
