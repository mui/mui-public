import { describe, it, expect } from 'vitest';
import { resolveImports } from './resolveImports';
import { rewriteImportsToSameDirectory } from './rewriteImports';

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
      './aliased': { path: '/src/aliased', names: ['NamedImport3'] },
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

  describe('rewriteImportsToSameDirectory', () => {
    it('should rewrite relative imports to same directory', () => {
      const source = `
        import Component1 from './Component1';
        import Component2 from '../utils/Component2';
        import { Helper } from '../../shared/helpers';
      `;
      const filePaths = new Set([
        '/src/Component1.ts',
        '/src/utils/Component2.ts',
        '/src/shared/helpers.ts',
      ]);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("import Component1 from './Component1'");
      expect(result).toContain("import Component2 from './Component2'");
      expect(result).toContain("import { Helper } from './helpers'");
    });

    it('should handle different file extensions', () => {
      const source = `
        import Component from './Component.tsx';
        import Helper from '../utils/helper.js';
        import Config from '../../config/config.json';
      `;
      const filePaths = new Set([
        '/src/Component.tsx',
        '/src/utils/helper.js',
        '/src/config/config.json',
      ]);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("import Component from './Component'");
      expect(result).toContain("import Helper from './helper'");
      // .json files are not stripped of their extension
      expect(result).toContain("import Config from './config.json'");
    });

    it('should preserve non-relative imports', () => {
      const source = `
        import React from 'react';
        import { Button } from '@mui/material';
        import Component from './Component';
      `;
      const filePaths = new Set(['/src/Component.ts']);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("import React from 'react'");
      expect(result).toContain("import { Button } from '@mui/material'");
      expect(result).toContain("import Component from './Component'");
    });

    it('should handle imports not in filePaths', () => {
      const source = `
        import Component1 from './Component1';
        import Component2 from './Component2';
        import UnknownComponent from './UnknownComponent';
      `;
      const filePaths = new Set(['/src/Component1.ts', '/src/Component2.ts']);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("import Component1 from './Component1'");
      expect(result).toContain("import Component2 from './Component2'");
      expect(result).toContain("import UnknownComponent from './UnknownComponent'"); // unchanged
    });

    it('should handle named imports', () => {
      const source = `
        import { Component1, Component2 } from '../utils/components';
        import * as Utils from '../../helpers/utils';
      `;
      const filePaths = new Set(['/src/utils/components.ts', '/src/helpers/utils.ts']);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("import { Component1, Component2 } from './components'");
      expect(result).toContain("import * as Utils from './utils'");
    });

    it('should handle multiline imports', () => {
      const source = `
        import {
          Component1,
          Component2,
          Component3
        } from '../components/index';
      `;
      const filePaths = new Set(['/src/components/index.ts']);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toContain("from './index'");
    });

    it('should handle empty filePaths', () => {
      const source = `
        import Component from './Component';
      `;
      const filePaths = new Set<string>();

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toBe(source); // unchanged
    });

    it('should handle empty source', () => {
      const source = '';
      const filePaths = new Set(['/src/Component.ts']);

      const result = rewriteImportsToSameDirectory(source, filePaths);

      expect(result).toBe('');
    });
  });
});
