import { describe, it, expect } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import {
  findConstantGroupReExports,
  foldConstantGroupReExports,
} from './foldConstantGroupReExports';
import { linkConstantGroupReExports } from './linkConstantGroupReExports';
import { transformConstantGroup } from './transformConstantGroup';
import { createTestProgram } from './parseTestSources';
import { PARSER_OPTIONS } from './constants';

const LIB = `interface ReactElement {}`;

const BUTTON = `
  /** A button. */
  export function Button(props: { label: string }): ReactElement {
    return {};
  }
`;

const BUTTON_DATA_ATTRIBUTES = `
  /** Present when pressed. */
  export const pressed = 'data-pressed';
`;

/**
 * Parses sources into the entrypoint's exports and the full export list components are
 * matched against, the way the pipeline hands them to formatting.
 */
function linkSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources, LIB);
  const loadGroup = (filePath: string) =>
    transformConstantGroup(filePath, parseFromProgram(filePath, program, PARSER_OPTIONS).exports);

  const reExports = findConstantGroupReExports(entrypoint, program);
  const exports = foldConstantGroupReExports(
    parseFromProgram(entrypoint, program, PARSER_OPTIONS).exports,
    reExports,
    loadGroup,
  );
  const metaTypes = Array.from(new Set(reExports.values())).flatMap(loadGroup);

  return linkConstantGroupReExports(exports, [...exports, ...metaTypes]);
}

describe('linkConstantGroupReExports', () => {
  it('links a group to the component documenting the same metadata file', () => {
    const links = linkSources({
      'index.ts': `
        export { Button } from './Button';
        export * as ButtonDataAttributes from './ButtonDataAttributes';
      `,
      'Button.ts': BUTTON,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(links).toEqual(
      new Map([
        ['ButtonDataAttributes', { name: 'Button', slug: '#button', suffix: 'data-attributes' }],
      ]),
    );
  });

  it('links a group published under a name that differs from its file', () => {
    const links = linkSources({
      'index.ts': `
        export { Button } from './Button';
        export * as ButtonCssVariables from './ButtonCssVars';
      `,
      'Button.ts': BUTTON,
      'ButtonCssVars.ts': `
        /** The width of the button. */
        export const width = '--button-width';
      `,
    });

    expect(links).toEqual(
      new Map([
        ['ButtonCssVariables', { name: 'Button', slug: '#button', suffix: 'css-variables' }],
      ]),
    );
  });

  it('links a group borrowed from another component to the part that uses it', () => {
    const links = linkSources({
      'index.ts': `
        export * as Toolbar from './parts';
        export * as ToolbarButtonDataAttributes from './ButtonDataAttributes';
      `,
      'parts.ts': `export { Button } from './Button';`,
      'Button.ts': BUTTON,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(links).toEqual(
      new Map([
        [
          'ToolbarButtonDataAttributes',
          { name: 'Button', slug: '#button', suffix: 'data-attributes' },
        ],
      ]),
    );
  });

  it('leaves a group no component documents unlinked', () => {
    const links = linkSources({
      'index.ts': `export * as ButtonDataAttributes from './ButtonDataAttributes';`,
      'ButtonDataAttributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(links).toEqual(new Map());
  });
});
