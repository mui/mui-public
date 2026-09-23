import { describe, it, expect } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import {
  findConstantGroupExports,
  foldConstantGroups,
  getConstantGroupTarget,
} from './constantGroups';
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

/** Runs detection over in-memory sources. */
function findSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources, LIB);
  return findConstantGroupExports(entrypoint, program);
}

/** Parses the entrypoint and folds its constant groups, the way the pipeline does. */
function foldSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources, LIB);
  return foldConstantGroups(
    parseFromProgram(entrypoint, program, PARSER_OPTIONS).exports,
    findConstantGroupExports(entrypoint, program),
  );
}

/** Exports reduced to their names, a group's members, and the component it is attached to. */
function summarize(exports: tae.ExportNode[]) {
  return exports.map((node) => ({
    name: node.name,
    ...(node.type.kind === 'enum'
      ? {
          members: node.type.members.map((member) => ({
            name: member.name,
            value: member.value,
            description: member.documentation?.description,
            type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
          })),
        }
      : {}),
    ...(getConstantGroupTarget(node) ? { target: getConstantGroupTarget(node) } : {}),
  }));
}

describe('findConstantGroupExports', () => {
  describe('namespaces', () => {
    it('finds a namespace export of a module of constants', () => {
      const { namespaces } = findSources({
        'index.ts': `export * as ButtonDataAttributes from './attributes';`,
        'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      });

      expect(namespaces).toEqual(new Set(['ButtonDataAttributes']));
    });

    it('follows namespace exports through `export *`', () => {
      const { namespaces } = findSources({
        'index.ts': `export * from './button';`,
        'button.ts': `export * as ButtonDataAttributes from './attributes';`,
        'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      });

      expect(namespaces).toEqual(new Set(['ButtonDataAttributes']));
    });

    it('ignores modules exporting anything besides literal constants', () => {
      const { namespaces } = findSources({
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

      expect(namespaces).toEqual(new Set());
    });
  });

  describe('tags', () => {
    it('reads the component a namespace export is tagged with', () => {
      const { targets } = findSources({
        'index.ts': `
          /** @docs-enum dataAttributes Toolbar.Button */
          export * as ToolbarButtonDataAttributes from './attributes';
        `,
        'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      });

      expect(targets).toEqual(
        new Map([
          ['ToolbarButtonDataAttributes', { component: 'Toolbar.Button', kind: 'data-attributes' }],
        ]),
      );
    });

    it('reads tags on re-exported enums under their public name', () => {
      const { targets } = findSources({
        'index.ts': `
          /** @docs-enum cssVariables Button */
          export { Variables as ButtonCssVariables } from './variables';
        `,
        'variables.ts': `export enum Variables { width = '--width' }`,
      });

      expect(targets).toEqual(
        new Map([['ButtonCssVariables', { component: 'Button', kind: 'css-variables' }]]),
      );
    });

    it('reads tags on enums declared in the entrypoint', () => {
      const { targets } = findSources({
        'index.ts': `
          /** @docs-enum dataAttributes Button */
          export enum ButtonDataAttributes { pressed = 'data-pressed' }
        `,
      });

      expect(targets).toEqual(
        new Map([['ButtonDataAttributes', { component: 'Button', kind: 'data-attributes' }]]),
      );
    });

    it('throws on a kind it does not know', () => {
      expect(() =>
        findSources({
          'index.ts': `
            /** @docs-enum events Button */
            export * as ButtonEvents from './attributes';
          `,
          'attributes.ts': BUTTON_DATA_ATTRIBUTES,
        }),
      ).toThrow(/ButtonEvents.*dataAttributes, cssVariables/);
    });

    it('throws when a tag names no component', () => {
      expect(() =>
        findSources({
          'index.ts': `
            /** @docs-enum dataAttributes */
            export * as ButtonDataAttributes from './attributes';
          `,
          'attributes.ts': BUTTON_DATA_ATTRIBUTES,
        }),
      ).toThrow(/ButtonDataAttributes/);
    });
  });
});

describe('foldConstantGroups', () => {
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
      'index.ts': `export * as ButtonCssVariables from './variables';`,
      'variables.ts': `
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
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(summarize(exports)).toEqual([{ name: 'Toolbar.Button' }]);
  });

  it('attaches tagged groups to their component', () => {
    const exports = foldSources({
      'index.ts': `
        export * as Toolbar from './parts';

        /** @docs-enum dataAttributes Toolbar.Button */
        export * as ToolbarButtonDataAttributes from './attributes';

        /** @docs-enum cssVariables Toolbar.Button */
        export { Variables as ToolbarButtonCssVariables } from './variables';
      `,
      'parts.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      'variables.ts': `export enum Variables { width = '--width' }`,
    });

    expect(
      exports
        .map((node) => [node.name, getConstantGroupTarget(node)?.kind])
        .filter(([, kind]) => kind),
    ).toEqual([
      ['ToolbarButtonDataAttributes', 'data-attributes'],
      ['ToolbarButtonCssVariables', 'css-variables'],
    ]);
  });

  it('throws when a tag names a component the entrypoint does not export', () => {
    expect(() =>
      foldSources({
        'index.ts': `
          /** @docs-enum dataAttributes Checkbox */
          export * as ButtonDataAttributes from './attributes';
        `,
        'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      }),
    ).toThrow(/ButtonDataAttributes.*Checkbox/);
  });

  it('throws when a tagged export is not a constant group', () => {
    expect(() =>
      foldSources({
        'index.ts': `
          export { Button } from './button';

          /** @docs-enum dataAttributes Button */
          export * as ButtonHelpers from './helpers';
        `,
        'button.ts': BUTTON,
        'helpers.ts': `
          export function isPressed() {
            return true;
          }
        `,
      }),
    ).toThrow(/ButtonHelpers/);
  });
});
