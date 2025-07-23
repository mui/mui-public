import { describe, it, expect } from 'vitest';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';

describe('parseCreateFactoryCall', () => {
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
            precompute: true
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
      precompute: true,
    });
  });

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

  it('should parse options with different quote types', async () => {
    const code = `
        createDemo(import.meta.url, {}, {
          name: "Double quotes",
          slug: 'single quotes',
          description: \`template literal\`,
          precompute: false
        });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.options).toEqual({
      name: 'Double quotes',
      slug: 'single quotes',
      precompute: false,
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

  it('should ignore variants without corresponding imports', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, UnknownComponent }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result!.variants).toEqual({
      Component1: '/src/Component1',
      // UnknownComponent should be ignored since it's not imported
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
            precompute: true,
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
      precompute: true,
    });
  });

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

  it('should throw error for invalid variants parameter', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, "not an object", { name: 'Invalid' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      'Invalid variants parameter in createDemo call in /src/demo.ts. Expected an object but could not parse: "not an object"',
    );
  });
});
