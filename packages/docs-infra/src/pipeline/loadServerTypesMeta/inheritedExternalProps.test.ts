import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { parseFromProgram } from 'typescript-api-extractor';
import type { ComponentNode, ExportNode, ObjectNode } from 'typescript-api-extractor';
import { augmentComponentsWithInheritedProps } from './inheritedExternalProps';
import type { InheritedExternalPropsConfig } from './inheritedExternalProps';
import { formatType } from './formatType';

/**
 * Fake design-system package placed under a real `node_modules` directory, so
 * the parser treats the shared props as external (as it does when a downstream
 * library inherits props from an installed package).
 */
const DESIGN_SYSTEM_TYPES = `
import type { ReactElement } from 'react';

export type HTMLProps = Record<string, unknown>;

export type ComponentRenderFn<Props, State> = (props: Props, state: State) => ReactElement;

export type StyledComponentProps<ElementType extends string, State, RenderFunctionProps = HTMLProps> = {
  /**
   * CSS class applied to the element, or a function that
   * returns a class based on the component's state.
   */
  className?: string | ((state: State) => string | undefined) | undefined;
  /**
   * Allows you to replace the component's HTML element
   * with a different tag, or compose it with another component.
   */
  render?: ReactElement | ComponentRenderFn<RenderFunctionProps, State> | undefined;
  id?: string | undefined;
};
`;

/**
 * A different package declaring a type with the same name as the design
 * system's, used to verify the `from` package guard.
 */
const DECOY_TYPES = `
import type { ReactElement } from 'react';

export type StyledComponentProps<State> = {
  /** Class name from the decoy package. */
  className?: string | ((state: State) => string | undefined) | undefined;
};
`;

const REACT_TYPES = `
export type ReactElement = { type: unknown; props: unknown };
export interface SVGAttributes {
  className?: string | undefined;
  fill?: string | undefined;
}
`;

const LIBRARY_ENTRY = `
import type { ReactElement, SVGAttributes } from 'react';
import type { StyledComponentProps } from '@acme/ui';
import type { StyledComponentProps as DecoyProps } from '@evil/ui';

export interface RootState {
  disabled: boolean;
}

export interface RootProps extends StyledComponentProps<'div', RootState> {
  /**
   * The dataset for the chart.
   */
  data?: string[] | undefined;
}

/**
 * Groups all chart parts.
 */
export declare function Root(props: RootProps): ReactElement;

export declare namespace Root {
  export type Props = RootProps;
  export type State = RootState;
}

export interface CustomState {}

/** Props overriding an inherited prop with a local declaration. */
export interface CustomProps extends StyledComponentProps<'span', CustomState> {
  /**
   * Locally overridden class name.
   */
  className?: string | undefined;
}

export declare function Custom(props: CustomProps): ReactElement;

export declare namespace Custom {
  export type Props = CustomProps;
  export type State = CustomState;
}

export interface DecoyState {}

/** Props inheriting className from a same-named type in a different package. */
export interface DecoyComponentProps extends DecoyProps<DecoyState> {
  label?: string | undefined;
}

export declare function Decoy(props: DecoyComponentProps): ReactElement;

export interface PlainState {}

/** Props inheriting className from React's SVG attributes, not from the configured type. */
export interface PlainProps extends SVGAttributes {
  points?: number[] | undefined;
}

export declare function Plain(props: PlainProps): ReactElement;
`;

const PARSER_OPTIONS = {
  includeExternalTypes: false,
  shouldInclude: ({ depth }: { depth: number }) => depth <= 15,
  shouldResolveObject: ({ propertyCount, depth }: { propertyCount: number; depth: number }) =>
    propertyCount <= 50 && depth <= 15,
};

const CONFIG: InheritedExternalPropsConfig = {
  StyledComponentProps: ['className', 'render'],
};

let projectDir: string;
let program: ts.Program;
let entry: string;
let exports: ExportNode[];

function parseAndAugment(config: InheritedExternalPropsConfig | undefined): ExportNode[] {
  const result = parseFromProgram(entry, program, PARSER_OPTIONS);
  augmentComponentsWithInheritedProps(
    result.exports,
    program,
    program.getSourceFile(entry)!,
    config,
  );
  return result.exports;
}

function findExport(name: string): ExportNode {
  const exportNode = exports.find((node) => node.name === name);
  if (!exportNode) {
    throw new Error(`Export ${name} not found`);
  }
  return exportNode;
}

function formatProp(component: ComponentNode, propName: string): string {
  const prop = component.props.find((p) => p.name === propName);
  if (!prop) {
    throw new Error(`Prop ${propName} not found`);
  }
  return formatType(prop.type, {
    removeUndefined: prop.optional,
    exportNames: exports.map((node) => node.name),
    typeNameMap: { RootState: 'Root.State' },
  });
}

beforeAll(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'inherited-external-props-'));

  const reactDir = path.join(projectDir, 'node_modules', 'react');
  const designSystemDir = path.join(projectDir, 'node_modules', '@acme', 'ui');
  mkdirSync(reactDir, { recursive: true });
  mkdirSync(designSystemDir, { recursive: true });

  writeFileSync(path.join(reactDir, 'package.json'), '{ "name": "react", "types": "index.d.ts" }');
  writeFileSync(path.join(reactDir, 'index.d.ts'), REACT_TYPES);
  writeFileSync(
    path.join(designSystemDir, 'package.json'),
    '{ "name": "@acme/ui", "types": "index.d.ts" }',
  );
  writeFileSync(path.join(designSystemDir, 'index.d.ts'), DESIGN_SYSTEM_TYPES);

  const decoyDir = path.join(projectDir, 'node_modules', '@evil', 'ui');
  mkdirSync(decoyDir, { recursive: true });
  writeFileSync(
    path.join(decoyDir, 'package.json'),
    '{ "name": "@evil/ui", "types": "index.d.ts" }',
  );
  writeFileSync(path.join(decoyDir, 'index.d.ts'), DECOY_TYPES);

  writeFileSync(path.join(projectDir, 'index.ts'), LIBRARY_ENTRY);

  entry = path.join(projectDir, 'index.ts');
  program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    rootDir: projectDir,
  });

  exports = parseAndAugment(CONFIG);
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('augmentComponentsWithInheritedProps', () => {
  it('adds the configured props to components inheriting them from an external type', () => {
    const component = findExport('Root').type as ComponentNode;
    const propNames = component.props.map((prop) => prop.name);
    expect(propNames).toContain('data');
    expect(propNames).toContain('className');
    expect(propNames).toContain('render');
  });

  it('formats a synthesized union prop like a locally declared one', () => {
    const component = findExport('Root').type as ComponentNode;
    expect(formatProp(component, 'className')).toBe(
      'string | ((state: Root.State) => string | undefined)',
    );
  });

  it('formats a synthesized render prop with the resolved type arguments', () => {
    const component = findExport('Root').type as ComponentNode;
    expect(formatProp(component, 'render')).toBe(
      'ReactElement | ((props: HTMLProps, state: Root.State) => ReactElement)',
    );
  });

  it('takes prop descriptions from the external declaration JSDoc', () => {
    const component = findExport('Root').type as ComponentNode;
    const className = component.props.find((prop) => prop.name === 'className');
    expect(className?.documentation?.description).toContain('CSS class applied to the element');
    expect(className?.optional).toBe(true);
  });

  it('does not add props of the external type that are not configured', () => {
    const component = findExport('Root').type as ComponentNode;
    expect(component.props.map((prop) => prop.name)).not.toContain('id');
  });

  it('mirrors the synthesized props onto the exported props types', () => {
    const namespaced = findExport('Root.Props').type as ObjectNode;
    expect(namespaced.properties.map((prop) => prop.name)).toContain('className');

    const flat = findExport('RootProps').type as ObjectNode;
    expect(flat.properties.map((prop) => prop.name)).toContain('render');
  });

  it('keeps a local override of an inherited prop instead of the external declaration', () => {
    const component = findExport('Custom').type as ComponentNode;
    const classNameProps = component.props.filter((prop) => prop.name === 'className');
    expect(classNameProps).toHaveLength(1);
    expect(formatProp(component, 'className')).toBe('string');
    expect(classNameProps[0].documentation?.description).toContain('Locally overridden class name');

    // Props without a local override are still synthesized from the external type.
    expect(formatProp(component, 'render')).toContain('ReactElement');
  });

  it('keeps the local override in the mirrored props type exports', () => {
    const namespaced = findExport('Custom.Props').type as ObjectNode;
    const classNameProps = namespaced.properties.filter((prop) => prop.name === 'className');
    expect(classNameProps).toHaveLength(1);
    expect(classNameProps[0].documentation?.description).toContain('Locally overridden class name');
    expect(namespaced.properties.map((prop) => prop.name)).toContain('render');
  });

  it('ignores props inherited from types that are not configured', () => {
    const component = findExport('Plain').type as ComponentNode;
    expect(component.props.map((prop) => prop.name)).toEqual(['points']);
  });

  it('matches by type name alone when no package is configured', () => {
    const component = findExport('Decoy').type as ComponentNode;
    expect(component.props.map((prop) => prop.name)).toContain('className');
  });

  it('only augments props declared in the configured package when `from` is set', () => {
    const pinned = parseAndAugment({
      StyledComponentProps: { from: '@acme/ui', props: ['className', 'render'] },
    });

    const root = pinned.find((node) => node.name === 'Root')!.type as ComponentNode;
    expect(root.props.map((prop) => prop.name)).toContain('className');
    expect(root.props.map((prop) => prop.name)).toContain('render');

    const decoy = pinned.find((node) => node.name === 'Decoy')!.type as ComponentNode;
    expect(decoy.props.map((prop) => prop.name)).toEqual(['label']);
  });

  it('does nothing without configuration', () => {
    const unconfigured = parseAndAugment(undefined);
    const component = unconfigured.find((node) => node.name === 'Root')!.type as ComponentNode;
    expect(component.props.map((prop) => prop.name)).toEqual(['data']);
  });
});
