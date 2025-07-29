import { describe, it, expect } from 'vitest';
import { parseImports } from './parseImports';
import { resolveImportResult, type DirectoryEntry } from './resolveModulePath';
import { processImports } from './processImports';
import { getFileNameFromUrl } from './getFileNameFromUrl';

// Mock filesystem structure for testing
const mockFileSystem: Record<string, DirectoryEntry[]> = {
  '/src': [
    { name: 'components', isDirectory: true, isFile: false },
    { name: 'utils', isDirectory: true, isFile: false },
    { name: 'shared', isDirectory: true, isFile: false },
    { name: 'types.d.ts', isDirectory: false, isFile: true },
    { name: 'styles.css', isDirectory: false, isFile: true },
  ],
  '/src/components': [
    { name: 'ComponentA.tsx', isDirectory: false, isFile: true },
    { name: 'Button', isDirectory: true, isFile: false },
    { name: 'Dialog', isDirectory: true, isFile: false },
  ],
  '/src/components/Button': [{ name: 'index.js', isDirectory: false, isFile: true }],
  '/src/components/Dialog': [{ name: 'index.tsx', isDirectory: false, isFile: true }],
  '/src/utils': [
    { name: 'ComponentB.ts', isDirectory: false, isFile: true },
    { name: 'index.ts', isDirectory: false, isFile: true },
    { name: 'helper.js', isDirectory: false, isFile: true },
  ],
  '/src/shared': [{ name: 'helpers.js', isDirectory: false, isFile: true }],
  '/src/a': [{ name: 'Component.js', isDirectory: false, isFile: true }],
  '/src/b': [{ name: 'Component.js', isDirectory: false, isFile: true }],
  '/src/current': [{ name: 'side-effect-import.js', isDirectory: false, isFile: true }],
  '/src/dual': [
    { name: 'Component.ts', isDirectory: false, isFile: true },
    { name: 'Component.d.ts', isDirectory: false, isFile: true },
  ],
};

// Mock directory reader function
const mockDirectoryReader = async (path: string): Promise<DirectoryEntry[]> => {
  const entries = mockFileSystem[path];
  if (!entries) {
    throw new Error(`Directory not found: ${path}`);
  }
  return entries;
};

// Integration loader that combines all real utilities
async function mockLoader(
  sourceCode: string,
  filePath: string,
  mode: 'flat' | 'canonical' | 'import' = 'flat',
) {
  // Step 1: Parse imports from source code
  const parseResult = await parseImports(sourceCode, filePath);

  // Convert the new format to the old format expected by the integration test functions
  const importResult: Record<string, { path: string; names: string[]; includeTypeDefs?: true }> =
    {};
  for (const [path, relativeImport] of Object.entries(parseResult.relative)) {
    importResult[path] = {
      path: relativeImport.path,
      names: relativeImport.names.map((name) => name.name), // Extract just the name string
      includeTypeDefs: relativeImport.includeTypeDefs,
    };
  }

  // Step 2: Resolve import paths to actual files
  const resolvedPathsMap = await resolveImportResult(importResult, mockDirectoryReader);

  // Step 3: Process imports and generate final result
  const processedResult = processImports(sourceCode, importResult, resolvedPathsMap, mode);

  return {
    // Input
    sourceCode,
    filePath,
    mode,
    // Intermediate results
    importResult,
    resolvedPathsMap,
    // Final output
    processedSource: processedResult.processedSource,
    extraFiles: processedResult.extraFiles,
  };
}

describe('Integration Tests - Full Pipeline', () => {
  describe('End-to-end processing scenarios', () => {
    it('should process basic imports in flat mode', async () => {
      const input = {
        sourceCode: `
import ComponentA from '../components/ComponentA';
import ComponentB from '../utils/ComponentB';
import { helper } from '../shared/helpers';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({
        './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        './ComponentB.ts': 'file:///src/utils/ComponentB.ts',
        './helpers.js': 'file:///src/shared/helpers.js',
      });

      expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
      expect(result.processedSource).toContain("import ComponentB from './ComponentB'");
      expect(result.processedSource).toContain("import { helper } from './helpers'");
    });

    it('should process index files correctly', async () => {
      const input = {
        sourceCode: `
import ButtonComponent from '../components/Button';
import { Dialog } from '../components/Dialog';
import utils from '../utils';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({
        './Button.js': 'file:///src/components/Button/index.js',
        './Dialog.tsx': 'file:///src/components/Dialog/index.tsx',
        './utils.ts': 'file:///src/utils/index.ts',
      });

      expect(result.processedSource).toContain("import ButtonComponent from './Button'");
      expect(result.processedSource).toContain("import { Dialog } from './Dialog'");
      expect(result.processedSource).toContain("import utils from './utils'");
    });

    it('should handle filename conflicts with directory structure', async () => {
      const input = {
        sourceCode: `
import ComponentA from './a/Component';
import ComponentB from './b/Component';
`,
        filePath: '/src/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({
        './a/Component.js': 'file:///src/a/Component.js',
        './b/Component.js': 'file:///src/b/Component.js',
      });

      expect(result.processedSource).toContain("import ComponentA from './a/Component'");
      expect(result.processedSource).toContain("import ComponentB from './b/Component'");
    });

    it('should process mixed import types including type imports and side effects', async () => {
      const input = {
        sourceCode: `
import React from 'react';
import ComponentA from '../components/ComponentA';
import { ComponentB } from '../utils/ComponentB';
import * as Utils from '../utils';
import type { TypeDef } from '../types';
import '../styles.css';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({
        './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        './ComponentB.ts': 'file:///src/utils/ComponentB.ts',
        './utils.ts': 'file:///src/utils/index.ts',
        './types.d.ts': 'file:///src/types.d.ts',
        './styles.css': 'file:///src/styles.css',
      });

      expect(result.processedSource).toContain("import React from 'react'"); // External unchanged
      expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
      expect(result.processedSource).toContain("import { ComponentB } from './ComponentB'");
      expect(result.processedSource).toContain("import * as Utils from './utils'");
      expect(result.processedSource).toContain("import type { TypeDef } from './types'");
      expect(result.processedSource).toContain("import './styles.css'");
    });

    it('should handle advanced import patterns', async () => {
      const input = {
        sourceCode: `
import type { TypeDef } from '../types';
import '../styles.css';
import './side-effect-import';
import { Button, type ButtonProps, Component as RenamedComponent } from '../components/Button';
import type { default as DefaultType } from '../components/Dialog';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({
        './types.d.ts': 'file:///src/types.d.ts',
        './styles.css': 'file:///src/styles.css',
        './side-effect-import.js': 'file:///src/current/side-effect-import.js',
        './Button.js': 'file:///src/components/Button/index.js',
        './Dialog.tsx': 'file:///src/components/Dialog/index.tsx',
      });

      expect(result.processedSource).toContain("import type { TypeDef } from './types'");
      expect(result.processedSource).toContain("import './styles.css'");
      expect(result.processedSource).toContain("import './side-effect-import'");
      expect(result.processedSource).toContain(
        "import { Button, type ButtonProps, Component as RenamedComponent } from './Button'",
      );
      expect(result.processedSource).toContain(
        "import type { default as DefaultType } from './Dialog'",
      );
    });

    it('should preserve canonical mode without rewriting imports', async () => {
      const input = {
        sourceCode: `
import ComponentA from '../components/ComponentA';
import { helper } from '../utils/helper';
`,
        filePath: '/src/current/file.tsx',
        mode: 'canonical' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.processedSource).toBe(input.sourceCode); // No rewriting
      expect(result.extraFiles).toEqual({
        '../components/ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        '../utils/helper.js': 'file:///src/utils/helper.js',
      });
    });

    it('should preserve import mode without rewriting imports', async () => {
      const input = {
        sourceCode: `
import ComponentA from '../components/ComponentA';
import { helper } from '../utils/helper';
`,
        filePath: '/src/current/file.tsx',
        mode: 'import' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.processedSource).toBe(input.sourceCode); // No rewriting
      expect(result.extraFiles).toEqual({
        '../components/ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        '../utils/helper.js': 'file:///src/utils/helper.js',
      });
    });

    it('should handle type and value imports from same module', async () => {
      const input = {
        sourceCode: `
import type { Props } from '../dual/Component';
import { Component } from '../dual/Component';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      // Should resolve to .ts file (higher priority than .d.ts for value imports)
      expect(result.extraFiles).toEqual({
        './Component.ts': 'file:///src/dual/Component.ts',
      });

      expect(result.processedSource).toContain("import type { Props } from './Component'");
      expect(result.processedSource).toContain("import { Component } from './Component'");
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle missing files gracefully', async () => {
      const input = {
        sourceCode: `
import MissingComponent from '../missing/Component';
import ExistingComponent from '../components/ComponentA';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      // Only existing files should appear in extraFiles
      expect(result.extraFiles).toEqual({
        './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
      });

      // Missing import should remain unchanged
      expect(result.processedSource).toContain(
        "import MissingComponent from '../missing/Component'",
      );
      expect(result.processedSource).toContain("import ExistingComponent from './ComponentA'");
    });

    it('should handle empty source code', async () => {
      const input = {
        sourceCode: 'const x = 1; // No imports here',
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      expect(result.extraFiles).toEqual({});
      expect(result.processedSource).toBe(input.sourceCode); // Unchanged
    });

    it('should handle external imports correctly', async () => {
      const input = {
        sourceCode: `
import React from 'react';
import { useState } from 'react';
import lodash from 'lodash';
import ComponentA from '../components/ComponentA';
`,
        filePath: '/src/current/file.tsx',
        mode: 'flat' as const,
      };

      const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

      // Only relative imports should be processed
      expect(result.extraFiles).toEqual({
        './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
      });

      // External imports should remain unchanged
      expect(result.processedSource).toContain("import React from 'react'");
      expect(result.processedSource).toContain("import { useState } from 'react'");
      expect(result.processedSource).toContain("import lodash from 'lodash'");
      expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
    });
  });

  describe('Utility function integration', () => {
    it('should work with getFileNameFromUrl for various file types', () => {
      // Test different file types that would come from the loader
      const testCases = [
        {
          url: '/src/components/ComponentA.tsx',
          expected: { fileName: 'ComponentA.tsx', extension: '.tsx' },
        },
        { url: '/src/types.d.ts', expected: { fileName: 'types.d.ts', extension: '.ts' } },
        { url: '/src/styles.css', expected: { fileName: 'styles.css', extension: '.css' } },
        {
          url: '/src/components/Button/index.js',
          expected: { fileName: 'index.js', extension: '.js' },
        },
        {
          url: 'file:///src/components/Component.tsx',
          expected: { fileName: 'Component.tsx', extension: '.tsx' },
        },
        {
          url: 'https://example.com/path/to/file.js',
          expected: { fileName: 'file.js', extension: '.js' },
        },
      ];

      testCases.forEach(({ url, expected }) => {
        expect(getFileNameFromUrl(url)).toEqual(expected);
      });
    });
  });
});
