import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { processTypes } from './processTypes';
import type { VariantResult } from './processTypes';
import { matchConstantGroups } from './constantGroups';
import { formatComponentData, isPublicComponent } from './formatComponent';
import { buildTypeCompatibilityMap } from './rewriteTypes';
import { isPublicFunction } from './formatFunction';
import { isPublicHook } from './formatHook';

const REACT = `export interface ReactElement {}`;

const projectDirs: string[] = [];

afterEach(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Runs the types worker's processing over sources written to a temporary project, the way
 * the pipeline does. The first source is the entrypoint.
 */
async function processSources(sources: Record<string, string>): Promise<VariantResult> {
  const projectDir = mkdtempSync(path.join(tmpdir(), 'docs-infra-export-aliases-'));
  projectDirs.push(projectDir);
  for (const [name, text] of Object.entries({ ...sources, 'react.ts': REACT })) {
    const filePath = path.join(projectDir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text);
  }

  const entrypoint = path.join(projectDir, Object.keys(sources)[0]);
  const response = await processTypes({
    projectPath: projectDir,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      rootDir: projectDir,
    },
    resolvedVariantMap: [['Default', pathToFileURL(entrypoint).href]],
    dependencies: [],
    rootContextDir: `${projectDir}/`,
    relativePath: 'types.md',
  });
  if (!response.success || !response.variantData) {
    throw new Error(response.error);
  }
  return response.variantData.Default;
}

/** Formats a component's props the way the pipeline does, returning each prop's type text. */
async function formatPropTypes(variant: VariantResult, componentName: string) {
  const component = variant.exports.find((node) => node.name === componentName);
  if (!component || !isPublicComponent(component)) {
    throw new Error(`${componentName} is not a component`);
  }
  const exportNames = variant.exports.map((node) => node.name);
  const data = await formatComponentData(component, {
    typeCompatibilityMap: buildTypeCompatibilityMap(variant.exports, exportNames),
    exportNames,
  });
  return {
    description: data.descriptionText,
    props: Object.fromEntries(
      Object.entries(data.props).map(([name, prop]) => [name, prop.typeText]),
    ),
  };
}

// A component part exported both inside its component's namespace and, flat, through a
// type-only star export of its own file.
const DIALOG_SOURCES = {
  'index.ts': `
    export * as Dialog from './index.parts';
    export type * from './DialogTrigger';
    export { DialogTriggerDataAttributes } from './DialogTriggerDataAttributes';
  `,
  'index.parts.ts': `export { DialogTrigger as Trigger } from './DialogTrigger';`,
  'DialogTrigger.ts': `
    import type { ReactElement } from './react';

    export interface DialogTriggerState {
      open: boolean;
    }

    export interface DialogTriggerProps<Payload = unknown> {
      payload?: Payload;
      className?: (state: DialogTrigger.State) => string;
    }

    /** Opens the dialog. */
    export const DialogTrigger = function DialogTrigger(props: DialogTriggerProps): ReactElement {
      return {};
    } as DialogTrigger;

    export interface DialogTrigger {
      <Payload>(props: DialogTrigger.Props<Payload>): ReactElement;
    }

    export namespace DialogTrigger {
      export type Props<Payload = unknown> = DialogTriggerProps<Payload>;
      export type State = DialogTriggerState;
    }
  `,
  'DialogTriggerDataAttributes.ts': `
    export enum DialogTriggerDataAttributes {
      /** Present when the dialog is open. */
      popupOpen = 'data-popup-open',
    }
  `,
};

describe('processTypes with export aliases', () => {
  it('documents a component part once, under its namespaced name', async () => {
    const variant = await processSources(DIALOG_SOURCES);

    expect(variant.exports.map((node) => node.name)).toEqual([
      'Dialog.Trigger',
      'Dialog.Trigger.Props',
      'Dialog.Trigger.State',
      'DialogTriggerDataAttributes',
    ]);
    expect(variant.aliases).toEqual({
      DialogTrigger: 'Dialog.Trigger',
      'DialogTrigger.Props': 'Dialog.Trigger.Props',
      'DialogTrigger.State': 'Dialog.Trigger.State',
      DialogTriggerProps: 'Dialog.Trigger.Props',
      DialogTriggerState: 'Dialog.Trigger.State',
    });
    expect(matchConstantGroups(variant.exports).targets).toEqual(
      new Map([
        ['DialogTriggerDataAttributes', { component: 'Dialog.Trigger', kind: 'dataAttributes' }],
      ]),
    );
  });

  it('names references to a declaration by its canonical export', async () => {
    const variant = await processSources(DIALOG_SOURCES);

    expect((await formatPropTypes(variant, 'Dialog.Trigger')).props).toEqual({
      className: '((state: Dialog.Trigger.State) => string) | undefined',
      payload: 'Payload | undefined',
    });
  });

  it('names references by the declaration they refer to, not by their spelling', async () => {
    const variant = await processSources({
      'index.ts': `
        export * as Toolbar from './index.parts';
        export type * from './orientation';
      `,
      'index.parts.ts': `
        export { ToolbarRoot as Root } from './ToolbarRoot';
        export { ToolbarSeparator as Separator } from './ToolbarSeparator';
        export type { Orientation } from './orientation';
      `,
      'orientation.ts': `export type Orientation = 'horizontal' | 'vertical';`,
      'OrientationOptions.ts': `export interface OrientationOptions { loop: boolean }`,
      'ToolbarRoot.ts': `
        import type { ReactElement } from './react';
        import type { Orientation as BaseOrientation } from './orientation';

        export interface ToolbarRootProps {
          orientation?: ToolbarRoot.Orientation;
        }

        /** Groups controls. */
        export function ToolbarRoot(props: ToolbarRootProps): ReactElement {
          return {};
        }

        export namespace ToolbarRoot {
          export type Props = ToolbarRootProps;
          export type Orientation = BaseOrientation;
        }
      `,
      'ToolbarSeparator.ts': `
        import type { ReactElement } from './react';
        import type { Orientation } from './orientation';
        import type { OrientationOptions } from './OrientationOptions';

        export interface ToolbarSeparatorProps {
          orientation?: Orientation;
          options?: OrientationOptions;
        }

        /** Separates controls. */
        export function ToolbarSeparator(props: ToolbarSeparatorProps): ReactElement {
          return {};
        }

        export namespace ToolbarSeparator {
          export type Props = ToolbarSeparatorProps;
        }
      `,
    });

    // `Toolbar.Root.Orientation` renames the `Orientation` the toolbar also exports flat and in
    // its namespace, so all three are one type, documented under its most namespaced name
    expect(variant.aliases).toEqual({
      Orientation: 'Toolbar.Root.Orientation',
      'Toolbar.Orientation': 'Toolbar.Root.Orientation',
    });
    expect((await formatPropTypes(variant, 'Toolbar.Root')).props).toEqual({
      orientation: 'Toolbar.Root.Orientation | undefined',
    });
    expect((await formatPropTypes(variant, 'Toolbar.Separator')).props).toEqual({
      orientation: 'Toolbar.Root.Orientation | undefined',
      options: 'OrientationOptions | undefined',
    });
  });

  it('names a type a part extends by the part, when only its flat export extends it', async () => {
    const variant = await processSources({
      'index.ts': `
        export * as Toolbar from './index.parts';
        export type * from './ToolbarSeparator';
      `,
      'index.parts.ts': `export { ToolbarSeparator as Separator } from './ToolbarSeparator';`,
      'Separator.ts': `
        export interface SeparatorState { vertical: boolean }
        export interface SeparatorProps { className?: (state: SeparatorState) => string }
      `,
      'ToolbarSeparator.ts': `
        import type { ReactElement } from './react';
        import type { SeparatorProps, SeparatorState } from './Separator';

        export interface ToolbarSeparatorState extends SeparatorState {}
        export interface ToolbarSeparatorProps extends SeparatorProps {}

        /** Separates controls. */
        export function ToolbarSeparator(props: ToolbarSeparatorProps): ReactElement {
          return {};
        }

        export namespace ToolbarSeparator {
          export type State = ToolbarSeparatorState;
          export type Props = ToolbarSeparatorProps;
        }
      `,
    });

    expect((await formatPropTypes(variant, 'Toolbar.Separator')).props).toEqual({
      className: '((state: Toolbar.Separator.State) => string) | undefined',
    });
  });

  it('documents a type renamed into a namespace under its namespaced name', async () => {
    const variant = await processSources({
      'index.ts': `
        export * as Field from './index.parts';
        export type * from './FieldValidityData';
      `,
      'index.parts.ts': `export type { FieldValidityData as ValidityData } from './FieldValidityData';`,
      'FieldValidityData.ts': `export type FieldValidityData = { valid: boolean | null };`,
    });

    expect(variant.exports.map((node) => node.name)).toEqual(['Field.ValidityData']);
    expect(variant.aliases).toEqual({ FieldValidityData: 'Field.ValidityData' });
  });

  it('formats a namespaced `use` function as a function, not a hook', async () => {
    const variant = await processSources({
      'index.ts': `export * as Autocomplete from './index.parts';`,
      'index.parts.ts': `export { useFilter } from './useFilter';`,
      'useFilter.ts': `
        /** Matches items against a query. */
        export function useFilter(options?: { locale?: string }): (item: string) => boolean {
          return () => true;
        }
      `,
    });

    const [useFilter] = variant.exports;
    expect(useFilter.name).toBe('Autocomplete.useFilter');
    expect(isPublicFunction(useFilter)).toBe(true);
    expect(isPublicHook(useFilter)).toBe(false);
  });

  it('names a type the entrypoint re-exports under another name by that name', async () => {
    const variant = await processSources({
      'index.ts': `
        export type { State as ToggleState, Holder as ToggleHolder } from './toggle';
        export type { State as SwitchState, Holder as SwitchHolder } from './switch';
        export type { Container } from './container';
      `,
      'toggle.ts': `
        export interface State { on: boolean }
        export interface Holder { state: State }
      `,
      'switch.ts': `
        export interface State { checked: boolean }
        export interface Holder { state: State }
      `,
      'container.ts': `
        interface State { open: boolean }
        export interface Container { state: State }
      `,
    });
    const getStateTypeName = (exportName: string) => {
      const type = variant.exports.find((node) => node.name === exportName)?.type;
      const property = type?.kind === 'object' ? type.properties[0] : undefined;
      return property && 'typeName' in property.type ? property.type.typeName?.name : undefined;
    };

    expect(getStateTypeName('ToggleHolder')).toBe('ToggleState');
    expect(getStateTypeName('SwitchHolder')).toBe('SwitchState');
    // Spelled like an export, but a declaration the entrypoint does not export
    expect(getStateTypeName('Container')).toBe('State');
  });

  it('documents a namespace declared in two blocks once', async () => {
    const variant = await processSources({
      'index.ts': `export * from './Foo';`,
      'Foo.ts': `
        import type { ReactElement } from './react';

        /** Shows foo. */
        export function Foo(props: Foo.Props): ReactElement {
          return {};
        }
        export namespace Foo {
          export type Props = { label: string };
        }
        export namespace Foo {
          export type State = { open: boolean };
        }
      `,
    });

    expect(variant.exports.map((node) => node.name)).toEqual(
      expect.arrayContaining(['Foo', 'Foo.Props', 'Foo.State']),
    );
    expect(variant.aliases).toBeUndefined();
  });

  it('documents a default-exported component under the name it is declared with', async () => {
    const variant = await processSources({
      'index.ts': `
        export { default } from './Button';
        export * from './Button';
      `,
      'Button.ts': `
        import type { ReactElement } from './react';

        type Component<Props> = (props: Props) => ReactElement;

        /** Presses things. */
        export const Button: Component<{ label: string }> = () => ({});
        export default Button;
      `,
    });

    expect(variant.exports.map((node) => node.name)).toEqual(['Button']);
    expect(variant.aliases).toEqual({ default: 'Button' });
  });

  it('links an alias in a description to the section of its namespaced export', async () => {
    const variant = await processSources({
      ...DIALOG_SOURCES,
      'index.ts': `
        export * as Dialog from './index.parts';
        export type * from './DialogTrigger';
        export { DialogTrigger as Opener } from './DialogTrigger';
        export { DialogTriggerDataAttributes } from './DialogTriggerDataAttributes';
      `,
      'DialogTriggerDataAttributes.ts': `
        /** Set on {@link Opener} while the dialog is open. */
        export enum DialogTriggerDataAttributes {
          popupOpen = 'data-popup-open',
        }
      `,
    });

    const attributes = variant.exports.find((node) => node.name === 'DialogTriggerDataAttributes');
    expect(attributes?.documentation?.description).toBe(
      'Set on [`Opener`](#trigger) while the dialog is open.',
    );
  });

  it('documents a renamed export under its own name, without rewriting descriptions', async () => {
    const variant = await processSources({
      'index.ts': `
        export { Button as default } from './Button';
        export { Button } from './Button';
        export { compressHast as compressString, compressHast } from './compress';
      `,
      'Button.ts': `
        import type { ReactElement } from './react';

        /** Prevents the default behavior, unlike {@link compressString}. */
        export function Button(props: { label: string }): ReactElement {
          return {};
        }
      `,
      'compress.ts': `export function compressHast(json: string): string { return json; }`,
    });

    expect(variant.exports.map((node) => node.name)).toEqual(['Button', 'compressHast']);
    expect(variant.aliases).toEqual({ default: 'Button', compressString: 'compressHast' });
    expect((await formatPropTypes(variant, 'Button')).description).toBe(
      'Prevents the default behavior, unlike [`compressString`](#compresshast).',
    );
  });
});
