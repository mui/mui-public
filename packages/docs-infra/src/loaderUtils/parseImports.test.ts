import { describe, expect, it } from 'vitest';
import { parseImports } from './parseImports';

describe('parseImports', () => {
  it('should resolve relative import paths and group by import path', async () => {
    const code = `
      import Component1 from './Component1';
      import { Component2, Component3 } from './components';
      import * as Utils from '../utils';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component1': {
          path: '/src/Component1',
          names: [{ name: 'Component1', type: 'default' }],
        },
        './components': {
          path: '/src/components',
          names: [
            { name: 'Component2', type: 'named' },
            { name: 'Component3', type: 'named' },
          ],
        },
        '../utils': {
          path: '/utils',
          names: [{ name: 'Utils', type: 'namespace' }],
        },
      },
      externals: {},
    });
  });

  it('should ignore non-relative imports', async () => {
    const code = `
      import React from 'react';
      import { Button } from '@mui/material';
      import Component from './Component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component': { path: '/src/Component', names: [{ name: 'Component', type: 'default' }] },
      },
      externals: {
        react: { names: [{ name: 'React', type: 'default' }] },
        '@mui/material': { names: [{ name: 'Button', type: 'named' }] },
      },
    });
  });

  it('should handle empty code', async () => {
    const code = '';
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {},
      externals: {},
    });
  });

  it('should handle code with no imports', async () => {
    const code = `
      const x = 1;
      function test() {
        return 'hello';
      }
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {},
      externals: {},
    });
  });

  it('should handle mixed import types', async () => {
    const code = `
      import DefaultImport from './default';
      import { NamedImport1, NamedImport2 } from './named';
      import * as NamespaceImport from './namespace';
      import { NamedImport3 as AliasedImport } from './aliased';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './default': {
          path: '/src/default',
          names: [{ name: 'DefaultImport', type: 'default' }],
        },
        './named': {
          path: '/src/named',
          names: [
            { name: 'NamedImport1', type: 'named' },
            { name: 'NamedImport2', type: 'named' },
          ],
        },
        './namespace': {
          path: '/src/namespace',
          names: [{ name: 'NamespaceImport', type: 'namespace' }],
        },
        './aliased': {
          path: '/src/aliased',
          names: [{ name: 'NamedImport3', alias: 'AliasedImport', type: 'named' }],
        },
      },
      externals: {},
    });
  });

  it('should handle deeply nested paths', async () => {
    const code = `
      import Component from '../../../shared/components/Component';
      import Utils from '../../utils/helpers';
    `;
    const filePath = '/src/features/demo/components/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        '../../../shared/components/Component': {
          path: '/src/shared/components/Component',
          names: [{ name: 'Component', type: 'default' }],
        },
        '../../utils/helpers': {
          path: '/src/features/utils/helpers',
          names: [{ name: 'Utils', type: 'default' }],
        },
      },
      externals: {},
    });
  });

  it('should handle type-only imports', async () => {
    const code = `
      import type { TypeDef } from './types';
      import type DefaultType from './defaultTypes';
      import { Component } from './component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    // Type imports should have includeTypeDefs: true
    expect(result).toEqual({
      relative: {
        './types': {
          path: '/src/types',
          names: [{ name: 'TypeDef', type: 'named', isType: true }],
          includeTypeDefs: true,
        },
        './defaultTypes': {
          path: '/src/defaultTypes',
          names: [{ name: 'DefaultType', type: 'default', isType: true }],
          includeTypeDefs: true,
        },
        './component': {
          path: '/src/component',
          names: [{ name: 'Component', type: 'named' }],
        },
      },
      externals: {},
    });
  });

  it('should handle mixed type and value imports from same module', async () => {
    const code = `
      import type { Props } from './Component';
      import { Component } from './Component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    // Should create separate entries for type and value imports
    expect(result).toEqual({
      relative: {
        './Component': {
          path: '/src/Component',
          names: [
            { name: 'Props', type: 'named', isType: true },
            { name: 'Component', type: 'named' },
          ],
          includeTypeDefs: true,
        },
      },
      externals: {},
    });
  });

  it('should handle side-effect imports', async () => {
    const code = `
      import './styles.css';
      import '../utils/polyfills';
      import 'some-external-module/setup';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './styles.css': {
          path: '/src/styles.css',
          names: [],
        },
        '../utils/polyfills': {
          path: '/utils/polyfills',
          names: [],
        },
      },
      externals: {
        'some-external-module/setup': {
          names: [],
        },
      },
    });
  });

  // Test cases that would help catch edge cases that cause issues downstream
  describe('Edge case regression tests', () => {
    it('should handle imports with empty or problematic names that could cause downstream issues', async () => {
      // Test a scenario that might produce empty names or cause parsing issues
      const code = `
        import React from 'react';
        import { } from './empty-exports';
        import { /* comment */ } from './comment-only';
        import './side-effect';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './empty-exports': {
            path: '/src/empty-exports',
            names: [],
          },
          './comment-only': {
            path: '/src/comment-only',
            names: [],
          },
          './side-effect': {
            path: '/src/side-effect',
            names: [],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
        },
      });
    });

    it('should handle complex mixed type and value imports that could cause consolidation issues', async () => {
      const code = `
        import type { ComponentType, ReactNode } from 'react';
        import React, { useState, useEffect } from 'react';
        import type { ButtonProps } from '@mui/material';
        import { Button, TextField } from '@mui/material';
        import type * as Types from './types';
        import * as Utils from './utils';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImports(code, filePath);

      // This should produce mixed isType flags that the generateExternalsProvider needs to handle
      expect(result.externals.react.names).toEqual([
        { name: 'ComponentType', type: 'named', isType: true },
        { name: 'ReactNode', type: 'named', isType: true },
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ]);

      expect(result.externals['@mui/material'].names).toEqual([
        { name: 'ButtonProps', type: 'named', isType: true },
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
      ]);

      expect(result.relative['./types']).toEqual({
        path: '/src/types',
        names: [{ name: 'Types', type: 'namespace', isType: true }],
        includeTypeDefs: true,
      });

      expect(result.relative['./utils']).toEqual({
        path: '/src/utils',
        names: [{ name: 'Utils', type: 'namespace' }],
      });
    });

    it('should handle duplicate imports that could cause consolidation problems', async () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import React from 'react';
        import { useState, useEffect } from 'react';
        import { Button } from '@mui/material';
        import { Button, TextField } from '@mui/material';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImports(code, filePath);

      // parseImports should handle the duplicates and produce a consolidated structure
      // The exact behavior depends on implementation, but it should not crash
      expect(result.externals.react).toBeDefined();
      expect(result.externals['@mui/material']).toBeDefined();

      // Should contain all the unique imports
      const reactNames = result.externals.react.names.map((n) => n.name);
      expect(reactNames).toContain('React');
      expect(reactNames).toContain('useState');
      expect(reactNames).toContain('useEffect');

      const muiNames = result.externals['@mui/material'].names.map((n) => n.name);
      expect(muiNames).toContain('Button');
      expect(muiNames).toContain('TextField');
    });

    it('should handle malformed or unusual import statements gracefully', async () => {
      const code = `
        import React from 'react';
        import { 
          useState,
          useEffect
        } from 'react';
        import {
          Button,
          // This is a comment
          TextField
        } from '@mui/material';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImports(code, filePath);

      // Should parse multi-line imports correctly
      expect(result.externals.react.names).toEqual([
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ]);

      expect(result.externals['@mui/material'].names).toEqual([
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
      ]);
    });

    it('should handle files that might produce the exact scenario that caused our bugs', async () => {
      // This simulates a real file that could produce empty names, type-only imports, and duplicates
      const code = `
        import type { FC, ReactNode, ComponentType } from 'react';
        import React, { useState, useEffect } from 'react';
        import type { ButtonProps, TextFieldProps } from '@mui/material';
        import { Button, TextField } from '@mui/material';
        import type { } from './empty-types';
        import { } from './empty-runtime';
        import './side-effect.css';
      `;
      const filePath = '/src/ServerLoadedDemo.tsx';
      const result = await parseImports(code, filePath);

      // Should produce the exact kind of mixed data that caused issues:
      // - Type-only imports with isType: true
      // - Empty names arrays
      // - Mixed type and runtime imports from same modules
      expect(result.externals.react.names).toContainEqual({
        name: 'FC',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({
        name: 'ReactNode',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({
        name: 'ComponentType',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({ name: 'React', type: 'default' });
      expect(result.externals.react.names).toContainEqual({ name: 'useState', type: 'named' });
      expect(result.externals.react.names).toContainEqual({ name: 'useEffect', type: 'named' });

      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'ButtonProps',
        type: 'named',
        isType: true,
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'TextFieldProps',
        type: 'named',
        isType: true,
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'Button',
        type: 'named',
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'TextField',
        type: 'named',
      });

      // Should handle empty imports
      expect(result.relative['./empty-types']).toEqual({
        path: '/src/empty-types',
        names: [],
        includeTypeDefs: true,
      });

      expect(result.relative['./empty-runtime']).toEqual({
        path: '/src/empty-runtime',
        names: [],
      });

      expect(result.relative['./side-effect.css']).toEqual({
        path: '/src/side-effect.css',
        names: [],
      });
    });

    it('should handle namespace import and path alias imports', async () => {
      // Test the exact case the user provided
      const code = `
import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export default function CheckboxBasic() {
  return (
    <div>
      <Checkbox defaultChecked />
      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>
    </div>
  );
}
      `;
      const filePath = '/src/demos/CheckboxBasic.tsx';
      const result = await parseImports(code, filePath);

      expect(result.externals.react.names).toEqual([{ name: 'React', type: 'namespace' }]);

      // Path alias @/components/Checkbox should be treated as external since it's not relative
      expect(result.externals['@/components/Checkbox'].names).toEqual([
        { name: 'Checkbox', type: 'named' },
      ]);

      expect(result.relative).toEqual({});
    });
  });
});
