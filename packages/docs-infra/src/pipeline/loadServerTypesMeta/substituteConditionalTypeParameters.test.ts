import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFromProgram } from '@mui/internal-typescript-api-extractor';
import type { ExportNode } from '@mui/internal-typescript-api-extractor';
import { collectExportSymbols } from './collectExportSymbols';
import { PARSER_OPTIONS } from './constants';
import { substituteConditionalTypeParameters } from './substituteConditionalTypeParameters';

interface Parsed {
  original: ExportNode[];
  substituted: ExportNode[];
}

// Sources are written to disk, so they resolve the way a project does. React's types sit in
// the shared `node_modules`, where the parser treats them as external.
let rootDir: string;

beforeAll(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), 'substitute-conditional-'));
  const reactTypesDir = path.dirname(
    createRequire(import.meta.url).resolve('@types/react/package.json'),
  );
  mkdirSync(path.join(rootDir, 'node_modules', '@types'), { recursive: true });
  symlinkSync(reactTypesDir, path.join(rootDir, 'node_modules', '@types', 'react'), 'dir');
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

/** Parses the first source as the entrypoint, before and after substitution. */
function parseSubstituted(sources: Record<string, string>): Parsed {
  const projectDir = mkdtempSync(path.join(rootDir, 'project-'));
  const fileNames = Object.entries(sources).map(([name, text]) => {
    const fileName = path.join(projectDir, name);
    writeFileSync(fileName, text);
    return fileName;
  });
  const entrypoint = fileNames[0];

  const program = ts.createProgram(fileNames, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es5.d.ts'],
    strict: true,
    skipLibCheck: true,
    rootDir: projectDir,
    types: [],
  });
  const original = parseFromProgram(entrypoint, program, PARSER_OPTIONS).exports;
  const substituted = substituteConditionalTypeParameters(
    original,
    collectExportSymbols(program.getSourceFile(entrypoint)!, program.getTypeChecker(), original),
    program,
    PARSER_OPTIONS,
  );
  return { original, substituted };
}

function findExport(exports: ExportNode[], name: string): ExportNode | undefined {
  return exports.find((candidate) => candidate.name === name);
}

function describeExport(exports: ExportNode[], name: string): string {
  const exportNode = findExport(exports, name);
  if (!exportNode) {
    throw new Error(`Missing export: ${name}`);
  }

  // The structure under the alias name, which \`toString()\` would print as the name itself.
  const { type } = exportNode;
  const header = 'typeName' in type && type.typeName ? type.typeName.toString() : '';
  const body =
    'properties' in type
      ? `{ ${type.properties.map((property) => `${property.name}: ${property.type.toString()}`).join('; ')} }`
      : type.toString();
  return `${header} ${body}`;
}

const IS_ANY = `type IsAny<Value> = 0 extends 1 & Value ? true : false;`;

describe('substituteConditionalTypeParameters', () => {
  it('resolves an escape-hatch conditional through its constraint', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };
`,
    });

    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('ignores a default of any', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

export type Cell<Row, Columns extends readonly { id: string }[] = any> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };
`,
    });

    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('detects a type parameter tested only on the extends side', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
export type Cell<Columns extends readonly { id: string }[]> =
  0 extends 1 & Columns ? { columnId: any } : { columnId: Columns[number]['id'] };
`,
    });

    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Columns> { columnId: string }"`,
    );
  });

  it('follows an alias that passes its parameters to a conditional alias', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

type RowCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

export namespace DataRow {
  export type Cell<Row, Columns extends readonly { id: string }[]> = RowCell<Row, Columns>;
}
`,
    });

    expect(describeExport(substituted, 'DataRow.Cell')).toMatchInlineSnapshot(
      `"DataRow.Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('follows aliases across files to a condition on a private helper', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
export { DataGridValue } from './value';
`,
      'value.ts': `
import type { DataGridRowCell } from './types';

type DataGridValueCell<R, C extends readonly { id: string }[]> = DataGridRowCell<R, C>;

export namespace DataGridValue {
  export type Cell<Row, Columns extends readonly { id: string }[]> = DataGridValueCell<
    Row,
    Columns
  >;
}
`,
      'types.ts': `
${IS_ANY}

export type DataGridRowCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };
`,
    });

    expect(describeExport(substituted, 'DataGridValue.Cell')).toMatchInlineSnapshot(
      `"DataGridValue.Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('follows an alias to a condition declared in a global script', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
export type Cell<Columns extends readonly { id: string }[]> = GlobalCell<Columns>;
`,
      'globals.d.ts': `
type GlobalCell<Columns extends readonly { id: string }[]> =
  0 extends 1 & Columns ? { columnId: any } : { columnId: string };
`,
    });

    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"GlobalCell<Columns> { columnId: string }"`,
    );
  });

  it('resolves a constraint written with names local to a namespace', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

export namespace DataGrid {
  export interface ColumnData {
    id: string;
  }

  export type RowCell<Row, Columns extends readonly ColumnData[]> =
    IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };
}
`,
    });

    expect(describeExport(substituted, 'DataGrid.RowCell')).toMatchInlineSnapshot(
      `"DataGrid.RowCell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('keeps type parameters that refer to a substituted one', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

export type Cell<Columns extends readonly { id: string }[], Id extends Columns[number]['id']> =
  IsAny<Columns> extends true ? { columnId: any } : { columnId: Id };
`,
    });

    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Columns, Id> { columnId: Id }"`,
    );
  });

  it('resolves a distributive conditional the constraint takes the true branch of', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
export type Items<List extends readonly string[]> = List extends readonly unknown[]
  ? { items: List }
  : { item: List };
`,
    });

    expect(describeExport(substituted, 'Items')).toMatchInlineSnapshot(
      `"Items<List> { items: readonly string[] }"`,
    );
  });

  it('resolves a declaration reached under two export names once', () => {
    const { substituted } = parseSubstituted({
      'index.ts': `
export { Cell, Cell as RowCell } from './cell';
`,
      'cell.ts': `
export type Cell<Columns extends readonly { id: string }[]> =
  0 extends 1 & Columns ? { columnId: any } : { columnId: string };
`,
    });

    expect(describeExport(substituted, 'RowCell')).toBe(describeExport(substituted, 'Cell'));
    expect(describeExport(substituted, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Columns> { columnId: string }"`,
    );
  });

  it('keeps a conditional the constraint decides differently from a narrower type', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
export type Value<Mode extends string> = Mode extends 'multiple' ? { value: string[] } : { value: string };
`,
    });

    expect(findExport(substituted, 'Value')).toBe(findExport(original, 'Value'));
  });

  it('keeps a conditional whose branch depends on the default', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
export type Selected<Value, Multiple extends boolean = false> = Multiple extends true
  ? { value: Value[] }
  : { value: Value };
`,
    });

    expect(findExport(substituted, 'Selected')).toBe(findExport(original, 'Selected'));
  });

  it('keeps a conditional on an unconstrained type parameter', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
export type Value<Multiple> = Multiple extends true ? { value: string[] } : { value: string };
`,
    });

    expect(findExport(substituted, 'Value')).toBe(findExport(original, 'Value'));
  });

  it('keeps a conditional that differs between its ends and its middle', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
export type Pick<Key extends 'a' | 'b'> = [Key] extends ['a'] ? { a: true } : { other: true };
`,
    });

    expect(findExport(substituted, 'Pick')).toBe(findExport(original, 'Pick'));
  });

  it('leaves a type alias sharing its name with a value untouched', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
${IS_ANY}

export function Cell(props: { row: string }) {
  return props.row;
}

export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };
`,
    });

    expect(findExport(substituted, 'Cell')).toBe(findExport(original, 'Cell'));
  });

  it('leaves aliases without a conditional on their own parameters untouched', () => {
    const { original, substituted } = parseSubstituted({
      'index.ts': `
export type Box<Value> = { value: Value };
`,
    });

    expect(findExport(substituted, 'Box')).toBe(findExport(original, 'Box'));
  });

  describe('with the React types', () => {
    let parsed: Parsed;

    beforeAll(() => {
      parsed = parseSubstituted({
        'index.ts': `import type * as React from 'react';

// The conditional lives in \`@types/react\`, not in this source.
export type RenderElementProps<ElementType extends React.ElementType> =
  React.ComponentPropsWithRef<ElementType>;

// Over React's \`ElementType\`, which includes components with \`any\` props, this
// conditional doesn't take one branch for every type argument.
export type RenderOwnElementProps<ElementType extends React.ElementType> =
  ElementType extends React.JSXElementConstructor<infer Props> ? Props : { type?: string };

// Namespace members carry their public name, so a wrong substitution would show.
export namespace render {
  export type ElementProps<ElementType extends React.ElementType> =
    RenderElementProps<ElementType>;
  export type OwnElementProps<ElementType extends React.ElementType> =
    RenderOwnElementProps<ElementType>;
}
`,
      });
    });

    it('leaves an alias passing its parameter to a conditional from a dependency untouched', () => {
      expect(findExport(parsed.substituted, 'render.ElementProps')).toBe(
        findExport(parsed.original, 'render.ElementProps'),
      );
    });

    it('keeps a conditional over React element types', () => {
      expect(findExport(parsed.substituted, 'render.OwnElementProps')).toBe(
        findExport(parsed.original, 'render.OwnElementProps'),
      );
    });
  });
});
