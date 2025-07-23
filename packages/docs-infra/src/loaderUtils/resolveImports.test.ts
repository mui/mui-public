import { describe, it, expect } from 'vitest';
import { resolveImports } from './resolveImports';

describe('resolveImports', () => {
  it('should resolve relative import paths and group by import path', async () => {
    const code = `
      import Component1 from './Component1';
      import { Component2, Component3 } from './components';
      import * as Utils from '../utils';
    `;
    const filePath = '/src/demo.ts';
    const result = await resolveImports(code, filePath);

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
    const result = await resolveImports(code, filePath);

    expect(result).toEqual({
      './Component': { path: '/src/Component', names: ['Component'] },
    });
  });

  it('should handle empty code', async () => {
    const code = '';
    const filePath = '/src/demo.ts';
    const result = await resolveImports(code, filePath);

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
    const result = await resolveImports(code, filePath);

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
    const result = await resolveImports(code, filePath);

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
    const result = await resolveImports(code, filePath);

    expect(result).toEqual({
      '../../../shared/components/Component': {
        path: '/src/shared/components/Component',
        names: ['Component'],
      },
      '../../utils/helpers': { path: '/src/features/utils/helpers', names: ['Utils'] },
    });
  });
});
