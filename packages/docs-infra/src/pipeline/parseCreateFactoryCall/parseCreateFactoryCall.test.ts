import { describe, it, expect } from 'vitest';
import { parseCreateFactoryCall, parseAllCreateFactoryCalls } from './parseCreateFactoryCall';

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
      Default: 'file:///src/Component',
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
      Default: 'file:///src/Component',
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
    expect(compactResult!.variants).toEqual({ Default: 'file:///src/Component' });

    // Spaced style
    const spacedCode = `
      import Component from './Component';
      createDemo( import.meta.url , Component );
    `;
    const spacedResult = await parseCreateFactoryCall(spacedCode, '/src/demo.ts');
    expect(spacedResult!.variants).toEqual({ Default: 'file:///src/Component' });

    // Multiline style
    const multilineCode = `
      import Component from './Component';
      createDemo(
        import.meta.url,
        Component
      );
    `;
    const multilineResult = await parseCreateFactoryCall(multilineCode, '/src/demo.ts');
    expect(multilineResult!.variants).toEqual({ Default: 'file:///src/Component' });
  });

  it('should handle single component with options and different spacing', async () => {
    // Compact with options
    const compactCode = `
      import Component from './Component';
      createDemo(import.meta.url,Component,{name:'Test'});
    `;
    const compactResult = await parseCreateFactoryCall(compactCode, '/src/demo.ts');
    expect(compactResult!.variants).toEqual({ Default: 'file:///src/Component' });
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
    expect(multilineResult!.variants).toEqual({ Default: 'file:///src/Component' });
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
      Component: 'file:///src/Component',
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
      Component: 'file:///src/Component',
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
      Component1: 'file:///src/Component1',
      Component2: 'file:///src/components',
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
      "Invalid variants argument in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for variants without corresponding imports', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, UnknownComponent }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants argument in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for explicit variant mapping with unknown component', async () => {
    const code = `
        import Component1 from './Component1';
        
        createDemo(import.meta.url, { Component1, Custom: UnknownComponent }, { name: 'Test' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid variants argument in createDemo call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
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
      "Invalid variants argument in createDemo call in /src/demo.ts. Component 'Unknown1' is not imported. Make sure to import it first.",
    );
  });

  it('should throw error for invalid variants argument', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url, "not an object", { name: 'Invalid' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      'Invalid variants argument in createDemo call in /src/demo.ts. Expected a valid component identifier, but got: ""not an object""',
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
      Comp1: 'file:///src/components',
      Comp2: 'file:///src/components',
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
      CssModules: 'file:///src/demos/styling/CssModules',
      Tailwind: 'file:///src/demos/styling/Tailwind',
      Basic: 'file:///src/demos/shared/BasicExample',
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
    expect(result!.variants).toEqual({ Default: 'file:///src/Component' });
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
    expect(result!.variants).toEqual({ Example: 'file:///src/Component' });
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
      "Invalid URL argument in createDemo call in /src/demo.ts. Expected 'import.meta.url' but got: require('url').pathToFileURL(__filename).toString()",
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

  it('should throw error for invalid URL argument', async () => {
    const code = `
        import Component from './Component';
        
        createDemo('./file.ts', { Default: Component }, { name: 'Invalid' });
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid URL argument in createDemo call in /src/demo.ts. Expected 'import.meta.url' but got: './file.ts'",
    );
  });

  it('should throw error for wrong number of arguments', async () => {
    const code = `
        import Component from './Component';
        
        createDemo(import.meta.url);
      `;
    const filePath = '/src/demo.ts';

    await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
      "Invalid createDemo call in /src/demo.ts. Expected 2-3 arguments (url, variants, options?) but got 1 arguments. Functions starting with 'create' must follow the convention: create*(url, variants, options?)",
    );
  });

  // Implementation details and property validation
  it('should correctly set hasOptions property', async () => {
    // Test with no options (2 arguments)
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
        Variant: 'file:///src/checkbox',
        ButtonVariant: 'file:///src/button',
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
        Default: 'file:///src/component',
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
        Default: 'file:///src/BasicDemo',
        WithProps: 'file:///src/WithProps',
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
        Complex: 'file:///src/ComplexComponent',
        Simple: 'file:///src/SimpleComponent',
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
    it('should handle createDemoClient with only URL argument', async () => {
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
      expect(result!.hasGenerics).toBe(false);
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
      expect(result!.hasGenerics).toBe(false);
      expect(result!.structuredVariants).toBeUndefined();
    });

    it('should reject calls with too many arguments in metadataOnly mode', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createDemo(import.meta.url, Component, { name: 'test' });
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath, { metadataOnly: true })).rejects.toThrow(
        'Expected 1-2 arguments (url, options?) but got 3 arguments',
      );
    });

    it('should reject calls with no arguments in metadataOnly mode', async () => {
      const code = `
        export const demo = createDemo();
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath, { metadataOnly: true })).rejects.toThrow(
        'Expected 1-2 arguments (url, options?) but got 0 arguments',
      );
    });
  });

  describe('allowExternalVariants option', () => {
    it('should allow external imports when allowExternalVariants is true', async () => {
      const code = `
        import { Button } from '@mui/material';
        import { TextField } from '@mui/material';
        
        createDemo(import.meta.url, { Button, TextField }, { name: 'External Demo' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Button: '@mui/material',
        TextField: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        Button: 'Button',
        TextField: 'TextField',
      });
      expect(result!.options).toEqual({
        name: 'External Demo',
      });
    });

    it('should reject external imports when allowExternalVariants is false (default)', async () => {
      const code = `
        import { Button } from '@mui/material';
        
        createDemo(import.meta.url, { Button }, { name: 'External Demo' });
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
        "Invalid variants argument in createDemo call in /src/demo.ts. Component 'Button' is not imported. Make sure to import it first.",
      );
    });

    it('should handle single external component with allowExternalVariants', async () => {
      const code = `
        import { Button } from '@mui/material';
        
        createDemo(import.meta.url, Button);
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Default: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        Default: 'Button',
      });
    });

    it('should handle mixed local and external imports with allowExternalVariants', async () => {
      const code = `
        import LocalComponent from './LocalComponent';
        import { Button } from '@mui/material';
        import { useEffect } from 'react';
        
        createDemo(import.meta.url, { Local: LocalComponent, External: Button }, { name: 'Mixed Demo' });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Local: 'file:///src/LocalComponent',
        External: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        Local: undefined, // Default import
        External: 'Button', // Named import
      });
    });

    it('should handle external imports with aliases', async () => {
      const code = `
        import { Button as MuiButton } from '@mui/material';
        import { TextField as MuiTextField } from '@mui/material';
        
        createDemo(import.meta.url, { MuiButton, CustomTextField: MuiTextField });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        MuiButton: '@mui/material',
        CustomTextField: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        MuiButton: 'Button',
        CustomTextField: 'TextField',
      });
    });

    it('should handle default external imports', async () => {
      const code = `
        import React from 'react';
        import Button from '@mui/material/Button';
        
        createDemo(import.meta.url, { React, Button });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        React: 'react',
        Button: '@mui/material/Button',
      });
      expect(result!.namedExports).toEqual({
        React: undefined, // Default import
        Button: undefined, // Default import
      });
    });

    it('should handle namespace external imports', async () => {
      const code = `
        import * as React from 'react';
        import * as MUI from '@mui/material';
        
        createDemo(import.meta.url, { React, MUI });
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        React: 'react',
        MUI: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        React: undefined, // Namespace import
        MUI: undefined, // Namespace import
      });
    });

    it('should work with parseAllCreateFactoryCalls with local imports only', async () => {
      const code = `
        import LocalComponent1 from './LocalComponent1';
        import LocalComponent2 from './LocalComponent2';
        
        export const demo1 = createDemo(import.meta.url, { LocalComponent1 });
        
        export const demo2 = createDemo(import.meta.url, { LocalComponent2 });
      `;
      const filePath = '/src/demo.ts';

      const results = await parseAllCreateFactoryCalls(code, filePath, {
        allowExternalVariants: true,
      });

      expect(Object.keys(results)).toHaveLength(2);
      expect(results.demo1.variants).toEqual({
        LocalComponent1: 'file:///src/LocalComponent1',
      });
      expect(results.demo2.variants).toEqual({
        LocalComponent2: 'file:///src/LocalComponent2',
      });
    });

    it('should handle TypeScript generic types with external imports', async () => {
      const code = `
        import { Button } from '@mui/material';
        import { TextField } from '@mui/material';
        
        createDemo(
          import.meta.url,
          { 
            Button: Button as React.ComponentType<{ variant?: 'contained' | 'outlined' }>,
            TextField: TextField as React.ComponentType<{ label?: string }>
          },
          { name: 'External TypeScript Demo' }
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { allowExternalVariants: true });

      expect(result).not.toBeNull();
      expect(result!.variants).toEqual({
        Button: '@mui/material',
        TextField: '@mui/material',
      });
      expect(result!.namedExports).toEqual({
        Button: 'Button',
        TextField: 'TextField',
      });
    });
  });

  describe('TypeScript generics support', () => {
    it('should handle simple generic object syntax', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import { ComponentB } from './ComponentB';
        
        export const demo = createSnippet<{ VariantA: ComponentA, VariantB: ComponentB }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        VariantA: 'ComponentA',
        VariantB: 'ComponentB',
      });
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
      expect(result!.namedExports).toEqual({
        VariantA: undefined, // default import
        VariantB: 'ComponentB', // named import
      });
    });

    it('should handle generic with single variant', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<{ Default: Component }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
    });

    it('should handle single component generic syntax', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<Component>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.namedExports).toEqual({
        Default: undefined, // default import
      });
    });

    it('should handle single named component generic syntax', async () => {
      const code = `
        import { Component } from './Component';
        
        export const demo = createSnippet<Component>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.namedExports).toEqual({
        Default: 'Component', // named import
      });
    });

    it('should handle single component with simple type annotations', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<Component>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
    });

    it('should handle generics with TypeScript type annotations', async () => {
      const code = `
        import { ComponentA } from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippet<{
          WithProps: ComponentA as React.ComponentType<{ title: string }>,
          SimpleComp: ComponentB
        }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.variants).toEqual({
        WithProps: 'file:///src/ComponentA',
        SimpleComp: 'file:///src/ComponentB',
      });
    });

    it('should handle generics with options argument', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippet<{ VariantA: ComponentA, VariantB: ComponentB }>(
          import.meta.url,
          { name: 'Snippet Demo', skipPrecompute: true }
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
      expect(result!.options).toEqual({
        name: 'Snippet Demo',
        skipPrecompute: true,
      });
    });

    it('should handle single component generic with options', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<Component>(
          import.meta.url,
          { name: 'Single Component Demo', skipPrecompute: true }
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.options).toEqual({
        name: 'Single Component Demo',
        skipPrecompute: true,
      });
    });

    it('should handle single component typeof syntax', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<typeof Component>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'typeof Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.namedExports).toEqual({
        Default: undefined, // default import
      });
    });

    it('should handle single named component typeof syntax', async () => {
      const code = `
        import { Component } from './Component';
        
        export const demo = createSnippet<typeof Component>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'typeof Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.namedExports).toEqual({
        Default: 'Component', // named import
      });
    });

    it('should handle typeof syntax in object generics', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import { ComponentB } from './ComponentB';
        
        export const demo = createSnippet<{ VariantA: typeof ComponentA, VariantB: typeof ComponentB }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        VariantA: 'typeof ComponentA',
        VariantB: 'typeof ComponentB',
      });
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
      expect(result!.namedExports).toEqual({
        VariantA: undefined, // default import
        VariantB: 'ComponentB', // named import
      });
    });

    it('should handle mixed typeof and direct component references', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippet<{ VariantA: typeof ComponentA, VariantB: ComponentB }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        VariantA: 'typeof ComponentA',
        VariantB: 'ComponentB',
      });
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
    });

    it('should handle typeof syntax with options', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<typeof Component>(
          import.meta.url,
          { name: 'Typeof Component Demo' }
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        Default: 'typeof Component',
      });
      expect(result!.variants).toEqual({
        Default: 'file:///src/Component',
      });
      expect(result!.options).toEqual({
        name: 'Typeof Component Demo',
      });
    });

    it('should handle generics with 2 arguments (generics as variants + second arg as options)', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippet<{ VariantA: ComponentA, VariantB: ComponentB }>(
          import.meta.url,
          { VariantA: ComponentA }
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      // With generics + 2 args, second arg is treated as options, so use generics as variants
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
      // Second argument should be parsed as options
      expect(result!.hasOptions).toBe(true);
      expect(result!.options).toEqual({
        VariantA: 'ComponentA', // This is now treated as an option, not a variant override
      });
      // Generics should still be preserved
      expect(result!.structuredGenerics).toEqual({
        VariantA: 'ComponentA',
        VariantB: 'ComponentB',
      });
    });

    it('should handle generics without variants (metadata-only mode)', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippetClient<{ VariantA: ComponentA, VariantB: ComponentB }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath, { metadataOnly: true });

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({
        VariantA: 'ComponentA',
        VariantB: 'ComponentB',
      });
      expect(result!.variants).toBeUndefined(); // No variants in metadata-only mode
    });

    it('should validate generics components are imported', async () => {
      const code = `
        import ComponentA from './ComponentA';
        
        export const demo = createSnippet<{ VariantA: ComponentA, UnknownVariant: UnknownComponent }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';

      await expect(parseCreateFactoryCall(code, filePath)).rejects.toThrow(
        "Invalid variants argument in createSnippet call in /src/demo.ts. Component 'UnknownComponent' is not imported. Make sure to import it first.",
      );
    });

    it('should handle empty generics', async () => {
      const code = `
        import Component from './Component';
        
        export const demo = createSnippet<{}>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.structuredGenerics).toEqual({});
      expect(result!.variants).toBeUndefined();
    });

    it('should handle generics with whitespace and comments', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createSnippet<{
          // Primary variant
          VariantA: ComponentA /* with comment */,
          VariantB: ComponentB // secondary variant
        }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.hasGenerics).toBe(true);
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
    });

    it('should handle multiple create* functions with generics', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        import ComponentC from './ComponentC';
        
        export const demo1 = createSnippet<{ VariantA: ComponentA }>(
          import.meta.url
        );
        
        export const demo2 = createSnippet<{ VariantB: ComponentB, VariantC: ComponentC }>(
          import.meta.url,
          { name: 'Second Demo' }
        );
      `;
      const filePath = '/src/demo.ts';
      const results = await parseAllCreateFactoryCalls(code, filePath);

      expect(Object.keys(results)).toHaveLength(2);
      expect(results.demo1.hasGenerics).toBe(true);
      expect(results.demo1.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
      });
      expect(results.demo2.hasGenerics).toBe(true);
      expect(results.demo2.variants).toEqual({
        VariantB: 'file:///src/ComponentB',
        VariantC: 'file:///src/ComponentC',
      });
      expect(results.demo2.options).toEqual({
        name: 'Second Demo',
      });
    });

    it('should work with different create* function names', async () => {
      const code = `
        import ComponentA from './ComponentA';
        import ComponentB from './ComponentB';
        
        export const demo = createDemo<{ VariantA: ComponentA, VariantB: ComponentB }>(
          import.meta.url
        );
      `;
      const filePath = '/src/demo.ts';
      const result = await parseCreateFactoryCall(code, filePath);

      expect(result).not.toBeNull();
      expect(result!.functionName).toBe('createDemo');
      expect(result!.hasGenerics).toBe(true);
      expect(result!.variants).toEqual({
        VariantA: 'file:///src/ComponentA',
        VariantB: 'file:///src/ComponentB',
      });
    });
  });
});
