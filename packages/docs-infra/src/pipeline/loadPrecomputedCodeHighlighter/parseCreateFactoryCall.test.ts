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
      'Invalid variants parameter in createDemo call in /src/demo.ts. Expected a valid component identifier, but got: ""not an object""',
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
      description: 'template literal',
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
      customOption: 'custom value',
      anotherCustom: 42,
      booleanCustom: false,
      objectCustom: { nested: 'value' },
    });

    // The structured options should contain all the original options with their original formatting
    const structuredOptionsStr = JSON.stringify(result!.structuredOptions);
    expect(structuredOptionsStr).toContain('customOption');
    expect(structuredOptionsStr).toContain('anotherCustom');
    expect(structuredOptionsStr).toContain('booleanCustom');
    expect(structuredOptionsStr).toContain('objectCustom');
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
      customString: 'double quotes',
      customTemplate: 'template literal',
      customNumber: 123.45,
      customArray: [1, 2, 3],
      customFunction: "() => console.log('test')",
      customRegex: '/pattern/gi',
    });

    // But the structured options should preserve everything
    const structuredOptionsStr = JSON.stringify(result!.structuredOptions);
    expect(structuredOptionsStr).toContain('customString');
    expect(structuredOptionsStr).toContain('customTemplate');
    expect(structuredOptionsStr).toContain('customNumber');
    expect(structuredOptionsStr).toContain('customArray');
    expect(structuredOptionsStr).toContain('customFunction');
    expect(structuredOptionsStr).toContain('customRegex');
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

    // All options should be parsed including custom ones
    expect(result!.options).toEqual({
      name: 'Test Demo',
      skipPrecompute: false,
      precompute: { some: 'data' },
      customBefore: 'before precompute',
      customAfter: 'after precompute',
      metadata: { version: '1.0', tags: ['demo', 'test'] },
    });

    // Custom options should be preserved in the structured options
    const structuredOptionsStr = JSON.stringify(result!.structuredOptions);
    expect(structuredOptionsStr).toContain('customBefore');
    expect(structuredOptionsStr).toContain('customAfter');
    expect(structuredOptionsStr).toContain('metadata');
    expect(structuredOptionsStr).toContain('version');
    expect(structuredOptionsStr).toContain('tags');

    // Precompute parsing should work correctly
    expect(result!.options.precompute).toBeDefined();
    expect(result!.options.precompute).toEqual({ some: 'data' });
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

  it('should work with createDemo function', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, { Example: Component });
      `;
    const filePath = '/src/demo.ts';
    const result = await parseCreateFactoryCall(code, filePath);

    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('createDemo');
    expect(result!.variants).toEqual({ Example: '/src/Component' });
    expect(result!.options).toEqual({});
  });

  // URL format variations
  it('should only accept import.meta.url', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(require('url').pathToFileURL(__filename).toString(), { Default: Component }, { name: 'CJS Example' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid URL parameter in createDemo call in /src/demo.ts. Expected 'import.meta.url' but got: require('url').pathToFileURL(__filename).toString()",
    );
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
      "Invalid URL parameter in createDemo call in /src/demo.ts. Expected 'import.meta.url' but got: './file.ts'",
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
    expect(resultNoOptions!.structuredOptions).toBeUndefined();

    // Test with empty options
    const codeEmptyOptions = `
      import Component from './Component';
      createDemo(import.meta.url, { Component }, {});
    `;
    const resultEmptyOptions = await parseCreateFactoryCall(codeEmptyOptions, '/src/demo.ts');
    expect(resultEmptyOptions!.hasOptions).toBe(true);
    expect(resultEmptyOptions!.structuredOptions).toEqual({});

    // Test with actual options
    const codeWithOptions = `
      import Component from './Component';
      createDemo(import.meta.url, { Component }, { name: 'Test' });
    `;
    const resultWithOptions = await parseCreateFactoryCall(codeWithOptions, '/src/demo.ts');
    expect(resultWithOptions!.hasOptions).toBe(true);
    expect(resultWithOptions!.structuredOptions).toEqual({ name: "'Test'" }); // Structured format preserves quotes
  });

  // Externals tests
  describe('externals functionality', () => {
    it('should extract externals from imports', async () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import * as ReactDOM from 'react-dom';
        import 'side-effect-only';
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        'side-effect-only': [],
      });
    });

    it('should handle externals with aliases', async () => {
      const code = `
        import React from 'react';
        import { Component as ReactComponent, createElement as h } from 'react';
        import 'side-effect-import';
        import LocalComponent from './Component';
        
        createDemo(import.meta.url, { LocalComponent }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        'side-effect-import': [],
      });
    });

    it('should handle type-only imports in externals', async () => {
      const code = `
        import type { FC } from 'react';
        import React, { type ComponentProps } from 'react';
        import 'type-side-effect';
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        'type-side-effect': [],
      });
    });

    it('should handle side-effect imports in externals', async () => {
      const code = `
        import 'react-hot-loader';
        import './styles.css';
        import React from 'react';
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only external side-effect imports should be included (not relative ones like './styles.css')
      expect(result!.externals).toEqual({
        'react-hot-loader': [],
      });
    });

    it('should handle mixed external import types', async () => {
      const code = `
        import React, { useState, useEffect } from 'react';
        import * as ReactDOM from 'react-dom';
        import { createRoot } from 'react-dom/client';
        import 'global-styles';
        import 'another-side-effect';
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        'global-styles': [],
        'another-side-effect': [],
      });
    });

    it('should return empty externals when no external imports exist', async () => {
      const code = `
        import Component from './Component';
        import { Helper } from '../utils/helper';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.externals).toEqual({});
    });

    it('should handle scoped packages in externals', async () => {
      const code = `
        import { Button } from '@mui/material';
        import styled from '@emotion/styled';
        import '@scoped/side-effect-package';
        import Component from './Component';
        
        createDemo(import.meta.url, { Component }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        '@scoped/side-effect-package': [],
      });
    });

    it('should handle externals with complex namespace and named imports', async () => {
      const code = `
        import * as React from 'react';
        import { Component as ReactComponent } from 'react';
        import * as MaterialUI from '@mui/material';
        import { Button, TextField as Input } from '@mui/material';
        import 'complex-side-effect';
        import LocalComponent from './Component';
        
        createDemo(import.meta.url, { LocalComponent }, { name: 'Test' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      // Only side-effect imports should be included
      expect(result!.externals).toEqual({
        'complex-side-effect': [],
      });
    });
  });

  describe('namedExports functionality', () => {
    it('should extract named exports from aliased imports', async () => {
      const code = `
        import { Checkbox as Demo } from './checkbox';
        import { Button } from './button';
        
        createDemo(import.meta.url, { Variant: Demo, ButtonVariant: Button });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.namedExports).toEqual({
        Variant: 'Checkbox',
        ButtonVariant: 'Button',
      });
      expect(result!.variants).toEqual({
        Variant: '/src/checkbox',
        ButtonVariant: '/src/button',
      });
    });

    it('should handle default import with named exports as undefined', async () => {
      const code = `
        import DefaultComponent from './default';
        import { NamedComponent } from './named';
        
        createDemo(import.meta.url, { Default: DefaultComponent, Named: NamedComponent });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.namedExports).toEqual({
        Default: undefined, // Default import has no named export
        Named: 'NamedComponent',
      });
    });

    it('should handle single component shorthand syntax', async () => {
      const code = `
        import { Component as Demo } from './component';
        
        createDemo(import.meta.url, Demo);
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.namedExports).toEqual({
        Default: 'Component',
      });
      expect(result!.variants).toEqual({
        Default: '/src/component',
      });
    });

    it('should handle mixed import types', async () => {
      const code = `
        import DefaultComp from './default';
        import { NamedComp as Aliased } from './named';
        import { DirectNamed } from './direct';
        
        createDemo(import.meta.url, { 
          Default: DefaultComp, 
          Aliased: Aliased,
          Direct: DirectNamed 
        });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.namedExports).toEqual({
        Default: undefined, // Default import
        Aliased: 'NamedComp', // Named import with alias
        Direct: 'DirectNamed', // Direct named import
      });
    });
  });

  // TypeScript generic types in createDemo calls
  describe('TypeScript generic types support', () => {
    it('should handle TypeScript generic types in createDemo variants', async () => {
      const code = `
          import { BasicDemo } from './BasicDemo';
          import { WithProps } from './WithProps';
          
          export const demo = createDemo(
            import.meta.url,
            { Default: BasicDemo as React.ComponentType<{ prop: boolean }>, WithProps },
            { name: "My Demo" }
          );
        `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Default: '/src/BasicDemo',
        WithProps: '/src/WithProps',
      });
      expect(result!.options).toEqual({
        name: 'My Demo',
      });
      expect(result!.namedExports).toEqual({
        Default: 'BasicDemo',
        WithProps: 'WithProps',
      });
    });

    it('should handle complex TypeScript generic types with nested generics', async () => {
      const code = `
          import { ComplexComponent } from './ComplexComponent';
          import { SimpleComponent } from './SimpleComponent';
          
          export const demo = createDemo(
            import.meta.url,
            { 
              Complex: ComplexComponent as React.ComponentType<{ data: Array<{ id: string; value: Record<string, any> }>; onSelect: (item: { id: string }) => void; }>,
              Simple: SimpleComponent
            },
            { name: "Complex Types Demo" }
          );
        `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Complex: '/src/ComplexComponent',
        Simple: '/src/SimpleComponent',
      });
      expect(result!.options).toEqual({
        name: 'Complex Types Demo',
      });
      expect(result!.namedExports).toEqual({
        Complex: 'ComplexComponent',
        Simple: 'SimpleComponent',
      });
    });
  });

  describe('metadataOnly option', () => {
    it('should handle createDemoClient with only URL parameter', async () => {
      const code = `
        import { createDemoClient } from './createDemoClient';
        
        export const DemoClient = createDemoClient(import.meta.url);
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { metadataOnly: true });

      expect(result).not.toBeNull();
      expect(result!.functionName).toBe('createDemoClient');
      expect(result!.url).toBe('import.meta.url');
      expect(result!.variants).toBeUndefined();
      expect(result!.namedExports).toBeUndefined();
      expect(result!.options).toEqual({});
      expect(result!.hasOptions).toBe(false);
      expect(result!.structuredVariants).toBeUndefined();
    });

    it('should handle createDemoClient with URL and options', async () => {
      const code = `
        import { createDemoClient } from './createDemoClient';
        
        export const DemoClient = createDemoClient(import.meta.url, {
          name: 'Test Client'
        });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { metadataOnly: true });

      expect(result).not.toBeNull();
      expect(result!.functionName).toBe('createDemoClient');
      expect(result!.url).toBe('import.meta.url');
      expect(result!.variants).toBeUndefined();
      expect(result!.namedExports).toBeUndefined();
      expect(result!.options).toEqual({
        name: 'Test Client',
      });
      expect(result!.hasOptions).toBe(true);
      expect(result!.structuredVariants).toBeUndefined();
    });

    it('should reject calls with too many parameters in metadataOnly mode', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createDemo(import.meta.url, Component, { name: 'test' });
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath, { metadataOnly: true })).rejects.toThrow(
        'Expected 1-2 parameters (url, options?) but got 3 parameters',
      );
    });

    it('should reject calls with no parameters in metadataOnly mode', async () => {
      const code = `
        export const demo = createDemo();
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath, { metadataOnly: true })).rejects.toThrow(
        'Expected 1-2 parameters (url, options?) but got 0 parameters',
      );
    });
  });
});
