import { describe, it, expect } from 'vitest';
import { resolveImports, resolveImportMap } from './resolveImports';
import { rewriteImportsToSameDirectory } from './rewriteImports';

describe('resolveImports', () => {
  describe('resolveImports', () => {
    it('should resolve relative import paths', async () => {
      const code = `
        import Component1 from './Component1';
        import { Component2, Component3 } from './components';
        import * as Utils from '../utils';
      `;
      const filePath = '/src/demo.ts';
      const result = await resolveImports(code, filePath);

      // Note: Component2 and Component3 both resolve to '/src/components', so we get duplicates
      expect(result).toEqual([
        '/src/Component1',
        '/src/components',
        '/src/components', // duplicate because both Component2 and Component3 are from same file
        '/utils',
      ]);
    });

    it('should ignore non-relative imports', async () => {
      const code = `
        import React from 'react';
        import { Button } from '@mui/material';
        import Component from './Component';
      `;
      const filePath = '/src/demo.ts';
      const result = await resolveImports(code, filePath);

      expect(result).toEqual(['/src/Component']);
    });

    it('should handle empty code', async () => {
      const code = '';
      const filePath = '/src/demo.ts';
      const result = await resolveImports(code, filePath);

      expect(result).toEqual([]);
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

      expect(result).toEqual([]);
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

      expect(result).toEqual([
        '/src/default',
        '/src/named',
        '/src/named', // duplicate because both NamedImport1 and NamedImport2 are from same file
        '/src/namespace',
        '/src/aliased',
      ]);
    });

    it('should handle deeply nested paths', async () => {
      const code = `
        import Component from '../../../shared/components/Component';
        import Utils from '../../utils/helpers';
      `;
      const filePath = '/src/features/demo/components/demo.ts';
      const result = await resolveImports(code, filePath);

      // URL constructor resolves paths differently than expected
      expect(result).toEqual(['/src/shared/components/Component', '/src/features/utils/helpers']);
    });
  });

  describe('resolveImportMap', () => {
    it('should return a Map of import names to resolved paths', async () => {
      const code = `
        import DefaultImport from './component';
        import { NamedImport } from '../utils';
        import * as NamespaceImport from '../../helpers';
        import NonRelativeImport from 'package';
      `;
      const filePath = '/src/features/page.tsx';

      const result = await resolveImportMap(code, filePath);

      expect(result).toBeInstanceOf(Map);
      expect(result.get('DefaultImport')).toBe('/src/features/component');
      expect(result.get('NamedImport')).toBe('/src/utils');
      expect(result.get('NamespaceImport')).toBe('/helpers');
      expect(result.has('NonRelativeImport')).toBe(false);
    });

    it('should handle empty code', async () => {
      const result = await resolveImportMap('', '/src/file.tsx');
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
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
