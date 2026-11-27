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

// Shows each export as `Name<Arguments>: shape`, close to how the docs show it, so a test
// reads as the expected documentation. Named types inside a shape render as their name.
function showExports(files: Record<string, string>): Record<string, string> {
  const program = createInMemoryProgram(files);
  const { exports } = JSON.parse(
    JSON.stringify(parseFromProgram('/virtual/input.ts', program, { onWarning: () => {} })),
  );
  return Object.fromEntries(
    exports.map((exportNode: any) => [
      exportNode.name,
      `${exportNode.type.typeName ? showTypeName(exportNode.type.typeName) : '-'}: ${showType(exportNode.type)}`,
    ]),
  );
}

function showTypeName(typeName: any): string {
  const typeArguments = typeName.typeArguments
    ? `<${typeName.typeArguments.map((argument: any) => showType(argument.type, true)).join(', ')}>`
    : '';
  return `${[...(typeName.namespaces ?? []), typeName.name].join('.')}${typeArguments}`;
}

function showType(type: any, nested = false): string {
  if (nested && type.typeName && type.kind !== 'typeParameter') {
    return showTypeName(type.typeName);
  }
  switch (type.kind) {
    case 'union':
      return type.types.map((member: any) => showType(member, true)).join(' | ');
    case 'object':
      return `{ ${type.properties
        .map((property: any) => `${property.name}: ${showType(property.type, true)}`)
        .join('; ')} }`;
    case 'array': {
      const element = showType(type.elementType, true);
      return `${type.isReadonly ? 'readonly ' : ''}${element.includes(' ') ? `(${element})` : element}[]`;
    }
    case 'literal':
      return String(type.value);
    case 'intrinsic':
      return type.intrinsic;
    case 'typeParameter':
      return type.name;
    default:
      return type.kind;
  }
}

const isAny = 'type IsAny<Value> = 0 extends 1 & Value ? true : false;';

it('resolves a conditional to the branch every type argument but `any` takes', () => {
  expect(
    showExports({
      '/virtual/input.ts': `${isAny}

export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };

// A default of \`any\` is ignored in favor of the constraint.
export type DefaultedCell<Row, Columns extends readonly { id: string }[] = any> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };

// The tested type parameter only appears on the extends side.
export type InlineCell<Columns extends readonly { id: string }[]> = 0 extends 1 & Columns
  ? { columnId: any }
  : { columnId: Columns[number]['id'] };

// A type parameter constrained by a tested one stays generic.
export type IdCell<Columns extends readonly { id: string }[], Id extends Columns[number]['id']> =
  IsAny<Columns> extends true ? { columnId: any } : { columnId: Id };

export type { Cell as RowCell };

type ForwardedCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

export namespace DataGrid {
  export interface ColumnData {
    id: string;
  }

  // The constraint refers to a name only visible inside the namespace.
  export type RowCell<Row, Columns extends readonly ColumnData[]> =
    IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

  export type ShapeCell<Row, Columns extends readonly ColumnData[]> =
    IsAny<Columns> extends true ? { loose: any } : { row: Row };

  export type Cell<Row, Columns extends readonly { id: string }[]> = ForwardedCell<Row, Columns>;
}

// The branches have different properties.
export type Shape<Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { loose: any } : { columnId: Columns[number]['id'] };

// Every member of a union constraint takes the same branch.
export type Either<Value extends readonly string[] | readonly number[]> =
  IsAny<Value> extends true ? { value: any } : { value: Value };`,
    }),
  ).toEqual({
    Cell: 'Cell<Row, Columns>: { row: Row; columnId: string }',
    DefaultedCell: 'DefaultedCell<Row, Columns>: { row: Row; columnId: string }',
    InlineCell: 'InlineCell<Columns>: { columnId: string }',
    IdCell: 'IdCell<Columns, Id>: { columnId: Id }',
    RowCell: 'Cell<Row, Columns>: { row: Row; columnId: string }',
    'DataGrid.ColumnData': 'DataGrid.ColumnData: { id: string }',
    'DataGrid.RowCell': 'DataGrid.RowCell<Row, Columns>: { row: Row; columnId: string }',
    'DataGrid.ShapeCell': 'DataGrid.ShapeCell<Row, Columns>: { row: Row }',
    'DataGrid.Cell': 'DataGrid.Cell<Row, Columns>: { row: Row; columnId: string }',
    Shape: 'Shape<Columns>: { columnId: string }',
    Either: 'Either<Value>: { value: readonly string[] | readonly number[] }',
  });
});

it('keeps the union when the branch depends on the type argument', () => {
  expect(
    showExports({
      '/virtual/input.ts': `${isAny}

// A narrower type argument than the constraint takes the other branch.
export type Value<Mode extends string> = Mode extends 'multiple'
  ? { value: string[] }
  : { value: string };

// The branch depends on the type argument, whatever the default.
export type Selected<Item, Multiple extends boolean = false> = Multiple extends true
  ? { value: Item[] }
  : { value: Item };

// Nothing bounds the tested type parameter.
export type Unconstrained<Multiple> = Multiple extends true ? { value: string[] } : { value: string };

// The constraint and \`never\` take different branches.
export type Middle<Key extends 'a' | 'b'> = [Key] extends ['a']
  ? [Key] extends [never]
    ? { none: true }
    : { a: true }
  : { other: true };

// A distributive condition, left to the type resolvers.
export type Items<List extends readonly string[]> = List extends readonly unknown[]
  ? { items: List }
  : { item: List };

// The export documents the value that shares the alias's name.
export function Merged(props: { row: string }) {
  return props.row;
}

export type Merged<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

type IsEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

// Both ends of the constraint take one branch, one of its members the other.
export type Selection<Mode extends 'single' | 'multiple'> =
  IsEqual<Mode, 'multiple'> extends true ? { value: string[] } : { value: string };

export type SelectionMode = 'single' | 'multiple';

export type AliasedSelection<Mode extends SelectionMode> =
  IsEqual<Mode, 'multiple'> extends true ? { value: string[] } : { value: string };

export type FlagSelection<Multiple extends boolean> =
  IsEqual<Multiple, true> extends true ? { value: string[] } : { value: string };

type IsUnion<T, U = T> = [T] extends [never] ? false : T extends unknown ? ([U] extends [T] ? false : true) : never;

// Every member and \`never\` take one branch, the whole constraint the other.
export type Pick3<K extends 'a' | 'b'> = IsUnion<K> extends true ? { many: K[] } : { one: K };

export type Wide<Multiple extends boolean> = boolean extends Multiple ? { wide: true } : { narrow: Multiple };`,
    }),
  ).toEqual({
    Value: 'Value<Mode>: { value: string | string[] }',
    Selected: 'Selected<Item, Multiple>: { value: Item | Item[] }',
    Unconstrained: 'Unconstrained<Multiple>: { value: string | string[] }',
    Middle: '-: { none: true } | { a: true } | { other: true }',
    Items: 'Items<List>: { items: readonly string[] }',
    Merged: 'Merged: function',
    Selection: 'Selection<Mode>: { value: string | string[] }',
    SelectionMode: 'SelectionMode: "single" | "multiple"',
    AliasedSelection: 'AliasedSelection<Mode>: { value: string | string[] }',
    FlagSelection: 'FlagSelection<Multiple>: { value: string | string[] }',
    Pick3: '-: { many: K[] } | { one: K }',
    Wide: '-: { wide: true } | { narrow: Multiple }',
  });
});

it('resolves a conditional reached through aliases in other files', () => {
  expect(
    showExports({
      '/virtual/types.ts': `${isAny}

export type DataGridRowCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };`,
      '/virtual/value.ts': `import type { DataGridRowCell } from './types';

type DataGridValueCell<R, C extends readonly { id: string }[]> = DataGridRowCell<R, C>;

export namespace DataGridValue {
  export type Cell<Row, Columns extends readonly { id: string }[]> = DataGridValueCell<Row, Columns>;
}`,
      '/virtual/input.ts': "export type { DataGridValue } from './value';",
    }),
  ).toEqual({
    DataGridValue: '-: any',
    'DataGridValue.Cell': 'DataGridValue.Cell<Row, Columns>: { row: Row; columnId: string }',
  });
});

it('resolves a conditional declared in a global script', () => {
  expect(
    showExports({
      '/virtual/globals.d.ts': `type GlobalCell<Columns extends readonly { id: string }[]> =
  0 extends 1 & Columns ? { columnId: any } : { columnId: string };`,
      '/virtual/input.ts': `/// <reference path="./globals.d.ts" />

export type Cell<Columns extends readonly { id: string }[]> = GlobalCell<Columns>;`,
    }),
  ).toEqual({ Cell: 'GlobalCell<Columns>: { columnId: string }' });
});
