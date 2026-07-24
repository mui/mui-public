import { describe, it, expect } from 'vitest';
import type * as tae from 'typescript-api-extractor';
import { parseSources } from './parseSources.testUtils';
import { transformConstantGroup } from './transformConstantGroup';

/**
 * Parses a metadata file from source and normalizes it, exercising the same path the
 * pipeline takes. Starting from source rather than hand-built nodes keeps these tests
 * honest about what the parser actually emits.
 */
function transformSources(sources: Record<string, string>) {
  const [name] = Object.keys(sources);
  return transformConstantGroup(`/virtual/${name}`, parseSources(sources));
}

/** Reads the single constant group out of a transform result. */
function groupOf(exports: tae.ExportNode[]): { name: string; type: tae.EnumNode } {
  expect(exports).toHaveLength(1);
  const [group] = exports;
  const { type } = group;
  if (type.kind !== 'enum') {
    throw new Error(`expected a constant group, received "${type.kind}"`);
  }
  return { name: group.name, type };
}

/** Members reduced to the shape the documentation tables are built from. */
function membersOf(group: tae.EnumNode) {
  return group.members.map((member) => ({
    name: member.name,
    value: member.value,
    description: member.documentation?.description,
    type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
  }));
}

describe('transformConstantGroup', () => {
  describe('enum declarations', () => {
    it('leaves a file that already exports an enum named after itself untouched', () => {
      const exports = transformSources({
        'ComponentRootDataAttributes.ts': `
          export enum ComponentRootDataAttributes {
            /** Present when open. */
            open = 'data-open',
          }
        `,
      });

      expect(membersOf(groupOf(exports).type)).toEqual([
        { name: 'open', value: 'data-open', description: 'Present when open.', type: undefined },
      ]);
    });

    it('does not treat an enum under a different name as the file’s group', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootDataAttributes.ts': `
            export enum SomeUnrelatedEnum {
              other = 'data-other',
            }
            /** Present when open. */
            export const open = 'data-open';
          `,
        }),
      );

      expect(group.name).toBe('ComponentRootDataAttributes');
      expect(membersOf(group.type).map((member) => member.name)).toEqual(['open']);
    });
  });

  describe('literal modules', () => {
    it('collapses exported constants into one group named after the file', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootDataAttributes.ts': `
            /** Present when open. */
            export const open = 'data-open';
            /** Present when disabled. */
            export const disabled = 'data-disabled';
          `,
        }),
      );

      expect(group.name).toBe('ComponentRootDataAttributes');
      expect(group.type.typeName.name).toBe('ComponentRootDataAttributes');
      expect(membersOf(group.type)).toEqual([
        { name: 'open', value: 'data-open', description: 'Present when open.', type: undefined },
        {
          name: 'disabled',
          value: 'data-disabled',
          description: 'Present when disabled.',
          type: undefined,
        },
      ]);
    });

    it('carries descriptions and JSDoc tags across to the members', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootCssVars.ts': `
            /**
             * The component's height.
             * @type {number}
             */
            export const componentHeight = '--component-height';
          `,
        }),
      );

      expect(membersOf(group.type)).toEqual([
        {
          name: 'componentHeight',
          value: '--component-height',
          description: "The component's height.",
          type: 'number',
        },
      ]);
    });

    it('resolves constants that reference another module', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootDataAttributes.ts': `
            import { startingStyle } from './SharedDataAttributes';

            /** Present when animating in. */
            export const componentStartingStyle = startingStyle;
          `,
          'SharedDataAttributes.ts': `
            /** Present when animating in. */
            export const startingStyle = 'data-starting-style';
          `,
        }),
      );

      expect(membersOf(group.type)).toEqual([
        {
          name: 'componentStartingStyle',
          value: 'data-starting-style',
          description: 'Present when animating in.',
          type: undefined,
        },
      ]);
    });

    it('collects constants re-exported from another metadata file under this file’s name', () => {
      const group = groupOf(
        transformSources({
          'ComponentPartDataAttributes.ts': `export * from './SharedDataAttributes';`,
          'SharedDataAttributes.ts': `
            /** Present when open. */
            export const open = 'data-open';
          `,
        }),
      );

      expect(group.name).toBe('ComponentPartDataAttributes');
      expect(membersOf(group.type)).toEqual([
        { name: 'open', value: 'data-open', description: 'Present when open.', type: undefined },
      ]);
    });

    it('accepts numeric constants, normalizing them to string values', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootCssVars.ts': `
            /** How deeply the component nests. */
            export const depth = 2;
          `,
        }),
      );

      expect(membersOf(group.type)).toEqual([
        {
          name: 'depth',
          value: '2',
          description: 'How deeply the component nests.',
          type: undefined,
        },
      ]);
    });

    it('ignores exports that are not literal constants', () => {
      const group = groupOf(
        transformSources({
          'ComponentRootDataAttributes.ts': `
            /** Present when open. */
            export const open = 'data-open';

            export type Attribute = string;
            export function helper(): string {
              return 'data-open';
            }
          `,
        }),
      );

      expect(membersOf(group.type).map((member) => member.name)).toEqual(['open']);
    });
  });

  describe('unrecognized files', () => {
    it('leaves a file with no literal constants untouched', () => {
      const exports = transformSources({
        'ComponentRootDataAttributes.ts': `
          export function helper(): string {
            return 'data-open';
          }
        `,
      });

      expect(exports.every((node) => node.type.kind !== 'enum')).toBe(true);
      expect(exports.map((node) => node.name)).toEqual(['helper']);
    });

    it('leaves an empty export list untouched', () => {
      const exports: tae.ExportNode[] = [];

      expect(transformConstantGroup('/virtual/ComponentRootDataAttributes.ts', exports)).toBe(
        exports,
      );
    });
  });

  describe('group naming', () => {
    it.each([
      ['/src/ComponentRootDataAttributes.ts', 'ComponentRootDataAttributes'],
      ['/src/ComponentRootDataAttributes.tsx', 'ComponentRootDataAttributes'],
      ['/src/ComponentRootDataAttributes.d.ts', 'ComponentRootDataAttributes'],
      ['/src/deeply/nested/ComponentRootCssVars.ts', 'ComponentRootCssVars'],
      ['C:\\src\\ComponentRootCssVars.ts', 'ComponentRootCssVars'],
      ['file:///src/ComponentRootCssVars.ts', 'ComponentRootCssVars'],
    ])('derives the group name of %s as %s', (filePath, expected) => {
      const parsed = parseSources({
        'ComponentRootDataAttributes.ts': `export const open = 'data-open';`,
      });

      expect(groupOf(transformConstantGroup(filePath, parsed)).name).toBe(expected);
    });
  });
});
