import { describe, it, expect } from 'vitest';
import type * as tae from '@mui/internal-typescript-api-extractor';
import { foldConstantNamespaces, matchConstantGroups } from './constantGroups';
import { parseTestModule } from './parseTestSources';

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

/** Parses the entrypoint and folds its constant namespaces, the way the pipeline does. */
function foldSources(sources: Record<string, string>) {
  return foldConstantNamespaces(parseTestModule(sources, { lib: LIB }));
}

/** The values of each folded constant namespace, keyed by its path, then member name. */
function readConstantNamespaces(sources: Record<string, string>) {
  const { exports, namespaces } = foldSources(sources);
  return new Map(
    namespaces.map((namespace) => {
      const group = exports.find((node) => node.name === namespace);
      return [
        namespace,
        new Map(
          group?.type.kind === 'enum'
            ? group.type.members.map((member): [string, unknown] => [member.name, member.value])
            : [],
        ),
      ];
    }),
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

describe('foldConstantNamespaces namespace detection', () => {
  it('finds a namespace export of a module of constants', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(namespaces).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('follows namespace exports through `export *`', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * from './button';`,
      'button.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(namespaces).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('finds constant namespaces nested in other namespace exports', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': `
        export { Button } from './button';
        export * as ButtonDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(namespaces).toEqual(
      new Map([['Toolbar.ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('skips type-only exports next to the constants', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export type ButtonDataAttribute = typeof pressed;
        export interface ButtonDataAttributeMap {
          pressed: typeof pressed;
        }
      `,
    });

    expect(namespaces).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('skips type-only namespaces next to the constants', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export type * as Helpers from './helpers';
        export namespace Types {
          export type Pressed = typeof pressed;
        }
      `,
      'helpers.ts': `export type Helper = string;`,
    });

    expect(namespaces).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('reads enum members as constants', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `
        import { Common } from './common';
        export const pressed = Common.pressed;
      `,
      'common.ts': `
        export enum Common {
          pressed = 'data-pressed',
          disabled = 'data-disabled',
        }
      `,
    });

    expect(namespaces).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('ignores modules with runtime exports that have no parsed export of their own', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `
        export * as ButtonDataAttributes from './attributes';
        export * as ButtonCssVariables from './variables';
        export * as ToolbarDataAttributes from './toolbar';
      `,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export default function () {}
      `,
      'variables.ts': `
        export const width = '--width';
        const helpers = { isPressed: () => true };
        export const { isPressed } = helpers;
      `,
      'toolbar.ts': `
        export const orientation = 'data-orientation';
        export default 'data-default' + orientation;
      `,
    });

    expect(namespaces).toEqual(new Map());
  });

  it('ignores modules holding a namespace with runtime values', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export namespace Runtime {
          export const flag = 'flag';
        }
      `,
    });

    expect(namespaces).toEqual(new Map());
  });

  it('ignores modules exporting anything besides literal constants', () => {
    const namespaces = readConstantNamespaces({
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

    expect(namespaces).toEqual(new Map());
  });

  it('ignores a module of constants holding a nested namespace export, but not the nested one', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': `
        export const orientation = 'data-orientation';
        export * as ButtonDataAttributes from './attributes';
      `,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(namespaces).toEqual(
      new Map([['Toolbar.ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('ignores type-only namespace exports', () => {
    const namespaces = readConstantNamespaces({
      'index.ts': `export type * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(namespaces).toEqual(new Map());
  });
});

describe('foldConstantNamespaces', () => {
  it('collapses a constant namespace into one group in place of its members', () => {
    const { exports } = foldSources({
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
    expect(exports.find((node) => node.name === 'ButtonDataAttributes')).toMatchObject({
      isValue: true,
      isType: false,
      isNamespace: true,
    });
  });

  it('reads constants re-exported or referenced from another module, and numbers', () => {
    const { exports } = foldSources({
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
        ['depth', 2],
      ]),
    );
  });

  it('keeps type-only exports next to the constants as they are', () => {
    const { exports } = foldSources({
      'index.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export type ButtonDataAttribute = typeof pressed;
      `,
    });

    expect(summarize(exports)).toEqual([
      {
        name: 'ButtonDataAttributes',
        members: [
          {
            name: 'pressed',
            value: 'data-pressed',
            description: 'Present when pressed.',
            type: undefined,
          },
        ],
      },
      { name: 'ButtonDataAttributes.ButtonDataAttribute' },
    ]);
  });

  it('leaves other namespaces untouched', () => {
    const { exports } = foldSources({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(summarize(exports)).toEqual([{ name: 'Toolbar.Button' }]);
  });
});

describe('matchConstantGroups', () => {
  it('resolves the component each group name stands for', () => {
    const { exports } = foldSources({
      'index.ts': `
        export * as Toolbar from './parts';
        export * as ToolbarButtonDataAttributes from './attributes';
        export { Variables as ToolbarButtonCssVariables } from './variables';
      `,
      'parts.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      'variables.ts': `export enum Variables { width = '--width' }`,
    });

    const { targets, byComponent } = matchConstantGroups(exports);

    expect(targets).toEqual(
      new Map([
        ['ToolbarButtonDataAttributes', { component: 'Toolbar.Button', kind: 'dataAttributes' }],
        ['ToolbarButtonCssVariables', { component: 'Toolbar.Button', kind: 'cssVariables' }],
      ]),
    );
    expect(Object.keys(byComponent.get('Toolbar.Button') ?? {})).toEqual([
      'dataAttributes',
      'cssVariables',
    ]);
  });

  it('resolves groups exported inside a component namespace', () => {
    const { exports } = foldSources({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': `
        export { Button } from './button';
        export * as ButtonDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(matchConstantGroups(exports).targets).toEqual(
      new Map([
        ['Toolbar.ButtonDataAttributes', { component: 'Toolbar.Button', kind: 'dataAttributes' }],
      ]),
    );
  });

  it('reads `*DataAttributes` as data attributes and `*CssVariables` as CSS variables', () => {
    const { exports } = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as ButtonDataAttributes from './attributes';
        export { Variables as ButtonCssVariables } from './variables';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
      'variables.ts': `export enum Variables { width = '--width' }`,
    });

    expect(matchConstantGroups(exports).targets).toEqual(
      new Map([
        ['ButtonDataAttributes', { component: 'Button', kind: 'dataAttributes' }],
        ['ButtonCssVariables', { component: 'Button', kind: 'cssVariables' }],
      ]),
    );
  });

  it('ignores groups with other names', () => {
    const { exports } = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as ButtonKeys from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(matchConstantGroups(exports).targets).toEqual(new Map());
  });

  it('throws for a group of constants with type-only helpers when no component matches', () => {
    const { exports } = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as CheckboxDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': `
        ${BUTTON_DATA_ATTRIBUTES}
        export type * as Helpers from './helpers';
      `,
      'helpers.ts': `export type Helper = string;`,
    });

    expect(() => matchConstantGroups(exports)).toThrow(/CheckboxDataAttributes.*Checkbox/);
  });

  it('throws when the name before the suffix is no exported component', () => {
    const { exports } = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as CheckboxDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(() => matchConstantGroups(exports)).toThrow(/CheckboxDataAttributes.*Checkbox/);
  });
});
