import { describe, it, expect } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import {
  findConstantGroupReExports,
  foldConstantGroupReExports,
  isConstantGroupReExport,
} from './foldConstantGroupReExports';
import { transformConstantGroup } from './transformConstantGroup';
import { createTestProgram } from './parseTestSources';
import { PARSER_OPTIONS } from './constants';

const BUTTON_DATA_ATTRIBUTES = `
  /** Present when pressed. */
  export const pressed = 'data-pressed';
  /** Present when disabled. */
  export const disabled = 'data-disabled';
`;

const BUTTON = `
  /** A button. */
  export function Button(props: { label: string }) {
    return null;
  }
`;

/**
 * Runs detection and folding over in-memory sources the way the pipeline does: the
 * entrypoint is parsed, and each re-exported metadata file is parsed and normalized
 * into its constant group on demand.
 */
function foldSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources);
  const { exports } = parseFromProgram(entrypoint, program, PARSER_OPTIONS);
  const reExports = findConstantGroupReExports(entrypoint, program);

  return foldConstantGroupReExports(exports, reExports, (filePath) =>
    transformConstantGroup(filePath, parseFromProgram(filePath, program, PARSER_OPTIONS).exports),
  );
}

/** Exports reduced to what the rest of the pipeline reads from them. */
function summarize(exports: tae.ExportNode[]) {
  return exports.map((node) => ({
    name: node.name,
    kind: node.type.kind,
    ...(isConstantGroupReExport(node) ? { constantGroupSource: node.constantGroupSource } : {}),
    ...(node.type.kind === 'enum'
      ? { members: node.type.members.map((member) => [member.name, member.value]) }
      : {}),
  }));
}

describe('findConstantGroupReExports', () => {
  it('maps a namespace re-export of a metadata file to that file', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * as ButtonDataAttributes from './ButtonDataAttributes';`,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(findConstantGroupReExports(entrypoint, program)).toEqual(
      new Map([['ButtonDataAttributes', '/virtual/ButtonDataAttributes.ts']]),
    );
  });

  it('follows namespace re-exports through `export *`', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * from './button';`,
      'button.ts': `export * as ButtonDataAttributes from './ButtonDataAttributes';`,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(findConstantGroupReExports(entrypoint, program)).toEqual(
      new Map([['ButtonDataAttributes', '/virtual/ButtonDataAttributes.ts']]),
    );
  });

  it('ignores namespace re-exports of modules that are not metadata files', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * as Button from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(findConstantGroupReExports(entrypoint, program)).toEqual(new Map());
  });
});

describe('foldConstantGroupReExports', () => {
  it('collapses the members of a re-exported metadata file into one constant group', () => {
    const exports = foldSources({
      'index.ts': `
        export { Button } from './Button';
        export * as ButtonDataAttributes from './ButtonDataAttributes';
      `,
      'Button.ts': BUTTON,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(summarize(exports)).toEqual([
      { name: 'Button', kind: 'function' },
      {
        name: 'ButtonDataAttributes',
        kind: 'enum',
        constantGroupSource: 'ButtonDataAttributes',
        members: [
          ['pressed', 'data-pressed'],
          ['disabled', 'data-disabled'],
        ],
      },
    ]);
  });

  it('keeps the public name while recording the file the group came from', () => {
    const exports = foldSources({
      'index.ts': `
        export * as ToggleDataAttributes from './ButtonDataAttributes';
        export * as ToggleCssVariables from './ButtonCssVars';
      `,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
      'ButtonCssVars.ts': `
        /** The width of the button. */
        export const width = '--button-width';
      `,
    });

    expect(summarize(exports)).toEqual([
      {
        name: 'ToggleDataAttributes',
        kind: 'enum',
        constantGroupSource: 'ButtonDataAttributes',
        members: [
          ['pressed', 'data-pressed'],
          ['disabled', 'data-disabled'],
        ],
      },
      {
        name: 'ToggleCssVariables',
        kind: 'enum',
        constantGroupSource: 'ButtonCssVars',
        members: [['width', '--button-width']],
      },
    ]);
  });

  it('carries member descriptions over to the group', () => {
    const [group] = foldSources({
      'index.ts': `export * as ButtonDataAttributes from './ButtonDataAttributes';`,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(
      group.type.kind === 'enum' &&
        group.type.members.map((member) => member.documentation?.description),
    ).toEqual(['Present when pressed.', 'Present when disabled.']);
  });

  it('leaves other namespaces untouched', () => {
    const exports = foldSources({
      'index.ts': `export * as Button from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(summarize(exports)).toEqual([{ name: 'Button.Button', kind: 'function' }]);
  });
});
