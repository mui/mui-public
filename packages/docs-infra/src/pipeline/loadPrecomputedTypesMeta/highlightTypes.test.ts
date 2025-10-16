import { describe, it, expect } from 'vitest';
import { decompress, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import { highlightTypes } from './highlightTypes';

/**
 * Test helper to check if a HAST element has dataPrecompute property.
 */
function hasDataPrecompute(node: any): boolean {
  return (
    node?.type === 'element' &&
    node.tagName === 'pre' &&
    typeof node.properties?.dataPrecompute === 'string'
  );
}

/**
 * Test helper to parse precomputed data from a HAST element.
 */
function parsePrecomputeData(node: any): any {
  if (hasDataPrecompute(node)) {
    return JSON.parse(node.properties.dataPrecompute);
  }
  return null;
}

/**
 * Test helper to find pre elements in HAST tree.
 */
function findPreElements(node: any): any[] {
  if (!node) {
    return [];
  }
  if (node.type === 'element' && node.tagName === 'pre') {
    return [node];
  }
  if (node.children && Array.isArray(node.children)) {
    return node.children.flatMap((child: any) => findPreElements(child));
  }
  return [];
}

describe('highlightTypes', () => {
  describe('component type transformation', () => {
    it('should add dataPrecompute to code blocks in component description', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [{ type: 'text', value: 'const x = 1;' }],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.description);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);

        // Verify precompute data structure
        const precomputeData = parsePrecomputeData(preElements[0]);
        expect(precomputeData).toHaveProperty('Default');
        expect(precomputeData.Default).toHaveProperty('source');
        expect(precomputeData.Default).toHaveProperty('fileName');
      }
    });

    it('should add dataPrecompute to code blocks in prop type field', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {
                  onClick: {
                    name: 'onClick',
                    type: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [{ type: 'text', value: '() => void' }],
                            },
                          ],
                        },
                      ],
                    },
                    description: undefined,
                    required: false,
                    default: undefined,
                    example: undefined,
                    detailedType: undefined,
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.props.onClick.type);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in prop description', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {
                  value: {
                    name: 'value',
                    type: undefined,
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-tsx'] },
                              children: [{ type: 'text', value: '<Button value="test" />' }],
                            },
                          ],
                        },
                      ],
                    },
                    required: true,
                    default: undefined,
                    example: undefined,
                    detailedType: undefined,
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.props.value.description);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in prop example', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {
                  onChange: {
                    name: 'onChange',
                    type: undefined,
                    description: undefined,
                    required: false,
                    default: undefined,
                    example: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [
                                {
                                  type: 'text',
                                  value: 'onChange={(e) => console.log(e)}',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    detailedType: undefined,
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.props.onChange.example);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in prop detailedType', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {
                  variant: {
                    name: 'variant',
                    type: undefined,
                    description: undefined,
                    required: false,
                    default: undefined,
                    example: undefined,
                    detailedType: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [
                                {
                                  type: 'text',
                                  value: '"primary" | "secondary" | "tertiary"',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.props.variant.detailedType);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in data attributes', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {},
                dataAttributes: {
                  'data-state': {
                    name: 'data-state',
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [{ type: 'text', value: '"open" | "closed"' }],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(
          componentData.data.dataAttributes['data-state'].description,
        );
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in CSS variables', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {},
                dataAttributes: {},
                cssVariables: {
                  '--button-bg': {
                    name: '--button-bg',
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-css'] },
                              children: [{ type: 'text', value: 'var(--button-bg)' }],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(
          componentData.data.cssVariables['--button-bg'].description,
        );
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });
  });

  describe('hook type transformation', () => {
    it('should add dataPrecompute to code blocks in hook description', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'hook' as const,
              name: 'useButton',
              data: {
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [
                            { type: 'text', value: 'const { getRootProps } = useButton();' },
                          ],
                        },
                      ],
                    },
                  ],
                },
                parameters: {},
                returnValue: undefined,
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const hookData = result.Default.types[0];
      if (hookData.type === 'hook') {
        const preElements = findPreElements(hookData.data.description);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in hook parameters', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'hook' as const,
              name: 'useButton',
              data: {
                description: undefined,
                parameters: {
                  options: {
                    name: 'options',
                    type: undefined,
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [
                                {
                                  type: 'text',
                                  value: '{ disabled?: boolean }',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    required: false,
                    default: undefined,
                  },
                },
                returnValue: undefined,
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const hookData = result.Default.types[0];
      if (hookData.type === 'hook') {
        const preElements = findPreElements(hookData.data.parameters.options.description);
        expect(preElements).toHaveLength(1);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });

    it('should add dataPrecompute to code blocks in hook return value when it contains HAST', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'hook' as const,
              name: 'useButton',
              data: {
                description: undefined,
                parameters: {},
                returnValue: {
                  getRootProps: {
                    type: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [
                                {
                                  type: 'text',
                                  value: '() => Record<string, any>',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    description: undefined,
                    required: true,
                    default: undefined,
                    example: undefined,
                    detailedType: undefined,
                  },
                },
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const hookData = result.Default.types[0];
      if (hookData.type === 'hook' && typeof hookData.data.returnValue === 'object') {
        // The returnValue is an object with properties, check the type property of getRootProps
        const getRootProps = (hookData.data.returnValue as any).getRootProps;
        expect(getRootProps).toBeDefined();
        expect(getRootProps.type).toBeDefined();

        const preElements = findPreElements(getRootProps.type);
        expect(preElements.length).toBeGreaterThan(0);
        expect(hasDataPrecompute(preElements[0])).toBe(true);
      }
    });
  });

  describe('multiple variants', () => {
    it('should transform code blocks in all variants', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [{ type: 'text', value: 'const x = 1;' }],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
        Styled: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [{ type: 'text', value: 'const y = 2;' }],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      // Check Default variant
      const defaultData = result.Default.types[0];
      if (defaultData.type === 'component') {
        const defaultPreElements = findPreElements(defaultData.data.description);
        expect(defaultPreElements).toHaveLength(1);
        expect(hasDataPrecompute(defaultPreElements[0])).toBe(true);
      }

      // Check Styled variant
      const styledData = result.Styled.types[0];
      if (styledData.type === 'component') {
        const styledPreElements = findPreElements(styledData.data.description);
        expect(styledPreElements).toHaveLength(1);
        expect(hasDataPrecompute(styledPreElements[0])).toBe(true);
      }
    });
  });

  describe('immutability', () => {
    it('should transform code blocks and add dataPrecompute', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [{ type: 'text', value: 'const x = 1;' }],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      // Result should have dataPrecompute added to code blocks
      const resultPreElement = (result.Default.types[0] as any).data.description.children[0];
      expect(hasDataPrecompute(resultPreElement)).toBe(true);

      // Verify the transformation actually added precompute data
      const precomputeData = parsePrecomputeData(resultPreElement);
      expect(precomputeData).toBeDefined();
      expect(precomputeData.Default).toHaveProperty('source');
    });

    it('should return a new object', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      // Should be a different object reference
      expect(result).not.toBe(variantData);
      expect(result.Default).not.toBe(variantData.Default);
      expect(result.Default.types).not.toBe(variantData.Default.types);
      expect(result.Default.types[0]).not.toBe(variantData.Default.types[0]);
    });
  });

  describe('pass-through behavior', () => {
    it('should pass through other types unchanged', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'other' as const,
              name: 'SomeOtherExport',
              data: {
                name: 'SomeOtherExport',
                type: { kind: 'object' },
              } as any,
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const otherData = result.Default.types[0];
      expect(otherData.type).toBe('other');
      expect(otherData.name).toBe('SomeOtherExport');
      // Should be unchanged (but not same reference due to immutability)
      expect(otherData).toEqual(variantData.Default.types[0]);
    });

    it('should handle undefined fields gracefully', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {
                  onClick: {
                    name: 'onClick',
                    type: undefined,
                    description: undefined,
                    required: false,
                    default: undefined,
                    example: undefined,
                    detailedType: undefined,
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        expect(componentData.data.description).toBeUndefined();
        expect(componentData.data.props.onClick.type).toBeUndefined();
        expect(componentData.data.props.onClick.description).toBeUndefined();
      }
    });
  });

  describe('snapshot tests - precomputed output verification', () => {
    /**
     * Helper to decompress precomputed data from HAST node
     */
    function decompressPrecompute(node: any): Promise<any> {
      return new Promise((resolve, reject) => {
        if (!hasDataPrecompute(node)) {
          reject(new Error('Node does not have dataPrecompute'));
          return;
        }

        const precomputeData = JSON.parse(node.properties.dataPrecompute);
        const variantName = Object.keys(precomputeData)[0];
        const variant = precomputeData[variantName];

        // Handle different source formats
        if (typeof variant.source === 'object' && variant.source.hastGzip) {
          // Decompress the base64-encoded gzipped source
          const compressed = decode(variant.source.hastGzip);
          decompress(compressed, { consume: true }, (err, output) => {
            if (err) {
              reject(err);
            } else {
              const decompressed = strFromU8(output);
              const hast = JSON.parse(decompressed);
              resolve({ ...variant, decompressedHast: hast });
            }
          });
        } else if (typeof variant.source === 'object' && variant.source.hastJson) {
          // Parse JSON directly
          const hast = JSON.parse(variant.source.hastJson);
          resolve({ ...variant, decompressedHast: hast });
        } else if (typeof variant.source === 'string') {
          // Plain string source
          resolve({ ...variant, decompressedHast: null, plainSource: variant.source });
        } else {
          reject(new Error('No valid source found in variant'));
        }
      });
    }

    it('should produce valid highlighted output for TypeScript type signature', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-ts'] },
                          children: [
                            {
                              type: 'text',
                              value: 'type ButtonVariant = "primary" | "secondary";',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.description);
        expect(preElements).toHaveLength(1);

        const decompressed = await decompressPrecompute(preElements[0]);

        // Verify the decompressed HAST structure
        expect(decompressed.decompressedHast).toBeDefined();
        expect(decompressed.decompressedHast.type).toBe('root');
        expect(decompressed.decompressedHast.children).toBeDefined();

        // The HAST should contain syntax-highlighted elements
        expect(decompressed.decompressedHast.children.length).toBeGreaterThan(0);

        // Verify fileName is set
        expect(decompressed.fileName).toMatch(/\.ts$/);

        // Verify source was compressed and can be decompressed
        expect(decompressed.source).toBeDefined();
        if (typeof decompressed.source === 'object' && 'hastGzip' in decompressed.source) {
          expect(typeof decompressed.source.hastGzip).toBe('string');
          expect(decompressed.source.hastGzip.length).toBeGreaterThan(0);
        }

        // Snapshot the decompressed HAST structure
        expect(decompressed.decompressedHast).toMatchSnapshot();
      }
    });

    it('should produce highlighted output for JSX code', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Dialog',
              data: {
                name: 'Dialog',
                description: undefined,
                props: {
                  children: {
                    name: 'children',
                    type: undefined,
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-tsx'] },
                              children: [
                                {
                                  type: 'text',
                                  value: '<Dialog>\n  <DialogTitle>Hello</DialogTitle>\n</Dialog>',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    required: false,
                    default: undefined,
                    example: undefined,
                    detailedType: undefined,
                  },
                },
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.props.children.description);
        expect(preElements).toHaveLength(1);

        const decompressed = await decompressPrecompute(preElements[0]);

        // Verify the decompressed HAST has syntax highlighting
        expect(decompressed.decompressedHast.type).toBe('root');
        const hastChildren = decompressed.decompressedHast.children;
        expect(hastChildren.length).toBeGreaterThan(0);

        // TSX files should be highlighted with appropriate tokens
        expect(decompressed.fileName).toMatch(/\.tsx$/);

        // The HAST structure should contain elements (not just text)
        // This indicates syntax highlighting was applied
        const hasElements = hastChildren.some(
          (child: any) =>
            child.type === 'element' || child.children?.some((c: any) => c.type === 'element'),
        );
        expect(hasElements).toBe(true);

        // Snapshot the decompressed JSX HAST structure
        expect(decompressed.decompressedHast).toMatchSnapshot();
      }
    });

    it('should produce highlighted output for CSS code', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: undefined,
                props: {},
                dataAttributes: {},
                cssVariables: {
                  '--button-bg': {
                    name: '--button-bg',
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-css'] },
                              children: [
                                {
                                  type: 'text',
                                  value: '.button {\n  background: var(--button-bg);\n}',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(
          componentData.data.cssVariables['--button-bg'].description,
        );
        expect(preElements).toHaveLength(1);

        const decompressed = await decompressPrecompute(preElements[0]);

        // Verify CSS highlighting
        expect(decompressed.fileName).toMatch(/\.css$/);
        expect(decompressed.decompressedHast.type).toBe('root');
        expect(decompressed.decompressedHast.children.length).toBeGreaterThan(0);

        // Snapshot the decompressed CSS HAST structure
        expect(decompressed.decompressedHast).toMatchSnapshot();
      }
    });

    it('should handle multiple code blocks with different languages', async () => {
      const variantData = {
        Default: {
          types: [
            {
              type: 'hook' as const,
              name: 'useButton',
              data: {
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-tsx'] },
                          children: [
                            {
                              type: 'text',
                              value: 'const { getRootProps } = useButton();',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                parameters: {
                  options: {
                    name: 'options',
                    type: 'UseButtonOptions', // type is a string, not HastRoot
                    description: {
                      type: 'root',
                      children: [
                        {
                          type: 'element',
                          tagName: 'pre',
                          properties: {},
                          children: [
                            {
                              type: 'element',
                              tagName: 'code',
                              properties: { className: ['language-ts'] },
                              children: [
                                {
                                  type: 'text',
                                  value: 'interface UseButtonOptions {\n  disabled?: boolean;\n}',
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    required: false,
                    default: undefined,
                  },
                },
                returnValue: undefined,
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const hookData = result.Default.types[0];
      if (hookData.type === 'hook') {
        // Check description (TSX)
        const descPreElements = findPreElements(hookData.data.description);
        expect(descPreElements).toHaveLength(1);
        const descDecompressed = await decompressPrecompute(descPreElements[0]);
        expect(descDecompressed.fileName).toMatch(/\.tsx$/);

        // Check parameter description (TS) - type field is just a string
        const paramPreElements = findPreElements(hookData.data.parameters.options.description);
        expect(paramPreElements).toHaveLength(1);
        const paramDecompressed = await decompressPrecompute(paramPreElements[0]);
        expect(paramDecompressed.fileName).toMatch(/\.ts$/);

        // Both should have valid HAST structures
        expect(descDecompressed.decompressedHast.type).toBe('root');
        expect(paramDecompressed.decompressedHast.type).toBe('root');

        // Snapshot both outputs to verify different language highlighting
        expect({
          description: descDecompressed.decompressedHast,
          parameterDescription: paramDecompressed.decompressedHast,
        }).toMatchSnapshot();
      }
    });

    it('should preserve line structure in decompressed output', async () => {
      const multiLineCode = `function Button(props: ButtonProps) {
  const { children, ...rest } = props;
  return <button {...rest}>{children}</button>;
}`;

      const variantData = {
        Default: {
          types: [
            {
              type: 'component' as const,
              name: 'Button',
              data: {
                name: 'Button',
                description: {
                  type: 'root',
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      properties: {},
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          properties: { className: ['language-tsx'] },
                          children: [{ type: 'text', value: multiLineCode }],
                        },
                      ],
                    },
                  ],
                },
                props: {},
                dataAttributes: {},
                cssVariables: {},
              },
            },
          ] as any,
        },
      };

      const result = await highlightTypes(variantData);

      const componentData = result.Default.types[0];
      if (componentData.type === 'component') {
        const preElements = findPreElements(componentData.data.description);
        const decompressed = await decompressPrecompute(preElements[0]);

        // The decompressed HAST should preserve line structure
        expect(decompressed.decompressedHast.children).toBeDefined();

        // Should have multiple lines represented in the structure
        // (exact structure depends on highlighter, but should not be a single text node)
        const allTextContent = JSON.stringify(decompressed.decompressedHast);
        expect(allTextContent).toContain('children');
        expect(allTextContent).toContain('rest');
        expect(allTextContent).toContain('button');

        // Snapshot the multi-line code structure
        expect(decompressed.decompressedHast).toMatchSnapshot();
      }
    });
  });
});
