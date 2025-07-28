import { describe, it, expect } from 'vitest';
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
      './Component1': { path: '/src/Component1', names: ['Component1'] },
      './components': { path: '/src/components', names: ['Component2', 'Component3'] },
      '../utils': { path: '/utils', names: ['Utils'] },
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
      './Component': { path: '/src/Component', names: ['Component'] },
    });
  });

  it('should handle empty code', async () => {
    const code = '';
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({});
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

    expect(result).toEqual({});
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
      './default': { path: '/src/default', names: ['DefaultImport'] },
      './named': { path: '/src/named', names: ['NamedImport1', 'NamedImport2'] },
      './namespace': { path: '/src/namespace', names: ['NamespaceImport'] },
      './aliased': { path: '/src/aliased', names: ['AliasedImport'] },
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
      '../../../shared/components/Component': {
        path: '/src/shared/components/Component',
        names: ['Component'],
      },
      '../../utils/helpers': { path: '/src/features/utils/helpers', names: ['Utils'] },
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
      './types': { path: '/src/types', names: ['TypeDef'], includeTypeDefs: true },
      './defaultTypes': {
        path: '/src/defaultTypes',
        names: ['DefaultType'],
        includeTypeDefs: true,
      },
      './component': { path: '/src/component', names: ['Component'] },
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
      './Component': {
        path: '/src/Component',
        names: ['Props', 'Component'],
        // No includeTypeDefs since mixed imports are treated as value imports
      },
    });
  });
});
