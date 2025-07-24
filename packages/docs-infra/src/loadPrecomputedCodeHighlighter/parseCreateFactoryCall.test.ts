import { describe, it, expect } from 'vitest';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';

describe('parseCreateFactoryCall', () => {
  // Most common use cases first
  it('should handle single component without options', async () => {
    const code = `
        import Component from './Component';
        
        export const demo = createDemo(
          import.meta.url,
          Component
        );
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.variants).toEqual({
      Default: '/src/Component',
    });
    expect(result!.options).toEqual({});
  });

  it('should handle single component with skipPrecompute option', async () => {
    const code = `
        import Component from './Component';
        
        export const demo = createDemo(
          import.meta.url,
          Component,
          { skipPrecompute: true }
        );
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.variants).toEqual({
      Default: '/src/Component',
    });
    expect(result!.options).toEqual({
      skipPrecompute: true,
    });
  });

  it('should handle single component with different spacing styles', async () => {
    // Compact style
    const compactCode = `
      import Component from './Component';
      createDemo(import.meta.url,Component);
    `;
    const compactResult = await parseCreateFactoryCall(compactCode, '/src/demo.ts');
    expect(compactResult!.variants).toEqual({ Default: '/src/Component' });

    // Spaced style
    const spacedCode = `
      import Component from './Component';
      createDemo( import.meta.url , Component );
    `;
    const spacedResult = await parseCreateFactoryCall(spacedCode, '/src/demo.ts');
    expect(spacedResult!.variants).toEqual({ Default: '/src/Component' });

    // Multiline style
    const multilineCode = `
      import Component from './Component';
      createDemo(
        import.meta.url,
        Component
      );
    `;
    const multilineResult = await parseCreateFactoryCall(multilineCode, '/src/demo.ts');
    expect(multilineResult!.variants).toEqual({ Default: '/src/Component' });
  });

  it('should handle single component with options and different spacing', async () => {
    // Compact with options
    const compactCode = `
      import Component from './Component';
      createDemo(import.meta.url,Component,{name:'Test'});
    `;
    const compactResult = await parseCreateFactoryCall(compactCode, '/src/demo.ts');
    expect(compactResult!.variants).toEqual({ Default: '/src/Component' });
    expect(compactResult!.options).toEqual({ name: 'Test' });

    // Multiline with options
    const multilineCode = `
      import Component from './Component';
      createDemo(
        import.meta.url,
        Component,
        {
          name: 'Test Demo',
          skipPrecompute: true
        }
      );
    `;
    const multilineResult = await parseCreateFactoryCall(multilineCode, '/src/demo.ts');
    expect(multilineResult!.variants).toEqual({ Default: '/src/Component' });
    expect(multilineResult!.options).toEqual({ name: 'Test Demo', skipPrecompute: true });
  });

  // Object syntax cases
  it('should handle shorthand variant syntax', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.variants).toEqual({
      Component: '/src/Component',
    });
  });

  it('should handle explicit variant mapping', async () => {
    const code = `
        import Comp from './Component';
        
        createDemo(import.meta.url, { Component: Comp }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.variants).toEqual({
      Component: '/src/Component',
    });
  });

  it('should parse complete createDemo with imports and return full demo object', async () => {
    const code = `
        import Component1 from './Component1';
        import { Component2 } from './components';
        
        export const demo = createDemo(
          import.meta.url,
          { Component1, Component2 },
          {
            name: 'Test Demo',
            slug: 'test-demo',
            skipPrecompute: true
          }
        );
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.url).toBe('import.meta.url');
    expect(result!.variants).toEqual({
      Component1: '/src/Component1',
      Component2: '/src/components',
    });
    expect(result!.options).toEqual({
      name: 'Test Demo',
      slug: 'test-demo',
      skipPrecompute: true,
    });
  });

  // Error cases
  it('should throw error when single component is not imported', async () => {
    const code = `
        import Component from './Component';
        
        export const demo = createDemo(
          import.meta.url,
          UnknownComponent,
          { name: 'Test' }
        );
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants parameter in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for variants without corresponding imports', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, UnknownComponent }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants parameter in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for explicit variant mapping with unknown component', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, Custom: UnknownComponent }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants parameter in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error when multiple components are not imported', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, Unknown1, Unknown2 }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';

    // Should throw error for the first missing component it encounters
    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants parameter in createDemo call in /src/demo.ts. Component 'Unknown1' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for invalid variants parameter', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, "not an object", { name: 'Invalid' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      'Invalid variants parameter in createDemo call in /src/demo.ts. Expected an object mapping variant names to imports or a single component identifier, but got: "not an object"',
    );
  });

  // Options parsing
  it('should parse options with different quote types', async () => {
    const code = `
        createDemo(import.meta.url, {}, {
          name: "Double quotes",
          slug: 'single quotes',
          description: \`template literal\`,
          skipPrecompute: false
        });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.options).toEqual({
      name: 'Double quotes',
      slug: 'single quotes',
      skipPrecompute: false,
    });
  });

  it('should handle missing options fields', async () => {
    const code = `
        createDemo(import.meta.url, {}, { name: 'Minimal' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.options).toEqual({
      name: 'Minimal',
    });
  });

  it('should preserve unrecognized options fields', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, Component, {
          name: 'Test Demo',
          slug: 'test-slug',
          skipPrecompute: true,
          customOption: 'custom value',
          anotherCustom: 42,
          booleanCustom: false,
          objectCustom: { nested: 'value' }
        });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.options).toEqual({
      name: 'Test Demo',
      slug: 'test-slug',
      skipPrecompute: true,
      // Custom options should be preserved but not parsed into typed fields
    });

    // The full options object string should contain all the original options
    expect(result!.optionsObjectStr).toContain('customOption');
    expect(result!.optionsObjectStr).toContain('anotherCustom');
    expect(result!.optionsObjectStr).toContain('booleanCustom');
    expect(result!.optionsObjectStr).toContain('objectCustom');
  });

  it('should preserve unrecognized options with various formats', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, Component, {
          name: 'Test',
          customString: "double quotes",
          customTemplate: \`template literal\`,
          customNumber: 123.45,
          customArray: [1, 2, 3],
          customFunction: () => console.log('test'),
          customRegex: /pattern/gi
        });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    // Only known options should be parsed
    expect(result!.options).toEqual({
      name: 'Test',
    });

    // But the raw options string should preserve everything
    expect(result!.optionsObjectStr).toContain('customString');
    expect(result!.optionsObjectStr).toContain('customTemplate');
    expect(result!.optionsObjectStr).toContain('customNumber');
    expect(result!.optionsObjectStr).toContain('customArray');
    expect(result!.optionsObjectStr).toContain('customFunction');
    expect(result!.optionsObjectStr).toContain('customRegex');
  });

  it('should preserve unrecognized options alongside precompute values', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, Component, {
          name: 'Test Demo',
          precompute: { some: 'data' },
          customBefore: 'before precompute',
          skipPrecompute: false,
          customAfter: 'after precompute',
          metadata: { version: '1.0', tags: ['demo', 'test'] }
        });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    // Known options should be parsed
    expect(result!.options).toEqual({
      name: 'Test Demo',
      skipPrecompute: false,
      precompute: "{ some: 'data' }", // precompute is stored as string
    });

    // Custom options should be preserved in the raw string
    expect(result!.optionsObjectStr).toContain('customBefore');
    expect(result!.optionsObjectStr).toContain('customAfter');
    expect(result!.optionsObjectStr).toContain('metadata');
    expect(result!.optionsObjectStr).toContain('version');
    expect(result!.optionsObjectStr).toContain('tags');

    // Precompute parsing should work correctly
    expect(result!.hasPrecompute).toBe(true);
    expect(result!.precomputeValue).toBe("{ some: 'data' }"); // precomputeValue is also stored as string
  });

  // Advanced import scenarios
  it('should handle named imports with aliases correctly', async () => {
    const code = `
        import { Component1 as Comp1, Component2 as Comp2 } from './components';

        createDemo(import.meta.url, { Comp1, Comp2 }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.variants).toEqual({
      Comp1: '/src/components',
      Comp2: '/src/components',
    });
  });

  it('should handle complex real-world example', async () => {
    const code = `
        import { createDemo } from '@/functions/createDemo';
        import CssModules from './CssModules';
        import Tailwind from './Tailwind';
        import BasicExample from '../shared/BasicExample';

        export const CodeDemo = createDemo(
          import.meta.url,
          { 
            CssModules, 
            Tailwind,
            Basic: BasicExample 
          },
          {
            name: 'Code Styling Comparison',
            slug: 'code-styling',
            skipPrecompute: true,
          },
        );
      `;
    const filePath = '/src/demos/styling/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.variants).toEqual({
      CssModules: '/src/demos/styling/CssModules',
      Tailwind: '/src/demos/styling/Tailwind',
      Basic: '/src/demos/shared/BasicExample',
    });
    expect(result!.options).toEqual({
      name: 'Code Styling Comparison',
      slug: 'code-styling',
      skipPrecompute: true,
    });
  });

  // Different create* function variants
  it('should work with createCode function', async () => {
    const code = `
        import Component from './Component';
        
        createCode(import.meta.url, { Default: Component }, { name: 'Code Example' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('createCode');
    expect(result!.variants).toEqual({ Default: '/src/Component' });
    expect(result!.options).toEqual({ name: 'Code Example' });
  });

  it('should work with createLiveDemo function', async () => {
    const code = `
        import Component from './Component';
        
        createLiveDemo(import.meta.url, { Example: Component });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('createLiveDemo');
    expect(result!.variants).toEqual({ Example: '/src/Component' });
    expect(result!.options).toEqual({});
  });

  // URL format variations
  it('should accept CJS URL format', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(require('url').pathToFileURL(__filename).toString(), { Default: Component }, { name: 'CJS Example' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.url).toBe("require('url').pathToFileURL(__filename).toString()");
  });

  // Edge cases and validation
  it('should return null when no createDemo calls are found', async () => {
    const code = `
        import Component from './Component';
        // No createDemo call
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).toBeNull();
  });

  it('should throw error when multiple createDemo calls are found', async () => {
    const code = `
        import Component1 from './Component1';
        import Component2 from './Component2';
        
        createDemo(import.meta.url, { Component1 }, { name: 'Demo 1' });
        createDemo(import.meta.url, { Component2 }, { name: 'Demo 2' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      'Multiple create* factory calls found in /src/demo.ts. Only one create* call per file is supported. Found 2 calls.',
    );
  });

  it('should throw error for invalid URL parameter', async () => {
    const code = `
        import Component from './Component';
        
        createDemo('./file.ts', { Default: Component }, { name: 'Invalid' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid URL parameter in createDemo call in /src/demo.ts. Expected 'import.meta.url' or 'require('url').pathToFileURL(__filename).toString()' but got: './file.ts'",
    );
  });

  it('should throw error for wrong number of parameters', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url);
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid createDemo call in /src/demo.ts. Expected 2-3 parameters (url, variants, options?) but got 1 parameters. Functions starting with 'create' must follow the convention: create*(url, variants, options?)",
    );
  });

  // Implementation details and property validation
  it('should correctly set hasOptions property', async () => {
    // Test with no options (2 parameters)
    const codeNoOptions = `
      import Component from './Component';
      createDemo(import.meta.url, { Component });
    `;
    const resultNoOptions = await parseCreateFactoryCall(codeNoOptions, '/src/demo.ts');
    expect(resultNoOptions!.hasOptions).toBe(false);
    expect(resultNoOptions!.optionsObjectStr).toBe('{}');

    // Test with empty options
    const codeEmptyOptions = `
      import Component from './Component';
      createDemo(import.meta.url, { Component }, {});
    `;
    const resultEmptyOptions = await parseCreateFactoryCall(codeEmptyOptions, '/src/demo.ts');
    expect(resultEmptyOptions!.hasOptions).toBe(true);
    expect(resultEmptyOptions!.optionsObjectStr).toBe('{}');

    // Test with actual options
    const codeWithOptions = `
      import Component from './Component';
      createDemo(import.meta.url, { Component }, { name: 'Test' });
    `;
    const resultWithOptions = await parseCreateFactoryCall(codeWithOptions, '/src/demo.ts');
    expect(resultWithOptions!.hasOptions).toBe(true);
    expect(resultWithOptions!.optionsObjectStr).toBe("{ name: 'Test' }");
  });
});
