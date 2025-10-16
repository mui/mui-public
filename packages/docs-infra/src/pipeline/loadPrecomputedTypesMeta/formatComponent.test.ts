import { describe, it, expect } from 'vitest';
import { formatComponentData, isPublicComponent } from './formatComponent';

describe('formatComponent', () => {
  describe('isPublicComponent', () => {
    it('should reject non-ComponentNode types', () => {
      expect(
        isPublicComponent({
          type: { kind: 'function' },
          isPublic: () => true,
        } as any),
      ).toBe(false);
    });

    it('should reject components with @ignore tag', () => {
      // Tests the @ignore tag filtering logic. The type instanceof check is bypassed
      // by using a plain object mock, focusing on the documentation tag validation.
      expect(
        isPublicComponent({
          type: { kind: 'component' },
          documentation: { hasTag: (n: string) => n === 'ignore' },
          isPublic: () => true,
        } as any),
      ).toBe(false);
    });

    it('should reject non-public components', () => {
      expect(
        isPublicComponent({
          type: { kind: 'component' },
          isPublic: () => false,
        } as any),
      ).toBe(false);
    });
  });

  describe('formatComponentData', () => {
    it('should format basic component metadata including name and description', async () => {
      const result = await formatComponentData(
        {
          name: 'Button',
          type: { kind: 'component', props: [] },
          documentation: { description: 'A button' },
        } as any,
        [],
        [],
      );

      expect(result.name).toBe('Button');
      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'A button' }],
          },
        ],
      });
    });

    it('should remove documentation URL suffix from description', async () => {
      const result = await formatComponentData(
        {
          name: 'Input',
          type: { kind: 'component', props: [] },
          documentation: { description: 'Input\n\nDocumentation: url' },
        } as any,
        [],
        [],
      );

      expect(result.description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Input' }],
          },
        ],
      });
    });

    it('should find data attributes by suffix', async () => {
      const result = await formatComponentData(
        { name: 'Checkbox', type: { kind: 'component', props: [] } } as any,
        [
          {
            name: 'CheckboxDataAttributes',
            type: {
              kind: 'enum',
              members: [{ value: 'data-checked', documentation: { description: 'Checked' } }],
            },
          },
        ] as any,
        [],
      );

      expect(result.dataAttributes['data-checked'].type).toBeUndefined();
      expect(result.dataAttributes['data-checked'].description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Checked' }],
          },
        ],
      });
    });

    it('should find CSS variables by suffix', async () => {
      const result = await formatComponentData(
        { name: 'Slider', type: { kind: 'component', props: [] } } as any,
        [
          {
            name: 'SliderCssVars',
            type: {
              kind: 'enum',
              members: [
                {
                  value: '--color',
                  documentation: { description: 'Color', tags: [{ name: 'type', value: 'color' }] },
                },
              ],
            },
          },
        ] as any,
        [],
      );

      expect(result.cssVariables['--color'].type).toBe('color');
      expect(result.cssVariables['--color'].description).toMatchObject({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            children: [{ type: 'text', value: 'Color' }],
          },
        ],
      });
    });

    it('should rewrite .RootInternal to .Root', async () => {
      const result = await formatComponentData(
        {
          name: 'Button',
          type: {
            kind: 'component',
            props: [
              {
                name: 'ref',
                type: { kind: 'literal', value: '"Button.RootInternal"' },
                optional: true,
                documentation: {},
              },
            ],
          },
        } as any,
        [],
        [],
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Button.Root');
      expect(json).not.toContain('RootInternal');
    });

    it('should rewrite Combobox to Autocomplete for Autocomplete', async () => {
      const result = await formatComponentData(
        {
          name: 'Autocomplete',
          type: {
            kind: 'component',
            props: [
              {
                name: 'ref',
                type: { kind: 'literal', value: '"Combobox.Root"' },
                optional: true,
                documentation: {},
              },
            ],
          },
        } as any,
        [],
        [],
      );

      const json = JSON.stringify(result);
      expect(json).toContain('Autocomplete.');
      expect(json).not.toContain('Combobox.');
    });
  });
});
