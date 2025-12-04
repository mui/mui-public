import { describe, it, expect } from 'vitest';
import { parseImportsAndComments } from './parseImportsAndComments';
import { resolveImportResult, type DirectoryEntry } from './resolveModulePath';
import { processRelativeImports } from './processRelativeImports';
import { getFileNameFromUrl } from './getFileNameFromUrl';

// Mock filesystem structure for testing
const mockFileSystem: Record<string, DirectoryEntry[]> = {
  '/src': [
    { name: 'components', isDirectory: true, isFile: false },
    { name: 'utils', isDirectory: true, isFile: false },
    { name: 'shared', isDirectory: true, isFile: false },
    { name: 'styles', isDirectory: true, isFile: false },
    { name: 'types.d.ts', isDirectory: false, isFile: true },
    { name: 'styles.css', isDirectory: false, isFile: true },
    { name: 'global.css', isDirectory: false, isFile: true },
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
  '/src/current': [
    { name: 'side-effect-import.js', isDirectory: false, isFile: true },
    { name: 'theme.css', isDirectory: false, isFile: true },
    { name: 'components.css', isDirectory: false, isFile: true },
  ],
  '/src/dual': [
    { name: 'Component.ts', isDirectory: false, isFile: true },
    { name: 'Component.d.ts', isDirectory: false, isFile: true },
  ],
  '/src/styles': [
    { name: 'base.css', isDirectory: false, isFile: true },
    { name: 'components.css', isDirectory: false, isFile: true },
    { name: 'theme.css', isDirectory: false, isFile: true },
    { name: 'variables.css', isDirectory: false, isFile: true },
    { name: 'ui', isDirectory: true, isFile: false },
  ],
  '/src/styles/ui': [
    { name: 'button.css', isDirectory: false, isFile: true },
    { name: 'dialog.css', isDirectory: false, isFile: true },
    { name: 'forms.css', isDirectory: false, isFile: true },
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
  const parseResult = await parseImportsAndComments(sourceCode, filePath);

  // Convert the new format to the format expected by processRelativeImports, preserving positions
  const importResult: Record<
    string,
    {
      url: string;
      names: string[];
      includeTypeDefs?: true;
      positions: Array<{ start: number; end: number }>;
    }
  > = {};
  for (const [path, relativeImport] of Object.entries(parseResult.relative)) {
    importResult[path] = {
      url: relativeImport.url,
      names: relativeImport.names.map((name) => name.name), // Extract just the name string
      positions: relativeImport.positions,
      includeTypeDefs: relativeImport.includeTypeDefs,
    };
  }

  // Step 2: Resolve import paths to actual files
  const resolvedPathsMap = await resolveImportResult(importResult, mockDirectoryReader);

  // Step 3: Process imports and generate final result
  // Determine if this is a JavaScript/TypeScript file
  const isJsFile = /\.(js|jsx|ts|tsx|mjs|cjs|mdx)$/i.test(filePath);
  const processedResult = processRelativeImports(
    sourceCode,
    importResult,
    mode,
    isJsFile,
    resolvedPathsMap,
  );

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

// CSS-specific loader for testing CSS import processing
async function mockCssLoader(
  sourceCode: string,
  filePath: string,
  mode: 'flat' | 'canonical' | 'import' = 'flat',
) {
  // Step 1: Parse imports from CSS source code
  const parseResult = await parseImportsAndComments(sourceCode, filePath);

  // Convert the new format to the format expected by processRelativeImports, preserving positions
  const importResult: Record<
    string,
    { url: string; names: string[]; positions: Array<{ start: number; end: number }> }
  > = {};
  for (const [path, relativeImport] of Object.entries(parseResult.relative)) {
    importResult[path] = {
      url: relativeImport.url,
      names: [], // CSS imports don't have named imports
      positions: relativeImport.positions,
    };
  }

  // Step 2: Process CSS imports (isJsFile = false)
  const processedResult = processRelativeImports(sourceCode, importResult, mode);

  return {
    // Input
    sourceCode,
    filePath,
    mode,
    // Intermediate results
    importResult,
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
        { url: '/src/types.d.ts', expected: { fileName: 'types.d.ts', extension: '.d.ts' } },
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

  describe('CSS Integration Tests', () => {
    describe('CSS import processing', () => {
      it('should process basic CSS imports in flat mode', async () => {
        const input = {
          sourceCode: `
@import '../styles/base.css';
@import './components.css';
@import '../styles/theme.css';

.component {
  color: red;
}
`,
          filePath: '/src/current/main.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './components.css': 'file:///src/current/components.css',
          './theme.css': 'file:///src/styles/theme.css',
        });

        expect(result.processedSource).toContain("@import 'base.css'");
        expect(result.processedSource).toContain("@import 'components.css'");
        expect(result.processedSource).toContain("@import 'theme.css'");
        expect(result.processedSource).toContain('.component {\n  color: red;\n}');
      });

      it('should handle CSS imports with layers and media queries', async () => {
        const input = {
          sourceCode: `
@import '../styles/base.css' layer(base);
@import '../styles/components.css' layer(components) screen and (min-width: 768px);
@import url('../styles/theme.css') supports(display: grid);
@import '../styles/variables.css' layer(utilities) print;

.main {
  display: grid;
}
`,
          filePath: '/src/current/advanced.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './components.css': 'file:///src/styles/components.css',
          './theme.css': 'file:///src/styles/theme.css',
          './variables.css': 'file:///src/styles/variables.css',
        });

        expect(result.processedSource).toContain("@import 'base.css' layer(base)");
        expect(result.processedSource).toContain(
          "@import 'components.css' layer(components) screen and (min-width: 768px)",
        );
        expect(result.processedSource).toContain(
          "@import url('theme.css') supports(display: grid)",
        );
        expect(result.processedSource).toContain("@import 'variables.css' layer(utilities) print");
      });

      it('should handle nested directory CSS imports with naming conflicts', async () => {
        const input = {
          sourceCode: `
@import '../styles/ui/button.css';
@import '../styles/ui/dialog.css';
@import '../styles/ui/forms.css';
@import '../styles/components.css';

.layout {
  margin: 0;
}
`,
          filePath: '/src/current/layout.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './button.css': 'file:///src/styles/ui/button.css',
          './dialog.css': 'file:///src/styles/ui/dialog.css',
          './forms.css': 'file:///src/styles/ui/forms.css',
          './components.css': 'file:///src/styles/components.css',
        });

        expect(result.processedSource).toContain("@import 'button.css'");
        expect(result.processedSource).toContain("@import 'dialog.css'");
        expect(result.processedSource).toContain("@import 'forms.css'");
        expect(result.processedSource).toContain("@import 'components.css'");
      });

      it('should preserve canonical mode without rewriting CSS imports', async () => {
        const input = {
          sourceCode: `
@import '../styles/base.css';
@import './theme.css' layer(theme);

body {
  margin: 0;
}
`,
          filePath: '/src/current/app.css',
          mode: 'canonical' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.processedSource).toBe(input.sourceCode); // No rewriting
        expect(result.extraFiles).toEqual({
          '../styles/base.css': 'file:///src/styles/base.css',
          './theme.css': 'file:///src/current/theme.css',
        });
      });

      it('should preserve import mode without rewriting CSS imports', async () => {
        const input = {
          sourceCode: `
@import '../styles/variables.css';
@import url('../styles/theme.css') supports(color: color(display-p3 1 0 0));

:root {
  --primary: blue;
}
`,
          filePath: '/src/current/variables.css',
          mode: 'import' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.processedSource).toBe(input.sourceCode); // No rewriting
        expect(result.extraFiles).toEqual({
          '../styles/variables.css': 'file:///src/styles/variables.css',
          '../styles/theme.css': 'file:///src/styles/theme.css',
        });
      });

      it('should handle complex CSS imports with quotes and url() syntax', async () => {
        const input = {
          sourceCode: `
@import '../styles/base.css';
@import url("../styles/theme.css");
@import url('../styles/components.css') layer(components);
@import "../styles/variables.css" supports(display: grid) screen;

.container {
  display: flex;
}
`,
          filePath: '/src/current/complex.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './theme.css': 'file:///src/styles/theme.css',
          './components.css': 'file:///src/styles/components.css',
          './variables.css': 'file:///src/styles/variables.css',
        });

        expect(result.processedSource).toContain("@import 'base.css'");
        expect(result.processedSource).toContain('@import url("theme.css")');
        expect(result.processedSource).toContain("@import url('components.css') layer(components)");
        expect(result.processedSource).toContain(
          '@import "variables.css" supports(display: grid) screen',
        );
      });

      it('should handle CSS imports mixed with external imports', async () => {
        const input = {
          sourceCode: `
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap');
@import '../styles/base.css';
@import url('https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css');
@import './theme.css' layer(theme);

.app {
  font-family: 'Roboto', sans-serif;
}
`,
          filePath: '/src/current/app.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        // Both relative imports should be processed correctly
        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './theme.css': 'file:///src/current/theme.css',
        });

        // External imports should remain unchanged
        expect(result.processedSource).toContain(
          "@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap')",
        );
        expect(result.processedSource).toContain(
          "@import url('https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css')",
        );
        // Relative imports should be rewritten
        expect(result.processedSource).toContain("@import 'base.css'");
        expect(result.processedSource).toContain("@import 'theme.css' layer(theme)");
      });

      it('should handle empty CSS file', async () => {
        const input = {
          sourceCode: `
/* Empty CSS file with just comments */

/* No imports here */
`,
          filePath: '/src/current/empty.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({});
        expect(result.processedSource).toBe(input.sourceCode); // Unchanged
      });

      it('should handle CSS with no relative imports', async () => {
        const input = {
          sourceCode: `
@import url('https://fonts.googleapis.com/css?family=Open+Sans');

.header {
  background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
  color: white;
}

@media (max-width: 768px) {
  .header {
    padding: 1rem;
  }
}
`,
          filePath: '/src/current/external-only.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({});
        expect(result.processedSource).toBe(input.sourceCode); // External imports unchanged
      });
    });

    describe('CSS error handling and edge cases', () => {
      it('should handle malformed CSS imports gracefully', async () => {
        const input = {
          sourceCode: `
@import '../styles/base.css';
@import; /* Malformed import */
@import '../styles/theme.css';

.component {
  color: red;
}
`,
          filePath: '/src/current/malformed.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        // Should process valid imports and ignore malformed ones
        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './theme.css': 'file:///src/styles/theme.css',
        });

        expect(result.processedSource).toContain("@import 'base.css'");
        expect(result.processedSource).toContain('@import; /* Malformed import */'); // Unchanged
        expect(result.processedSource).toContain("@import 'theme.css'");
      });

      it('should handle CSS imports in comments', async () => {
        const input = {
          sourceCode: `
/* @import '../styles/commented.css'; */
@import '../styles/base.css';
// @import '../styles/single-line-comment.css';
@import '../styles/theme.css';

.component {
  /* @import '../styles/inside-rule.css'; */
  color: blue;
}
`,
          filePath: '/src/current/with-comments.css',
          mode: 'flat' as const,
        };

        const result = await mockCssLoader(input.sourceCode, input.filePath, input.mode);

        // Should only process actual imports, not commented ones
        expect(result.extraFiles).toEqual({
          './base.css': 'file:///src/styles/base.css',
          './theme.css': 'file:///src/styles/theme.css',
        });

        expect(result.processedSource).toContain("/* @import '../styles/commented.css'; */"); // Unchanged
        expect(result.processedSource).toContain("@import 'base.css'");
        expect(result.processedSource).toContain("@import 'theme.css'");
      });
    });
  });

  describe('MDX Integration Tests', () => {
    describe('MDX file processing with triple backtick support', () => {
      it('should process MDX files like JavaScript files but ignore imports in code blocks', async () => {
        const input = {
          sourceCode: `
import React from 'react';
import { Button } from '@mui/material';
import ComponentA from '../components/ComponentA';

# My Documentation

This is a markdown document with embedded JSX.

<ComponentA />

Here's an example that should be ignored:

\`\`\`javascript
import { FakeComponent } from './fake-component';
import { AnotherFake } from '../fake-parent';

function Example() {
  return <FakeComponent />;
}
\`\`\`

<Button>Click me</Button>

import ComponentB from '../utils/ComponentB';

\`\`\`tsx
// This import should also be ignored
import type { Props } from './fake-props';

export default function FakeExample({ title }: Props) {
  return <div>{title}</div>;
}
\`\`\`

Back to real content:
import { helper } from '../shared/helpers';
`,
          filePath: '/src/current/file.mdx',
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

        // External imports should remain unchanged
        expect(result.processedSource).toContain("import React from 'react'");
        expect(result.processedSource).toContain("import { Button } from '@mui/material'");

        // Imports in code blocks should remain unchanged (not rewritten)
        expect(result.processedSource).toContain(
          "import { FakeComponent } from './fake-component'",
        );
        expect(result.processedSource).toContain("import { AnotherFake } from '../fake-parent'");
        expect(result.processedSource).toContain("import type { Props } from './fake-props'");
      });

      it('should handle complex MDX with multiple code blocks and language specifiers', async () => {
        const input = {
          sourceCode: `
import React from 'react';
import { Layout } from '../components/Layout';

# Advanced Example

TypeScript example:
\`\`\`typescript
import { TypeScript } from './typescript-example';
interface Props {
  title: string;
}
\`\`\`

<Layout>
  <div>Some content</div>
</Layout>

JSX example:
\`\`\`jsx
import { JSXComponent } from './jsx-example';
function App() {
  return <JSXComponent />;
}
\`\`\`

import ComponentA from '../components/ComponentA';

TSX example:
\`\`\`tsx
import type { FC } from 'react';
const Component: FC = () => <div>Hello</div>;
\`\`\`

import { Utils } from '../utils';
`,
          filePath: '/src/current/advanced.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          './utils.ts': 'file:///src/utils/index.ts',
          // Layout is not included because it doesn't exist in the mock filesystem
        });

        // Layout import is not rewritten because it doesn't exist in mock filesystem
        expect(result.processedSource).toContain("import { Layout } from '../components/Layout'");
        expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
        expect(result.processedSource).toContain("import { Utils } from './utils'");
      });

      it('should handle unclosed code blocks in MDX files', async () => {
        const input = {
          sourceCode: `
import React from 'react';
import ComponentA from '../components/ComponentA';

# Example with unclosed code block

\`\`\`javascript
import { FakeComponent } from './fake';

// This code block is never closed
function example() {
  return 'unclosed';
}

// The rest should be treated as part of the code block
import { ShouldBeIgnored } from './should-be-ignored';
`,
          filePath: '/src/current/unclosed.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        // Should only process imports before the unclosed code block
        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        });

        expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
        // Imports after unclosed code block should remain unchanged
        expect(result.processedSource).toContain(
          "import { ShouldBeIgnored } from './should-be-ignored'",
        );
      });

      it('should not apply code block handling to non-MDX files', async () => {
        const input = {
          sourceCode: `
import React from 'react';

// This is a regular TypeScript file, not MDX
// Triple backticks should be treated as template literals
const codeExample = \`
\`\`\`javascript
import { FakeComponent } from '../components/FakeComponent';
\`\`\`
\`;

import ComponentA from '../components/ComponentA';
`,
          filePath: '/src/current/regular.tsx', // Not .mdx
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        // Should process both imports since this is not an MDX file
        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
        });

        expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
      });

      it('should preserve canonical mode without rewriting imports in MDX files', async () => {
        const input = {
          sourceCode: `
import ComponentA from '../components/ComponentA';

# Documentation

\`\`\`javascript
import { FakeComponent } from './fake';
\`\`\`

import { helper } from '../utils/helper';
`,
          filePath: '/src/current/file.mdx',
          mode: 'canonical' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.processedSource).toBe(input.sourceCode); // No rewriting
        expect(result.extraFiles).toEqual({
          '../components/ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          '../utils/helper.js': 'file:///src/utils/helper.js',
        });
      });

      it('should handle inline code spans that look like code blocks', async () => {
        const input = {
          sourceCode: `
import React from 'react';

# Example

This text has inline \`\`\`code spans\`\`\` that should not be treated as code blocks.

import ComponentA from '../components/ComponentA';

The \`\`\`inline code\`\`\` here should not affect parsing.

Here's a real code block:

\`\`\`javascript
import { ShouldBeIgnored } from './should-be-ignored';
\`\`\`

import { helper } from '../shared/helpers';
`,
          filePath: '/src/current/inline-code.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          './helpers.js': 'file:///src/shared/helpers.js',
        });

        expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
        expect(result.processedSource).toContain("import { helper } from './helpers'");
        // The fake import should remain unchanged
        expect(result.processedSource).toContain(
          "import { ShouldBeIgnored } from './should-be-ignored'",
        );
      });

      it('should handle empty and minimal code blocks', async () => {
        const input = {
          sourceCode: `
import React from 'react';

# Example with empty code blocks

\`\`\`
\`\`\`

import ComponentA from '../components/ComponentA';

\`\`\`javascript
\`\`\`

import { helper } from '../shared/helpers';

\`\`\`
// Just a comment
\`\`\`

import ComponentB from '../utils/ComponentB';
`,
          filePath: '/src/current/empty-blocks.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          './helpers.js': 'file:///src/shared/helpers.js',
          './ComponentB.ts': 'file:///src/utils/ComponentB.ts',
        });

        expect(result.processedSource).toContain("import ComponentA from './ComponentA'");
        expect(result.processedSource).toContain("import { helper } from './helpers'");
        expect(result.processedSource).toContain("import ComponentB from './ComponentB'");
      });

      it('should work with type imports and MDX', async () => {
        const input = {
          sourceCode: `
import type { MDXProps } from 'mdx/types';
import type { TypeDef } from '../types';

# Type Examples

\`\`\`typescript
import type { FakeProps } from './fake-props';
interface Example {
  title: string;
}
\`\`\`

import { ComponentA } from '../components/ComponentA';
import { helper } from '../utils/helper';
`,
          filePath: '/src/current/types.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './types.d.ts': 'file:///src/types.d.ts',
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          './helper.js': 'file:///src/utils/helper.js',
        });

        expect(result.processedSource).toContain("import type { TypeDef } from './types'");
        expect(result.processedSource).toContain("import { ComponentA } from './ComponentA'");
        expect(result.processedSource).toContain("import { helper } from './helper'");
        // External type import should remain unchanged
        expect(result.processedSource).toContain("import type { MDXProps } from 'mdx/types'");
        // Fake import in code block should remain unchanged
        expect(result.processedSource).toContain("import type { FakeProps } from './fake-props'");
      });

      it('should handle MDX files with mixed content and complex nesting', async () => {
        const input = {
          sourceCode: `
import React from 'react';
import { ComponentA } from '../components/ComponentA';
import { Button } from '../components/Button';

export const meta = {
  title: 'Complex Example',
};

# Complex MDX Example

<ComponentA>
  <div>
    Some JSX content with components.
  </div>
</ComponentA>

Here's a nested example:

\`\`\`jsx
import { NestedFake } from './nested-fake';

function ExampleComponent() {
  return (
    <div>
      <NestedFake />
      <Button>
        {\`
        // This is code inside JSX inside a code block
        import { DoublyNested } from './doubly-nested';
        \`}
      </Button>
    </div>
  );
}
\`\`\`

<Button language="typescript">
  {\`import { FakeInJSX } from './fake-in-jsx';\`}
</Button>

import { ComponentB } from '../utils/ComponentB';

\`\`\`
Plain code block with no language
import { PlainFake } from './plain-fake';
\`\`\`
`,
          filePath: '/src/current/complex.mdx',
          mode: 'flat' as const,
        };

        const result = await mockLoader(input.sourceCode, input.filePath, input.mode);

        expect(result.extraFiles).toEqual({
          './ComponentA.tsx': 'file:///src/components/ComponentA.tsx',
          './Button.js': 'file:///src/components/Button/index.js',
          './ComponentB.ts': 'file:///src/utils/ComponentB.ts',
        });

        expect(result.processedSource).toContain("import { ComponentA } from './ComponentA'");
        expect(result.processedSource).toContain("import { Button } from './Button'");
        expect(result.processedSource).toContain("import { ComponentB } from './ComponentB'");

        // Fake imports in code blocks should remain unchanged
        expect(result.processedSource).toContain("import { NestedFake } from './nested-fake'");
        expect(result.processedSource).toContain("import { DoublyNested } from './doubly-nested'");
        expect(result.processedSource).toContain("import { FakeInJSX } from './fake-in-jsx'");
        expect(result.processedSource).toContain("import { PlainFake } from './plain-fake'");
      });
    });
  });
});
