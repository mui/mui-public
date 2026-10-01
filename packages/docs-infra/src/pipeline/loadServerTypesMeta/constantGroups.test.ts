import { describe, it, expect } from 'vitest';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';
import {
  findConstantNamespaces,
  foldConstantNamespaces,
  matchConstantGroups,
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

/** Parses the entrypoint and folds its constant namespaces, the way the pipeline does. */
function foldSources(sources: Record<string, string>) {
  const { program, entrypoint } = createTestProgram(sources, LIB);
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
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('follows namespace exports through `export *`', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * from './button';`,
      'button.ts': `export * as ButtonDataAttributes from './attributes';`,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(
      new Map([['ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
  });

  it('finds constant namespaces nested in other namespace exports', () => {
    const { program, entrypoint } = createTestProgram({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': `
        export { Button } from './button';
        export * as ButtonDataAttributes from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(findConstantNamespaces(entrypoint, program)).toEqual(
      new Map([['Toolbar.ButtonDataAttributes', new Map([['pressed', 'data-pressed']])]]),
    );
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

    expect(findConstantNamespaces(entrypoint, program)).toEqual(new Map());
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

  it('leaves other namespaces untouched', () => {
    const exports = foldSources({
      'index.ts': `export * as Toolbar from './parts';`,
      'parts.ts': BUTTON,
    });

    expect(summarize(exports)).toEqual([{ name: 'Toolbar.Button' }]);
  });
});

describe('matchConstantGroups', () => {
  it('resolves the component each group name stands for', () => {
    const exports = foldSources({
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
    const exports = foldSources({
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
    const exports = foldSources({
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
    const exports = foldSources({
      'index.ts': `
        export { Button } from './button';
        export * as ButtonKeys from './attributes';
      `,
      'button.ts': BUTTON,
      'attributes.ts': BUTTON_DATA_ATTRIBUTES,
    });

    expect(matchConstantGroups(exports).targets).toEqual(new Map());
  });

  it('throws when the name before the suffix is no exported component', () => {
    const exports = foldSources({
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
