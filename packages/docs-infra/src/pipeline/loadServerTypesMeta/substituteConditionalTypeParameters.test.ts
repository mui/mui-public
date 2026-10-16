import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import type { ExportNode } from 'typescript-api-extractor';
import { PARSER_OPTIONS } from './constants';
import { createTestProgram } from './parseTestSources';
import { substituteConditionalTypeParameters } from './substituteConditionalTypeParameters';

// The real standard library, so aliases resolve the way they do in a project.
const STANDARD_LIB =
  ts.sys.readFile(`${ts.getDefaultLibFilePath({}).replace(/[^/]+$/, '')}lib.es5.d.ts`) ?? '';

function parseSubstituted(sources: Record<string, string>): ExportNode[] {
  const { program, entrypoint } = createTestProgram(sources, STANDARD_LIB);
  const parsed = parseFromProgram(entrypoint, program, PARSER_OPTIONS);
  return substituteConditionalTypeParameters(parsed.exports, entrypoint, program, PARSER_OPTIONS);
}

function describeExport(exports: ExportNode[], name: string): string | undefined {
  const exportNode = exports.find((candidate) => candidate.name === name);
  if (!exportNode) {
    return undefined;
  }

  const { type } = exportNode;
  const header = 'typeName' in type && type.typeName ? type.typeName.toString() : '';
  return `${header} ${describeBody(type)}`;
}

// The structure under the alias name, which `toString()` would print as the name itself.
function describeBody(type: ExportNode['type']): string {
  if ('properties' in type) {
    const properties = type.properties.map(
      (property) => `${property.name}: ${property.type.toString()}`,
    );
    return `{ ${properties.join('; ')} }`;
  }
  if (type.kind === 'union') {
    return type.types.map((member) => member.toString()).join(' | ');
  }
  if (type.kind === 'intrinsic') {
    return type.intrinsic;
  }
  return type.toString();
}

describe('substituteConditionalTypeParameters', () => {
  it('resolves an escape-hatch conditional through its constraint', () => {
    const exports = parseSubstituted({
      'index.ts': `
type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type Cell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true
    ? { row: Row; columnId: any }
    : { row: Row; columnId: Columns[number]['id'] };
`,
    });

    expect(describeExport(exports, 'Cell')).toMatchInlineSnapshot(
      `"Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('follows an alias that passes its parameters to a conditional alias', () => {
    const exports = parseSubstituted({
      'index.ts': `
type IsAny<Value> = 0 extends 1 & Value ? true : false;

type RowCell<Row, Columns extends readonly { id: string }[]> =
  IsAny<Columns> extends true ? { row: Row; columnId: any } : { row: Row; columnId: string };

export namespace DataRow {
  export type Cell<Row, Columns extends readonly { id: string }[]> = RowCell<Row, Columns>;
}
`,
    });

    expect(describeExport(exports, 'DataRow.Cell')).toMatchInlineSnapshot(
      `"DataRow.Cell<Row, Columns> { row: Row; columnId: string }"`,
    );
  });

  it('prefers the default over the constraint', () => {
    const exports = parseSubstituted({
      'index.ts': `
export type Selected<Value, Multiple extends boolean = false> = Multiple extends true
  ? { value: Value[] }
  : { value: Value };
`,
    });

    expect(describeExport(exports, 'Selected')).toMatchInlineSnapshot(
      `"Selected<Value, Multiple> { value: Value }"`,
    );
  });

  it('leaves aliases without a conditional on their own parameters untouched', () => {
    const exports = parseSubstituted({
      'index.ts': `
export type Box<Value> = { value: Value };
`,
    });

    expect(describeExport(exports, 'Box')).toMatchInlineSnapshot(`"Box<Value> { value: Value }"`);
  });

  // React's types sit in a real `node_modules`, where the parser treats them as external.
  describe('with the React types', () => {
    let projectDir: string;
    let original: ExportNode[];
    let substituted: ExportNode[];

    beforeAll(() => {
      projectDir = mkdtempSync(path.join(tmpdir(), 'substitute-conditional-'));
      const reactTypesDir = path.dirname(
        createRequire(import.meta.url).resolve('@types/react/package.json'),
      );
      mkdirSync(path.join(projectDir, 'node_modules', '@types'), { recursive: true });
      symlinkSync(reactTypesDir, path.join(projectDir, 'node_modules', '@types', 'react'), 'dir');

      const entrypoint = path.join(projectDir, 'index.ts');
      writeFileSync(
        entrypoint,
        `import type * as React from 'react';

// The conditional lives in \`@types/react\`, not in this source.
export type RenderElementProps<ElementType extends React.ElementType> =
  React.ComponentPropsWithRef<ElementType>;

// Over React's \`ElementType\`, which includes components with \`any\` props, this
// conditional resolves to \`any\`.
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
      );

      const program = ts.createProgram([entrypoint], {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
        skipLibCheck: true,
        rootDir: projectDir,
        types: [],
      });
      original = parseFromProgram(entrypoint, program, PARSER_OPTIONS).exports;
      substituted = substituteConditionalTypeParameters(
        original,
        entrypoint,
        program,
        PARSER_OPTIONS,
      );
    });

    afterAll(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('leaves an alias passing its parameter to a conditional from a dependency untouched', () => {
      expect(describeExport(substituted, 'render.ElementProps')).toBe(
        describeExport(original, 'render.ElementProps'),
      );
    });

    it('keeps the original rendering when substitution collapses to any', () => {
      expect(describeExport(substituted, 'render.OwnElementProps')).toBe(
        describeExport(original, 'render.OwnElementProps'),
      );
    });
  });
});
