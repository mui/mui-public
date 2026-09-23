import { describe, it, expect } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import {
  findConstantGroupOwner,
  findConstantNamespaces,
  foldConstantNamespaces,
  getConstantGroupKind,
} from './constantGroups';
import { createTestProgram } from './parseTestSources';
import { PARSER_OPTIONS } from './constants';

const BUTTON = `
  /** A button. */
  export function Button(props: { label: string }) {
    return null;
  }
`;

/** Parses the entrypoint and folds its constant namespaces, the way the pipeline does. */
function foldSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources);
  return foldConstantNamespaces(
    parseFromProgram(entrypoint, program, PARSER_OPTIONS).exports,
    findConstantNamespaces(entrypoint, program),
  );
}

/** Exports reduced to their names, with a group's members as `name`, `value`, and docs. */
function summarize(exports: tae.ExportNode[]) {
  return exports.map((node) =>
    node.type.kind === 'enum'
      ? {
          name: node.name,
          members: node.type.members.map((member) => ({
            name: member.name,
            value: member.value,
            description: member.documentation?.description,
            type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
          })),
        }
      : { name: node.name },
  );
}

describe('findConstantNamespaces', () => {
  it('finds a namespace export of a module of constants', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `export const pressed = 'data-pressed';`,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(new Set(['ButtonDataAttributes']));
  });

  it('follows namespace exports through `export *`', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * from './button';`,
      'button.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `export const pressed = 'data-pressed';`,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(new Set(['ButtonDataAttributes']));
  });

  it('ignores modules exporting anything besides literal constants', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `
        export * as Button from './parts';
        export * as ButtonHelpers from './helpers';
        export * as ButtonTypes from './types';
        export * as ButtonSettings from './settings';
      `,
      'parts.ts': BUTTON,
      'helpers.ts': `
        export const pressed = 'data-pressed';
        export function isPressed() {
          return true;
        }
      `,
      'types.ts': `export type Pressed = 'data-pressed';`,
      'settings.ts': `export let label = 'label';`,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(new Set());
  });
});

describe('foldConstantNamespaces', () => {
  it('collapses a constant namespace into one group in place of its members', () => {
    const exports = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as ButtonDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': `
        /** Present when pressed. */
        export const pressed = 'data-pressed';
        /**
         * The button's width.
         * @type {number}
         */
        export const width = '--button-width';
      `,
    });

    expect(summarize(exports)).toEqual([
      { name: 'Button' },
      {
        name: 'ButtonDataAttributes',
        members: [
          {
            name: 'pressed',
            value: 'data-pressed',
            description: 'Present when pressed.',
            type: undefined,
          },
          {
            name: 'width',
            value: '--button-width',
            description: "The button's width.",
            type: 'number',
          },
        ],
      },
    ]);
  });

  it('reads constants re-exported or referenced from another module, and numbers', () => {
    const exports = foldSources({
      'index.ts': `export * as ButtonCssVars from './vars';`,
      'vars.ts': `
        import { shared } from './shared';
        export * from './shared';
        export const alias = shared;
        export const depth = 2;
      `,
      'shared.ts': `export const shared = '--shared';`,
    });

    expect(
      summarize(exports).flatMap(
        (node) => node.members?.map((member) => [member.name, member.value]) ?? [],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['shared', '--shared'],
        ['alias', '--shared'],
        ['depth', '2'],
      ]),
    );
  });

  it('leaves other namespaces untouched', () => {
    const exports = foldSources({
      'index.ts': `export * as Button from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(summarize(exports)).toEqual([{ name: 'Button.Button' }]);
  });
});

describe('getConstantGroupKind', () => {
  it('tells data attributes and CSS variables apart by their values', () => {
    expect(getConstantGroupKind(['data-open', 'data-closed'])).toBe('data-attributes');
    expect(getConstantGroupKind(['--width', '--height'])).toBe('css-variables');
  });

  it('recognizes neither for other or mixed values', () => {
    expect(getConstantGroupKind(['primary', 'secondary'])).toBeUndefined();
    expect(getConstantGroupKind(['data-open', '--width'])).toBeUndefined();
    expect(getConstantGroupKind([])).toBeUndefined();
  });
});

describe('findConstantGroupOwner', () => {
  it('picks the component with the longest name the group name starts with', () => {
    const components = ['Dialog', 'Dialog.Popup', 'AlertDialog', 'AlertDialog.Popup'];

    expect(findConstantGroupOwner('AlertDialogPopupDataAttributes', components)).toBe(
      'AlertDialog.Popup',
    );
    expect(findConstantGroupOwner('DialogPopupCssVariables', components)).toBe('Dialog.Popup');
    expect(findConstantGroupOwner('DialogDataAttributes', components)).toBe('Dialog');
  });

  it('finds no owner when no component name prefixes the group', () => {
    expect(findConstantGroupOwner('ButtonDataAttributes', ['Dialog'])).toBeUndefined();
  });
});
